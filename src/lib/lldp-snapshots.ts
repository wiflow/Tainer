import "server-only";

import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import type {
  LldpDevice,
  LldpDevicePort,
  LldpNeighbor,
  LldpSiteSnapshots,
  LldpSnapshot,
  LldpTopology,
  LldpTopologyEdge,
} from "@/lib/lldp-types";
import {
  createStoreMutator,
  writeJsonFileAtomically,
} from "@/lib/store-utils";

const DATA_FILE = "lldp-snapshots.json";
const MAX_NEIGHBORS_PER_SNAPSHOT = 512;

type Store = {
  schemaVersion: 1;
  /** Keyed by siteId. */
  sites: Record<string, LldpSiteSnapshots>;
};

function emptyStore(): Store {
  return { schemaVersion: 1, sites: {} };
}

async function readStore(): Promise<Store> {
  try {
    const raw = await readFile(await resolveDataFilePath(DATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      schemaVersion: 1,
      sites: parsed.sites && typeof parsed.sites === "object" ? parsed.sites : {},
    };
  } catch {
    return emptyStore();
  }
}

async function writeStore(store: Store): Promise<void> {
  const filePath = await resolveDataFilePath(DATA_FILE);
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("lldp-snapshots", readStore, writeStore);

function normalizeChassisId(raw: string): string {
  const trimmed = raw.trim();
  // Heuristic: looks like a MAC if 12 hex chars with optional separators.
  const hex = trimmed.replace(/[:.\- ]/g, "").toLowerCase();
  if (/^[0-9a-f]{12}$/.test(hex)) {
    return hex.match(/.{2}/g)!.join(":");
  }
  return trimmed;
}

function clamp<T>(arr: T[], max: number): T[] {
  return arr.length > max ? arr.slice(0, max) : arr;
}

export async function storeLldpSnapshot(input: {
  siteId: string;
  snapshot: LldpSnapshot;
}): Promise<{ previousNeighbors: LldpSnapshot["neighbors"] | null }> {
  const snapshot: LldpSnapshot = {
    ...input.snapshot,
    neighbors: clamp(
      input.snapshot.neighbors.map((n) => ({
        ...n,
        chassisId: normalizeChassisId(n.chassisId),
      })),
      MAX_NEIGHBORS_PER_SNAPSHOT,
    ),
  };

  return mutateStore((store) => {
    const site = store.sites[input.siteId] ?? { hosts: {} };
    const previous = site.hosts[snapshot.agentHost] ?? null;
    site.hosts[snapshot.agentHost] = snapshot;
    store.sites[input.siteId] = site;
    return { previousNeighbors: previous?.neighbors ?? null };
  });
}

export async function getLldpSnapshotsForSite(
  siteId: string,
): Promise<LldpSiteSnapshots> {
  const store = await readStore();
  return store.sites[siteId] ?? { hosts: {} };
}

export async function clearLldpSnapshotsForSite(siteId: string): Promise<void> {
  await mutateStore((store) => {
    delete store.sites[siteId];
  });
}

/**
 * Derive the topology graph from the latest snapshot per agent host.
 *
 * Aggregation rules (deliberately simple):
 *   - One device per remote chassisId.
 *   - Device fields take the most-recently-seen non-null value.
 *   - Each remote portId becomes one entry on the device; the local-side
 *     endpoint is the most recent observation.
 *   - Capabilities are union'd across observations.
 */
export function deriveTopology(snapshots: LldpSiteSnapshots): LldpTopology {
  const devices = new Map<string, LldpDevice>();
  const edges: LldpTopologyEdge[] = [];
  const agents: string[] = [];
  let freshestAt: string | null = null;

  const hostEntries = Object.entries(snapshots.hosts).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  for (const [agentHost, snapshot] of hostEntries) {
    agents.push(agentHost);
    if (!freshestAt || snapshot.receivedAt > freshestAt) {
      freshestAt = snapshot.receivedAt;
    }

    for (const n of snapshot.neighbors) {
      const observedAt = snapshot.receivedAt;
      const existing = devices.get(n.chassisId);
      const port = buildPort(n, agentHost, observedAt);

      if (existing) {
        existing.lastSeenAt = observedAt > existing.lastSeenAt ? observedAt : existing.lastSeenAt;
        if (observedAt < existing.firstSeenAt) existing.firstSeenAt = observedAt;
        existing.systemName = preferLatest(existing.systemName, n.systemName, observedAt, existing.lastSeenAt);
        existing.systemDescription = preferLatest(existing.systemDescription, n.systemDescription, observedAt, existing.lastSeenAt);
        existing.managementAddress = preferLatest(existing.managementAddress, n.managementAddress, observedAt, existing.lastSeenAt);
        existing.capabilities = uniq([...existing.capabilities, ...n.capabilities]);
        existing.ports[port.portId] = port;
      } else {
        devices.set(n.chassisId, {
          chassisId: n.chassisId,
          systemName: n.systemName,
          systemDescription: n.systemDescription,
          capabilities: [...n.capabilities],
          managementAddress: n.managementAddress,
          firstSeenAt: observedAt,
          lastSeenAt: observedAt,
          ports: { [port.portId]: port },
        });
      }

      edges.push({
        agentHost,
        localInterface: n.localInterface,
        chassisId: n.chassisId,
        portId: n.portId,
        vlanId: n.vlanId,
        lastSeenAt: observedAt,
      });
    }
  }

  return {
    agents,
    devices: Array.from(devices.values()).sort((a, b) =>
      (a.systemName ?? a.chassisId).localeCompare(b.systemName ?? b.chassisId),
    ),
    edges,
    freshestAt,
  };
}

function buildPort(
  n: LldpNeighbor,
  agentHost: string,
  observedAt: string,
): LldpDevicePort {
  return {
    portId: n.portId,
    portDescription: n.portDescription,
    vlanId: n.vlanId,
    connectedTo: {
      agentHost,
      localInterface: n.localInterface,
      speedHint: null,
    },
    lastSeenAt: observedAt,
  };
}

function preferLatest<T>(
  prev: T | null,
  next: T | null,
  nextAt: string,
  prevAt: string,
): T | null {
  if (next == null) return prev;
  if (prev == null) return next;
  return nextAt >= prevAt ? next : prev;
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
