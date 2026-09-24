import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import type { LldpNeighbor } from "@/lib/lldp-types";
import {
  createStoreMutator,
  writeJsonFileAtomically,
} from "@/lib/store-utils";

const DATA_FILE = "lldp-events.json";
const MAX_EVENTS = 10_000;

export type LldpEventKind = "link-up" | "link-down";

export type LldpEvent = {
  id: string;
  siteId: string;
  agentHost: string;
  localInterface: string;
  chassisId: string;
  portId: string;
  systemName: string | null;
  kind: LldpEventKind;
  observedAt: string;
};

type Store = {
  schemaVersion: 1;
  events: LldpEvent[];
};

function emptyStore(): Store {
  return { schemaVersion: 1, events: [] };
}

async function readStore(): Promise<Store> {
  try {
    const raw = await readFile(await resolveDataFilePath(DATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      schemaVersion: 1,
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch {
    return emptyStore();
  }
}

async function writeStore(store: Store): Promise<void> {
  const filePath = await resolveDataFilePath(DATA_FILE);
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("lldp-events", readStore, writeStore);

export function diffNeighbors(
  prev: LldpNeighbor[] | null,
  next: LldpNeighbor[],
): { added: Array<{ chassisId: string; portId: string; localInterface: string; systemName: string | null }>;
     removed: Array<{ chassisId: string; portId: string; localInterface: string; systemName: string | null }>; } {
  if (prev == null) return { added: [], removed: [] };

  const key = (n: { chassisId: string; portId: string }) => `${n.chassisId}\x1f${n.portId}`;
  const prevByKey = new Map(prev.map((n) => [key(n), n]));
  const nextByKey = new Map(next.map((n) => [key(n), n]));

  const added: Array<{ chassisId: string; portId: string; localInterface: string; systemName: string | null }> = [];
  const removed: Array<{ chassisId: string; portId: string; localInterface: string; systemName: string | null }> = [];

  for (const [k, n] of nextByKey) {
    if (!prevByKey.has(k)) {
      added.push({
        chassisId: n.chassisId,
        portId: n.portId,
        localInterface: n.localInterface,
        systemName: n.systemName,
      });
    }
  }
  for (const [k, n] of prevByKey) {
    if (!nextByKey.has(k)) {
      removed.push({
        chassisId: n.chassisId,
        portId: n.portId,
        localInterface: n.localInterface,
        systemName: n.systemName,
      });
    }
  }
  return { added, removed };
}

export async function recordLldpLinkEvents(input: {
  siteId: string;
  agentHost: string;
  prev: LldpNeighbor[] | null;
  next: LldpNeighbor[];
  observedAt: string;
}): Promise<number> {
  const { added, removed } = diffNeighbors(input.prev, input.next);
  if (added.length === 0 && removed.length === 0) return 0;

  return mutateStore((store) => {
    for (const a of added) {
      store.events.unshift({
        id: randomUUID(),
        siteId: input.siteId,
        agentHost: input.agentHost,
        localInterface: a.localInterface,
        chassisId: a.chassisId,
        portId: a.portId,
        systemName: a.systemName,
        kind: "link-up",
        observedAt: input.observedAt,
      });
    }
    for (const r of removed) {
      store.events.unshift({
        id: randomUUID(),
        siteId: input.siteId,
        agentHost: input.agentHost,
        localInterface: r.localInterface,
        chassisId: r.chassisId,
        portId: r.portId,
        systemName: r.systemName,
        kind: "link-down",
        observedAt: input.observedAt,
      });
    }
    if (store.events.length > MAX_EVENTS) {
      store.events = store.events.slice(0, MAX_EVENTS);
    }
    return added.length + removed.length;
  });
}

export async function listLldpEventsForSite(
  siteId: string,
  options?: { chassisId?: string; limit?: number },
): Promise<LldpEvent[]> {
  const store = await readStore();
  let events = store.events.filter((e) => e.siteId === siteId);
  if (options?.chassisId) {
    events = events.filter((e) => e.chassisId === options.chassisId);
  }
  const limit = options?.limit ?? 200;
  return events.slice(0, limit);
}
