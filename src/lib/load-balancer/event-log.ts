import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

/**
 * Persistent activity log for the load balancer. Previously every event
 * (migrations triggered, circuit breakers opening/closing, tick errors)
 * lived only on globalThis and vanished on restart. This store writes
 * each event to a per-site JSON file so an admin can audit what the LB
 * actually did over time, not just "what's pending right now".
 *
 * Capped at MAX_ENTRIES (10,000) to keep the file from growing unbounded
 * — that's enough headroom for the LB to fire ~30 events/day every day
 * for a year before pruning kicks in. Events are pruned by count, not
 * by time, so a quiet cluster keeps history indefinitely.
 */

export type LbEventCategory =
  | "migration-triggered"
  | "migration-failed"
  | "circuit-breaker-opened"
  | "circuit-breaker-closed"
  | "tick-error"
  | "settings-changed";

export type LbEventLevel = "info" | "warning" | "destructive";

export type LoadBalancerEventEntry = {
  category: LbEventCategory;
  /**
   * Optional structured detail blob shown in the expanded row view.
   * Keep small (<2KB serialized) — this lives in a JSON file that gets
   * fully read on every list call.
   */
  details?: Record<string, unknown>;
  id: string;
  level: LbEventLevel;
  message: string;
  /** Node name for events scoped to a single host. Null for cluster-wide. */
  node: string | null;
  recordedAt: string;
  /**
   * Site context. Per-site storage means siteId is implicit in the file
   * path, but we keep it on each entry too in case events are ever shown
   * across sites (e.g. a global LB activity feed).
   */
  siteId: string;
  siteName: string;
  /** Workload VMID for migration events; null for everything else. */
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

/**
 * Append an event to the log. Newest first; oldest pruned only after
 * MAX_ENTRIES. Caller MUST be inside a withSiteConfig context — the
 * file path is resolved from `getActiveSiteConfig()`.
 */
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
