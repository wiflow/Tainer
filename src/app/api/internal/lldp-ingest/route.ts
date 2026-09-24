import { NextResponse } from "next/server";

import { recordThrottledAdminAudit } from "@/lib/admin-audit-log";
import {
  lookupLldpTokenByPlaintext,
  markLldpTokenUsed,
} from "@/lib/lldp-credentials";
import { recordLldpLinkEvents } from "@/lib/lldp-events";
import { parseLldpcliJson } from "@/lib/lldp-parser";
import { storeLldpSnapshot } from "@/lib/lldp-snapshots";
import { getClientIpForRateLimit } from "@/lib/proxy-trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 256 * 1024;
const MIN_PUSH_INTERVAL_MS = 30_000;
const MAX_AGENT_HOST_LEN = 253;

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

function clientIp(request: Request, resolved: string | undefined): string | null {
  if (resolved) return resolved;
  // Audit only: often 127.0.0.1 behind the proxy, so never rate limit on it.
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || null;
}

export async function POST(request: Request) {
  const plaintext = bearerToken(request);
  if (!plaintext) {
    return NextResponse.json({ error: "Bearer token required." }, { status: 401 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  const agentHostRaw = request.headers.get("x-lldp-agent") ?? "";
  const agentHost = agentHostRaw.trim().slice(0, MAX_AGENT_HOST_LEN);
  if (!/^[a-zA-Z0-9._-]+$/.test(agentHost)) {
    return NextResponse.json(
      { error: "X-Lldp-Agent header is required and must be a valid hostname." },
      { status: 400 },
    );
  }

  const token = await lookupLldpTokenByPlaintext(plaintext);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (token.revokedAt) {
    recordThrottledAdminAudit(`lldp-ingest-rejected:${token.id}`, {
      action: "lldp-ingest-rejected",
      actorEmail: "system",
      actorName: "LLDP ingest",
      message: `Revoked LLDP token used by agent ${agentHost} (token "${token.label}").`,
    }).catch(() => {});
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (token.lastUsedAt) {
    const sinceMs = Date.now() - new Date(token.lastUsedAt).getTime();
    if (Number.isFinite(sinceMs) && sinceMs >= 0 && sinceMs < MIN_PUSH_INTERVAL_MS) {
      return NextResponse.json(
        { error: "Push rate limit; minimum 30s between pushes per token." },
        { status: 429 },
      );
    }
  }

  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return NextResponse.json({ error: "Could not read body." }, { status: 400 });
  }
  if (bodyText.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const neighbors = parseLldpcliJson(parsedJson);

  const resolvedIp = await getClientIpForRateLimit();
  const sourceIp = clientIp(request, resolvedIp);
  const receivedAt = new Date().toISOString();

  const { previousNeighbors } = await storeLldpSnapshot({
    siteId: token.siteId,
    snapshot: {
      agentHost,
      collectedAt: receivedAt,
      receivedAt,
      sourceIp,
      neighbors,
    },
  });

  recordLldpLinkEvents({
    siteId: token.siteId,
    agentHost,
    prev: previousNeighbors,
    next: neighbors,
    observedAt: receivedAt,
  }).catch(() => {});
  markLldpTokenUsed({ tokenId: token.id, sourceIp }).catch(() => {});

  return NextResponse.json({ ok: true, neighborCount: neighbors.length });
}
