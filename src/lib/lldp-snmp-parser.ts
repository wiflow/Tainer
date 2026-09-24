import type {
  SnmpAdminStatus,
  SnmpOperStatus,
  SnmpPort,
} from "@/lib/lldp-snmp-types";

const LINE_RX = /^(\w+)\.(\d+)\s+(?:[A-Z][A-Z0-9_-]*:\s*)?(.*)$/;

const OPER_STATUS_MAP: Record<string, SnmpOperStatus> = {
  "1": "up",
  "2": "down",
  "3": "testing",
  "4": "unknown",
  "5": "dormant",
  "6": "notPresent",
  "7": "lowerLayerDown",
  up: "up",
  down: "down",
  testing: "testing",
  unknown: "unknown",
  dormant: "dormant",
  notpresent: "notPresent",
  lowerlayerdown: "lowerLayerDown",
};

const ADMIN_STATUS_MAP: Record<string, SnmpAdminStatus> = {
  "1": "up",
  "2": "down",
  "3": "testing",
  up: "up",
  down: "down",
  testing: "testing",
};

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

type WalkBuckets = {
  sysName: string | null;
  sysDescr: string | null;
  ports: Map<number, Partial<SnmpPort>>;
};

function bucketFor(buckets: WalkBuckets, index: number): Partial<SnmpPort> {
  let entry = buckets.ports.get(index);
  if (!entry) {
    entry = { index };
    buckets.ports.set(index, entry);
  }
  return entry;
}

export type ParsedWalk = {
  sysName: string | null;
  sysDescr: string | null;
  ports: SnmpPort[];
};

export function parseSnmpWalk(text: string): ParsedWalk {
  const buckets: WalkBuckets = {
    sysName: null,
    sysDescr: null,
    ports: new Map(),
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("sysName.0")) {
      buckets.sysName = stripQuotes(line.slice("sysName.0".length).trim());
      continue;
    }
    if (line.startsWith("sysDescr.0")) {
      buckets.sysDescr = stripQuotes(line.slice("sysDescr.0".length).trim());
      continue;
    }

    const m = LINE_RX.exec(line);
    if (!m) continue;

    const oidName = m[1];
    const index = Number(m[2]);
    const value = stripQuotes(m[3]);
    if (!Number.isFinite(index) || index <= 0) continue;

    const entry = bucketFor(buckets, index);

    switch (oidName) {
      case "ifDescr":
        entry.name = value;
        break;
      case "ifAlias":
        entry.alias = value;
        break;
      case "ifOperStatus":
        entry.operStatus = OPER_STATUS_MAP[value.toLowerCase()] ?? "unknown";
        break;
      case "ifAdminStatus":
        entry.adminStatus = ADMIN_STATUS_MAP[value.toLowerCase()] ?? "unknown";
        break;
      case "ifSpeed": {
        // ifSpeed saturates at 4294967295 bps on fast links; ifHighSpeed (Mbps) wins there.
        const n = parseNumber(value);
        if (n !== null && n !== 4294967295 && entry.speedBps == null) {
          entry.speedBps = n;
        }
        break;
      }
      case "ifHighSpeed": {
        const n = parseNumber(value);
        if (n !== null && n > 0) entry.speedBps = n * 1_000_000;
        break;
      }
      case "ifType": {
        const n = parseNumber(value);
        if (n !== null) entry.type = n;
        break;
      }
      case "ifMtu": {
        const n = parseNumber(value);
        if (n !== null) entry.mtu = n;
        break;
      }
      default:
        break;
    }
  }

  const ports: SnmpPort[] = [];
  for (const partial of buckets.ports.values()) {
    if (!partial.name) continue;
    ports.push({
      index: partial.index ?? 0,
      name: partial.name,
      alias: partial.alias ?? "",
      operStatus: partial.operStatus ?? "unknown",
      adminStatus: partial.adminStatus ?? "unknown",
      speedBps: partial.speedBps ?? null,
      type: partial.type ?? null,
      mtu: partial.mtu ?? null,
    });
  }
  ports.sort((a, b) => a.index - b.index);

  return {
    sysName: buckets.sysName,
    sysDescr: buckets.sysDescr,
    ports,
  };
}
