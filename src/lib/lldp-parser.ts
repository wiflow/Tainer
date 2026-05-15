import "server-only";

import type { LldpNeighbor } from "@/lib/lldp-types";

/**
 * Tolerant parser for the JSON output of `lldpcli show neighbors -f json0`.
 *
 * `-f json0` is the stable variant: every field is wrapped in an array even
 * when it has one element. This parser also accepts the older `-f json`
 * shape (objects instead of single-element arrays) so an agent shipped at a
 * different time still works.
 *
 * Anything it can't recognise is dropped silently. Anything malformed
 * doesn't throw — callers receive an empty `neighbors` list and the ingest
 * endpoint stores the empty snapshot (legitimate state: the node is up but
 * has no LLDP neighbours).
 */
export function parseLldpcliJson(raw: unknown): LldpNeighbor[] {
  const lldp = pickObject(pickObject(raw)?.["lldp"]);
  if (!lldp) return [];

  const interfaces = toArray(lldp["interface"]);
  const neighbors: LldpNeighbor[] = [];

  for (const ifaceEntry of interfaces) {
    const iface = pickObject(ifaceEntry);
    if (!iface) continue;

    const localInterface = (
      pickFirstValue(iface["name"]) ??
      pickString(iface["name"]) ??
      ""
    ).trim();
    if (!localInterface) continue;

    const localMac = pickFirstValue(iface["via"]) ?? null;

    const chassisEntries = toArray(iface["chassis"]);
    const portEntries = toArray(iface["port"]);
    const vlanEntries = toArray(iface["vlan"]);
    const vlanId = parseVlanId(vlanEntries);

    // Each interface usually has exactly one chassis and one port from the
    // last neighbour — but we iterate to be safe with multi-neighbour cases.
    const pairCount = Math.max(chassisEntries.length, portEntries.length, 1);
    for (let i = 0; i < pairCount; i++) {
      const chassis = pickObject(chassisEntries[i]) ?? pickObject(chassisEntries[0]);
      const port = pickObject(portEntries[i]) ?? pickObject(portEntries[0]);
      if (!chassis && !port) continue;

      const chassisId = pickIdValue(chassis?.["id"]);
      const chassisIdSubtype = pickIdType(chassis?.["id"]);
      const portId = pickIdValue(port?.["id"]) ?? "";
      const portIdSubtype = pickIdType(port?.["id"]);
      if (!chassisId || !portId) continue;

      neighbors.push({
        localInterface,
        localMac: localMac,
        chassisId,
        chassisIdSubtype,
        portId,
        portIdSubtype,
        portDescription: pickFirstValue(port?.["descr"]),
        systemName: pickFirstValue(chassis?.["name"]),
        systemDescription: pickFirstValue(chassis?.["descr"]),
        capabilities: pickCapabilities(chassis?.["capability"]),
        managementAddress: pickFirstValue(chassis?.["mgmt-ip"]),
        vlanId,
        ttlSeconds: pickNumber(port?.["ttl"]),
      });
    }
  }

  return neighbors;
}

function pickObject(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function toArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

function pickString(v: unknown): string | null {
  if (typeof v === "string") return v;
  return null;
}

/**
 * lldpcli wraps scalar fields as `[{"value": "..."}]` in json0 mode and
 * `{"value": "..."}` in json mode. Some fields are bare strings. Walk
 * defensively.
 */
function pickFirstValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    for (const item of v) {
      const r = pickFirstValue(item);
      if (r != null) return r;
    }
    return null;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o["value"] === "string") return o["value"];
    if (typeof o["value"] === "number") return String(o["value"]);
  }
  return null;
}

function pickNumber(v: unknown): number | null {
  const s = pickFirstValue(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function pickIdValue(v: unknown): string | null {
  if (v == null) return null;
  // `id` is typically `[{ "type": "mac", "value": "..." }]` in json0.
  if (Array.isArray(v)) {
    for (const item of v) {
      const r = pickIdValue(item);
      if (r != null) return r;
    }
    return null;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o["value"] === "string") return o["value"];
  }
  return pickFirstValue(v);
}

function pickIdType(v: unknown): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) {
    for (const item of v) {
      const r = pickIdType(item);
      if (r != null) return r;
    }
    return null;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o["type"] === "string") return o["type"];
  }
  return null;
}

function pickCapabilities(v: unknown): string[] {
  const out: string[] = [];
  if (v == null) return out;
  const items = toArray(v);
  for (const item of items) {
    if (typeof item === "string") {
      out.push(item.toLowerCase());
      continue;
    }
    const obj = pickObject(item);
    if (!obj) continue;
    const enabled = obj["enabled"];
    if (enabled === false) continue;
    const type = typeof obj["type"] === "string" ? (obj["type"] as string) : null;
    if (type) out.push(type.toLowerCase());
  }
  return Array.from(new Set(out));
}

function parseVlanId(entries: unknown[]): number | null {
  for (const entry of entries) {
    const obj = pickObject(entry);
    if (!obj) continue;
    const id = obj["vlan-id"] ?? obj["vid"] ?? obj["id"];
    if (typeof id === "string") {
      const n = Number(id);
      if (Number.isFinite(n)) return n;
    } else if (typeof id === "number" && Number.isFinite(id)) {
      return id;
    }
  }
  return null;
}
