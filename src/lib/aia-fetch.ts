import "server-only";

import * as tls from "node:tls";
import * as https from "node:https";
import * as http from "node:http";
import { createHash, X509Certificate } from "node:crypto";

let systemRoots: string[] | null = null;
let systemRootCerts: X509Certificate[] | null = null;

function getSystemRoots(): string[] {
  if (!systemRoots) {
    systemRoots = [...tls.rootCertificates];
  }
  return systemRoots;
}

function getSystemRootCerts(): X509Certificate[] {
  if (!systemRootCerts) {
    systemRootCerts = parsePemCerts(getSystemRoots().join("\n"));
  }
  return systemRootCerts;
}

const cache = new Map<string, { pems: string[]; fetchedAt: number; ttl: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000;
const TIMEOUT_CACHE_TTL_MS = 2 * 60 * 1000;
const CHAIN_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const MAX_CERT_BYTES = 64 * 1024;

const inflight = new Map<string, Promise<string[]>>();

// Fetched certificates are returned only if they chain to a system root or extraRootsPem.
export async function getExtraCaCerts(
  hostname: string,
  port: number | string,
  extraRootsPem?: string | null,
): Promise<string[]> {
  const rootsKey = extraRootsPem
    ? createHash("sha256").update(extraRootsPem).digest("hex")
    : "";
  const key = `${hostname}:${port}:${rootsKey}`;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < cached.ttl) {
    return cached.pems;
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const trusted = [
    ...getSystemRootCerts(),
    ...(extraRootsPem ? parsePemCerts(extraRootsPem) : []),
  ];
  const promise = (async () => {
    const intermediates = await withTimeout(fetchChain(hostname, Number(port), trusted), CHAIN_TIMEOUT_MS);

    if (!intermediates) {
      cache.set(key, { pems: [], fetchedAt: Date.now(), ttl: TIMEOUT_CACHE_TTL_MS });
      return [];
    }

    if (intermediates.length === 0) {
      cache.set(key, { pems: [], fetchedAt: Date.now(), ttl: CACHE_TTL_MS });
      return [];
    }

    const fullBundle = [...getSystemRoots(), ...intermediates];
    cache.set(key, { pems: fullBundle, fetchedAt: Date.now(), ttl: CACHE_TTL_MS });
    return fullBundle;
  })();
  inflight.set(key, promise);

  try {
    return await promise;
  } catch {
    return [];
  } finally {
    inflight.delete(key);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isSignedBy(cert: X509Certificate, issuer: X509Certificate): boolean {
  try {
    return cert.checkIssued(issuer) && cert.verify(issuer.publicKey);
  } catch {
    return false;
  }
}

function isSignedByAny(cert: X509Certificate, issuers: X509Certificate[]): boolean {
  return issuers.some((issuer) => isSignedBy(cert, issuer));
}

async function fetchChain(
  hostname: string,
  port: number,
  trusted: X509Certificate[],
): Promise<string[]> {
  const leaf = await getLeafCert(hostname, port);
  if (!leaf || isSignedByAny(leaf, trusted)) return [];

  const pems: string[] = [];
  let current = leaf;

  for (let depth = 0; depth < 5; depth++) {
    const next = await fetchIssuerCert(current);
    if (!next || next.checkIssued(next)) return [];

    pems.push(next.toString());
    if (isSignedByAny(next, trusted)) return pems;
    current = next;
  }

  return [];
}

// Returns the issuer only if it verifiably signed `cert`.
export async function fetchIssuerCert(cert: X509Certificate): Promise<X509Certificate | null> {
  for (const url of extractCaIssuerUrls(cert)) {
    try {
      const pem = toPem(await fetchUrl(url));
      if (!pem) continue;
      const candidate = new X509Certificate(pem);
      if (candidate.ca && isSignedBy(cert, candidate)) {
        return candidate;
      }
    } catch {}
  }
  return null;
}

export function getLeafCert(
  hostname: string,
  port: number,
  timeoutMs = 5000,
): Promise<X509Certificate | null> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: hostname, port, rejectUnauthorized: false, timeout: timeoutMs },
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

function fetchUrl(url: string, redirectsLeft = MAX_REDIRECTS): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, { timeout: 10000 }, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        res.resume();
        let next: URL;
        try {
          next = new URL(res.headers.location, url);
        } catch {
          reject(new Error("Invalid redirect"));
          return;
        }
        if (redirectsLeft <= 0 || (next.protocol !== "http:" && next.protocol !== "https:")) {
          reject(new Error("Redirect refused"));
          return;
        }
        fetchUrl(next.toString(), redirectsLeft - 1).then(resolve, reject);
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_CERT_BYTES) {
          req.destroy();
          reject(new Error("Response too large"));
          return;
        }
        chunks.push(chunk);
      });
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

const PEM_CERT_REGEX = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

function parsePemCerts(bundle: string): X509Certificate[] {
  const certs: X509Certificate[] = [];
  for (const block of bundle.match(PEM_CERT_REGEX) ?? []) {
    try {
      certs.push(new X509Certificate(block));
    } catch {}
  }
  return certs;
}

function toPem(data: Buffer): string | null {
  const str = data.toString("utf8");

  if (str.includes("-----BEGIN CERTIFICATE-----")) {
    const blocks = str.match(PEM_CERT_REGEX) ?? [];
    if (blocks.length !== 1) return null;
    try {
      return new X509Certificate(blocks[0]).toString();
    } catch {
      return null;
    }
  }

  try {
    const b64 = data.toString("base64");
    const lines: string[] = [];
    for (let i = 0; i < b64.length; i += 64) {
      lines.push(b64.slice(i, i + 64));
    }
    const pem = `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;

    new X509Certificate(pem);
    return pem;
  } catch {
    return null;
  }
}
