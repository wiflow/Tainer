import { NextResponse } from "next/server";

import { recordThrottledAdminAudit } from "@/lib/admin-audit-log";
import {
  lookupLldpTokenByPlaintext,
  markLldpTokenUsed,
} from "@/lib/lldp-credentials";
import { deriveTopology } from "@/lib/lldp-snapshots";
import { getLldpSnapshotsForSite } from "@/lib/lldp-snapshots";
import { parseSnmpWalk } from "@/lib/lldp-snmp-parser";
import { storeSnmpSnapshot } from "@/lib/lldp-snmp-snapshots";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// SNMP walks can be large — a 48-port switch with all the OIDs we ask for
// is ~25 KB raw text, base64 inflates that ~33%. 1 MB gives us headroom for
// a 200-port chassis or a multi-snapshot push from a relay.
const MAX_BODY_BYTES = 1_000_000;
const MIN_PUSH_INTERVAL_MS = 30_000;
const MAX_AGENT_HOST_LEN = 253;

type IngestSnapshot = {
  mgmtIp: string;
  walkBase64: string;
};

type IngestPayload = {
  agent?: string;
  snapshots: IngestSnapshot[];
};

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

function isIngestPayload(value: unknown): value is IngestPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.snapshots)) return false;
  return v.snapshots.every(
    (s) =>
      s &&
      typeof s === "object" &&
      typeof (s as Record<string, unknown>).mgmtIp === "string" &&
      typeof (s as Record<string, unknown>).walkBase64 === "string",
  );
}

function isValidIpv4(value: string): boolean {
  return (
    /^(\d{1,3}\.){3}\d{1,3}$/.test(value) &&
    value.split(".").every((o) => {
      const n = Number(o);
      return n >= 0 && n <= 255;
    })
  );
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
      actorName: "SNMP ingest",
      message: `Revoked LLDP token used by agent ${agentHost} (token "${token.label}") against SNMP ingest.`,
    }).catch(() => {});
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Note: SNMP and LLDP share a rate-limit budget via the shared token's
  // lastUsedAt timestamp. That's intentional — a misbehaving agent shouldn't
  // be able to evade rate limiting by alternating endpoints.
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
  if (!isIngestPayload(parsedJson)) {
    return NextResponse.json({ error: "Invalid payload shape." }, { status: 400 });
  }

  // Resolve mgmtIp → chassisId by looking at the site's most recent LLDP
  // snapshots. If a device's mgmt IP isn't in any LLDP advertisement, we
  // drop its SNMP snapshot — without a chassisId there's nothing in the
  // device list to attach it to.
  const lldpSnapshots = await getLldpSnapshotsForSite(token.siteId);
  const topology = deriveTopology(lldpSnapshots);
  const mgmtIpToChassis = new Map<string, string>();
  for (const dev of topology.devices) {
    if (dev.managementAddress) {
      mgmtIpToChassis.set(dev.managementAddress, dev.chassisId);
    }
  }

  const receivedAt = new Date().toISOString();
  let storedCount = 0;
  let droppedNoLldp = 0;
  let parseFailures = 0;

  for (const snap of parsedJson.snapshots) {
    const mgmtIp = snap.mgmtIp.trim();
    if (!isValidIpv4(mgmtIp)) {
      parseFailures++;
      continue;
    }
    const chassisId = mgmtIpToChassis.get(mgmtIp);
    if (!chassisId) {
      // Agent walked something we don't have LLDP data for. Discard rather
      // than store an orphan — without LLDP context we can't render it.
      droppedNoLldp++;
      continue;
    }

    let walkText: string;
    try {
      walkText = Buffer.from(snap.walkBase64, "base64").toString("utf8");
    } catch {
      parseFailures++;
      continue;
    }
    if (!walkText.trim()) {
      parseFailures++;
      continue;
    }

    const parsed = parseSnmpWalk(walkText);
    if (parsed.ports.length === 0 && !parsed.sysName) {
      // Empty walk — probably wrong community string or device returned no
      // ifTable. Not worth storing.
      parseFailures++;
      continue;
    }

    await storeSnmpSnapshot({
      siteId: token.siteId,
      chassisId,
      mgmtIp,
      sysName: parsed.sysName,
      sysDescr: parsed.sysDescr,
      agentHost,
      collectedAt: receivedAt,
      receivedAt,
      ports: parsed.ports,
    });
    storedCount++;
  }

  markLldpTokenUsed({ tokenId: token.id, sourceIp: null }).catch(() => {});

  return NextResponse.json({
    ok: true,
    stored: storedCount,
    droppedNoLldp,
    parseFailures,
  });
}
