import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";
import type { ConfigSnapshotPolicyView } from "@/lib/config-snapshot-shared";

export type ConfigSnapshotPolicy = ConfigSnapshotPolicyView;

export {
  CONFIG_SNAPSHOT_INTERVAL_OPTIONS,
  formatConfigIntervalLabel,
} from "@/lib/config-snapshot-shared";

export type ConfigSnapshotPolicyInput = Omit<
  ConfigSnapshotPolicy,
  "createdAt" | "id" | "lastRunAt" | "nextRunAt" | "updatedAt"
>;

type ConfigSnapshotPolicyStore = {
  policies: ConfigSnapshotPolicy[];
};

function normalizePolicy(raw: Partial<ConfigSnapshotPolicy>): ConfigSnapshotPolicy {
  return {
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    description: typeof raw.description === "string" ? raw.description : "",
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    id: typeof raw.id === "string" ? raw.id : randomUUID(),
    intervalMinutes:
      typeof raw.intervalMinutes === "number" && Number.isFinite(raw.intervalMinutes)
        ? Math.max(15, Math.round(raw.intervalMinutes))
        : 1440,
    lastRunAt: typeof raw.lastRunAt === "string" ? raw.lastRunAt : null,
    name:
      typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Unnamed schedule",
    nextRunAt: typeof raw.nextRunAt === "string" ? raw.nextRunAt : null,
    nodeName: typeof raw.nodeName === "string" ? raw.nodeName.trim() : "",
    retentionCount:
      typeof raw.retentionCount === "number" && Number.isFinite(raw.retentionCount)
        ? Math.max(0, Math.round(raw.retentionCount))
        : 14,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  };
}

function computeNextRunAt(lastRunAt: string | null, intervalMinutes: number): string {
  const baseMs = lastRunAt ? new Date(lastRunAt).getTime() : Date.now();
  return new Date(baseMs + intervalMinutes * 60_000).toISOString();
}

async function readStore(): Promise<ConfigSnapshotPolicyStore> {
  try {
    const raw = await readFile(
      await resolveSiteDataFilePathFromContext("config-snapshot-policies.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<ConfigSnapshotPolicyStore>;
    return {
      policies: Array.isArray(parsed.policies)
        ? parsed.policies.map((p) => normalizePolicy(p as Partial<ConfigSnapshotPolicy>))
        : [],
    };
  } catch {
    return { policies: [] };
  }
}

async function writeStore(store: ConfigSnapshotPolicyStore) {
  const filePath = await resolveSiteDataFilePathFromContext("config-snapshot-policies.json");
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator(
  "config-snapshot-policies",
  readStore,
  writeStore,
);

export async function listConfigSnapshotPolicies(): Promise<ConfigSnapshotPolicy[]> {
  const store = await readStore();
  return [...store.policies].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export async function getConfigSnapshotPolicy(
  id: string,
): Promise<ConfigSnapshotPolicy | null> {
  const store = await readStore();
  return store.policies.find((p) => p.id === id) ?? null;
}

export async function createConfigSnapshotPolicy(
  input: ConfigSnapshotPolicyInput,
): Promise<ConfigSnapshotPolicy> {
  return mutateStore((store) => {
    const timestamp = new Date().toISOString();
    const policy = normalizePolicy({
      ...input,
      createdAt: timestamp,
      id: randomUUID(),
      lastRunAt: null,
      nextRunAt: computeNextRunAt(null, input.intervalMinutes),
      updatedAt: timestamp,
    });
    store.policies.push(policy);
    return policy;
  });
}

export async function updateConfigSnapshotPolicy(
  id: string,
  input: Partial<ConfigSnapshotPolicyInput>,
): Promise<ConfigSnapshotPolicy | null> {
  return mutateStore((store) => {
    const index = store.policies.findIndex((p) => p.id === id);
    if (index === -1) return null;

    const existing = store.policies[index];
    const updated = normalizePolicy({
      ...existing,
      ...input,
      id: existing.id,
      createdAt: existing.createdAt,
      lastRunAt: existing.lastRunAt,
      updatedAt: new Date().toISOString(),
    });
    if (input.intervalMinutes && input.intervalMinutes !== existing.intervalMinutes) {
      updated.nextRunAt = computeNextRunAt(existing.lastRunAt, input.intervalMinutes);
    }
    store.policies[index] = updated;
    return store.policies[index];
  });
}

export async function deleteConfigSnapshotPolicy(id: string): Promise<boolean> {
  return mutateStore((store) => {
    const index = store.policies.findIndex((p) => p.id === id);
    if (index === -1) return false;
    store.policies.splice(index, 1);
    return true;
  });
}

export async function toggleConfigSnapshotPolicy(
  id: string,
  enabled: boolean,
): Promise<ConfigSnapshotPolicy | null> {
  return mutateStore((store) => {
    const policy = store.policies.find((p) => p.id === id);
    if (!policy) return null;
    policy.enabled = enabled;
    policy.updatedAt = new Date().toISOString();
    if (enabled && !policy.nextRunAt) {
      policy.nextRunAt = computeNextRunAt(policy.lastRunAt, policy.intervalMinutes);
    }
    return policy;
  });
}

export async function markConfigSnapshotPolicyRun(
  id: string,
  runAt: string,
): Promise<void> {
  await mutateStore((store) => {
    const policy = store.policies.find((p) => p.id === id);
    if (policy) {
      policy.lastRunAt = runAt;
      policy.nextRunAt = computeNextRunAt(runAt, policy.intervalMinutes);
    }
  });
}

/**
 * Mark a policy as immediately due (sets nextRunAt to now). Other policies are
 * untouched, so the next tick will only fire the forced one.
 */
export async function forceConfigSnapshotPolicyDue(id: string): Promise<boolean> {
  return mutateStore((store) => {
    const policy = store.policies.find((p) => p.id === id);
    if (!policy) return false;
    policy.nextRunAt = new Date().toISOString();
    return true;
  });
}
