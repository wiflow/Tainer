import "server-only";

import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import type {
  SnmpDeviceSnapshot,
  SnmpSnapshotsStore,
} from "@/lib/lldp-snmp-types";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

const DATA_FILE = "lldp-snmp-snapshots.json";
const MAX_SNAPSHOTS_PER_SITE = 200;

function emptyStore(): SnmpSnapshotsStore {
  return { schemaVersion: 1, snapshots: [] };
}

async function readStore(): Promise<SnmpSnapshotsStore> {
  try {
    const raw = await readFile(await resolveDataFilePath(DATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<SnmpSnapshotsStore>;
    return {
      schemaVersion: 1,
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
    };
  } catch {
    return emptyStore();
  }
}

async function writeStore(store: SnmpSnapshotsStore): Promise<void> {
  const filePath = await resolveDataFilePath(DATA_FILE);
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("lldp-snmp-snapshots", readStore, writeStore);

/**
 * Upsert a snapshot keyed on `(siteId, chassisId)`. Each new push replaces
 * the previous snapshot for that chassis — SNMP walks are full inventories,
 * not deltas, so accumulating history doesn't add information. We do cap
 * the per-site total to MAX_SNAPSHOTS_PER_SITE so a runaway client can't
 * grow the file unbounded.
 */
export async function storeSnmpSnapshot(snapshot: SnmpDeviceSnapshot): Promise<void> {
  await mutateStore((store) => {
    const idx = store.snapshots.findIndex(
      (s) => s.siteId === snapshot.siteId && s.chassisId === snapshot.chassisId,
    );
    if (idx >= 0) {
      store.snapshots[idx] = snapshot;
    } else {
      store.snapshots.push(snapshot);
    }
    const perSite = store.snapshots.filter((s) => s.siteId === snapshot.siteId);
    if (perSite.length > MAX_SNAPSHOTS_PER_SITE) {
      // Drop the oldest entry for this site to stay within the cap. Rare —
      // means an agent is polling 200+ neighbours, which probably indicates
      // a misconfigured LLDP relay rather than a real topology.
      const oldest = perSite
        .slice()
        .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0];
      if (oldest) {
        const dropIdx = store.snapshots.findIndex(
          (s) => s.siteId === oldest.siteId && s.chassisId === oldest.chassisId,
        );
        if (dropIdx >= 0) store.snapshots.splice(dropIdx, 1);
      }
    }
  });
}

export async function getSnmpSnapshotForChassis(
  siteId: string,
  chassisId: string,
): Promise<SnmpDeviceSnapshot | null> {
  const store = await readStore();
  return (
    store.snapshots.find((s) => s.siteId === siteId && s.chassisId === chassisId) ??
    null
  );
}

export async function listSnmpSnapshotsForSite(
  siteId: string,
): Promise<SnmpDeviceSnapshot[]> {
  const store = await readStore();
  return store.snapshots.filter((s) => s.siteId === siteId);
}

export async function clearSnmpSnapshotsForSite(siteId: string): Promise<void> {
  await mutateStore((store) => {
    store.snapshots = store.snapshots.filter((s) => s.siteId !== siteId);
  });
}
