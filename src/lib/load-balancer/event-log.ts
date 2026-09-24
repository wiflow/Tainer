import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

export type LbEventCategory =
  | "migration-triggered"
  | "migration-recommended"
  | "migration-failed"
  | "drain-warning"
  | "rebalance-plan"
  | "circuit-breaker-opened"
  | "circuit-breaker-closed"
  | "tick-error"
  | "settings-changed";

export type LbEventLevel = "info" | "warning" | "destructive";

export type LoadBalancerEventEntry = {
  category: LbEventCategory;
  details?: Record<string, unknown>;
  id: string;
  level: LbEventLevel;
  message: string;
  node: string | null;
  recordedAt: string;
  siteId: string;
  siteName: string;
  vmid: number | null;
};

const MAX_ENTRIES = 10_000;
const DATA_FILE = "load-balancer-events.json";

type LbEventStore = {
  entries: LoadBalancerEventEntry[];
};

async function readStore(): Promise<LbEventStore> {
  try {
    const raw = await readFile(
      await resolveSiteDataFilePathFromContext(DATA_FILE),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<LbEventStore>;
    return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    return { entries: [] };
  }
}

async function writeStore(store: LbEventStore) {
  const filePath = await resolveSiteDataFilePathFromContext(DATA_FILE);
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("load-balancer-events", readStore, writeStore);

export type RecordLbEventInput = Omit<LoadBalancerEventEntry, "id" | "recordedAt">;

/** Must run inside a withSiteConfig context, which decides the file path. */
export async function recordLbEvent(
  input: RecordLbEventInput,
): Promise<LoadBalancerEventEntry> {
  const entry: LoadBalancerEventEntry = {
    ...input,
    id: randomUUID(),
    recordedAt: new Date().toISOString(),
  };
  return mutateStore((store) => {
    store.entries.unshift(entry);
    if (store.entries.length > MAX_ENTRIES) {
      store.entries = store.entries.slice(0, MAX_ENTRIES);
    }
    return entry;
  });
}

export async function listLbEvents(
  limit = 1000,
): Promise<LoadBalancerEventEntry[]> {
  const store = await readStore();
  return store.entries.slice(0, limit);
}
