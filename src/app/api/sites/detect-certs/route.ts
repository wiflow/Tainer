import { NextRequest, NextResponse } from "next/server";
import * as tls from "node:tls";
import { X509Certificate } from "node:crypto";
import * as https from "node:https";
import * as http from "node:http";

import { requireAdminSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ ok: false, error: "Missing url parameter." }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid URL." }, { status: 400 });
  }

  const hostname = parsedUrl.hostname;
  const port = Number(parsedUrl.port) || 8006;

  try {
    const leaf = await getLeafCert(hostname, port);
    if (!leaf) {
      return NextResponse.json({
        ok: false,
        error: "Could not retrieve certificate from the server.",
      });
    }

    const chain: { subject: string; issuer: string; pem: string }[] = [];

    let current: X509Certificate | null = leaf;
    const seen = new Set<string>();

    for (let depth = 0; depth < 8 && current; depth++) {
      const fp = current.fingerprint256;
      if (seen.has(fp)) break;
      seen.add(fp);

      if (depth > 0) {
        chain.push({
          subject: current.subject,
          issuer: current.issuer,
          pem: current.toString(),
        });
      }

      if (current.subject === current.issuer) break;

      const urls = extractCaIssuerUrls(current);
      let nextCert: X509Certificate | null = null;

      for (const url of urls) {
        try {
          const certData = await fetchUrl(url);
          const pem = toPem(certData);
          if (pem) {
            nextCert = new X509Certificate(pem);
            break;
          }
        } catch {
          // ignore, try next AIA URL
        }
      }

      current = nextCert;
    }

    if (chain.length === 0) {
      return NextResponse.json({
        ok: false,
        error: `No intermediate/root certs found via AIA. The server cert is issued by "${leaf.issuer}" — you need to manually upload that CA certificate.`,
        chain: [{
          subject: leaf.subject,
          issuer: leaf.issuer,
        }],
      });
    }

    return NextResponse.json({
      ok: true,
      pems: chain.map((c) => c.pem),
      chain: chain.map((c) => ({ subject: c.subject, issuer: c.issuer })),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to detect certificates.",
    });
  }
}

function getLeafCert(hostname: string, port: number): Promise<X509Certificate | null> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: hostname, port, rejectUnauthorized: false, timeout: 10000 },
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
    socket.on("timeout", () => { socket.destroy(); resolve(null); });
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

function fetchUrl(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
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
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function toPem(data: Buffer): string | null {
  const str = data.toString("utf8");
  if (str.includes("-----BEGIN CERTIFICATE-----")) return str;
  try {
    const b64 = data.toString("base64");
    const lines: string[] = [];
    for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
    const pem = `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
    new X509Certificate(pem); // throws if the DER-to-PEM conversion produced garbage
    return pem;
  } catch {
    return null;
  }
}
