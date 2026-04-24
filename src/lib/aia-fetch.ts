import "server-only";

// Node.js doesn't fetch missing intermediate CA certs from the AIA extension like browsers do.
// This module replicates that behaviour by walking the AIA chain.

import * as tls from "node:tls";
import * as https from "node:https";
import * as http from "node:http";
import { X509Certificate } from "node:crypto";

let systemRoots: string[] | null = null;

function getSystemRoots(): string[] {
  if (!systemRoots) {
    systemRoots = [...tls.rootCertificates];
  }
  return systemRoots;
}

const cache = new Map<string, { pems: string[]; fetchedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const inflight = new Map<string, Promise<string[]>>();

// `ca` option replaces the default trust store, so we must merge system roots with intermediates.
// Returns [] when nothing is found so callers can skip the `ca` override entirely.
export async function getExtraCaCerts(
  hostname: string,
  port: number | string,
): Promise<string[]> {
  const key = `${hostname}:${port}`;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.pems;
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = fetchChain(hostname, Number(port));
  inflight.set(key, promise);

  try {
    const intermediates = await promise;

    if (intermediates.length === 0) {
      cache.set(key, { pems: [], fetchedAt: Date.now() });
      return [];
    }

    const fullBundle = [...getSystemRoots(), ...intermediates];
    cache.set(key, { pems: fullBundle, fetchedAt: Date.now() });
    return fullBundle;
  } catch {
    return [];
  } finally {
    inflight.delete(key);
  }
}

async function fetchChain(hostname: string, port: number): Promise<string[]> {
  const leafPeerCert = await getLeafCert(hostname, port);
  if (!leafPeerCert) return [];

  const pems: string[] = [];
  let current: X509Certificate | null = leafPeerCert;
  const seen = new Set<string>();

  // Walk up to 5 levels (leaf → intermediate(s) → root)
  for (let depth = 0; depth < 5 && current; depth++) {
    const caIssuerUrls = extractCaIssuerUrls(current);
    if (caIssuerUrls.length === 0) break;

    let nextCert: X509Certificate | null = null;

    for (const url of caIssuerUrls) {
      if (seen.has(url)) continue;
      seen.add(url);

      try {
        const certData = await fetchUrl(url);
        const pem = toPem(certData);
        if (pem) {
          pems.push(pem);
          nextCert = new X509Certificate(pem);
          break; // got one, move up the chain
        }
      } catch {
        // Try next URL
      }
    }

    current = nextCert;
  }

  return pems;
}

function getLeafCert(hostname: string, port: number): Promise<X509Certificate | null> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: hostname, port, rejectUnauthorized: false, timeout: 5000 },
      () => {
        try {
          const raw = socket.getPeerX509Certificate?.();
          resolve(raw ?? null);
        } catch {
          resolve(null);
        } finally {
          socket.destroy();
        }
      },
    );
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

// X509Certificate.infoAccess is a newline-separated string like:
//   "OCSP - URI:http://...\nCA Issuers - URI:http://..."
function extractCaIssuerUrls(cert: X509Certificate): string[] {
  const info = cert.infoAccess;
  if (!info) return [];

  const urls: string[] = [];
  const lines = typeof info === "string" ? info.split("\n") : [];
  for (const line of lines) {
    const match = line.match(/CA Issuers\s*-\s*URI:(.+)/i);
    if (match?.[1]) {
      const url = match[1].trim();
      if (url.startsWith("http://") || url.startsWith("https://")) {
        urls.push(url);
      }
    }
  }
  return urls;
}

function fetchUrl(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { timeout: 10000 }, (res) => {
      // Follow redirects (up to 3)
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        fetchUrl(res.headers.location).then(resolve, reject);
        res.resume();
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

// AIA endpoints usually serve DER (.cer/.crt), sometimes PEM
function toPem(data: Buffer): string | null {
  const str = data.toString("utf8");

  if (str.includes("-----BEGIN CERTIFICATE-----")) {
    return str;
  }

  try {
    const b64 = data.toString("base64");
    const lines: string[] = [];
    for (let i = 0; i < b64.length; i += 64) {
      lines.push(b64.slice(i, i + 64));
    }
    const pem = `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;

    // Validate it parses
    new X509Certificate(pem);
    return pem;
  } catch {
    return null;
  }
}
