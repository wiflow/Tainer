import { NextRequest, NextResponse } from "next/server";
import type { X509Certificate } from "node:crypto";

import { fetchIssuerCert, getLeafCert } from "@/lib/aia-fetch";
import { requireAdminSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    return NextResponse.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

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
    const leaf = await getLeafCert(hostname, port, 10000);
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

      current = await fetchIssuerCert(current);
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
