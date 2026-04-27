import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { computeNextRunAt } from "@/lib/scheduler-utils";
import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

export type BackupCompression = "none" | "lzo" | "gzip" | "zstd";
export type BackupMode = "snapshot" | "suspend" | "stop";
export type BackupPolicyScope = "all" | "tagged";

export type BackupPolicy = {
  compression: BackupCompression;
  createdAt: string;
  description: string;
  enabled: boolean;
  id: string;
  intervalMinutes: number;
  lastRunAt: string | null;
  mode: BackupMode;
  name: string;
  nextRunAt: string | null;
  retentionCount: number;
  scope: BackupPolicyScope;
  storage: string;
  tagSlugs: string[];
  updatedAt: string;
};

export type BackupPolicyInput = Omit<
  BackupPolicy,
  "createdAt" | "id" | "lastRunAt" | "nextRunAt" | "updatedAt"
>;

export const INTERVAL_OPTIONS = [
  { label: "Every 6 hours", value: 360 },
  { label: "Every 12 hours", value: 720 },
  { label: "Every 24 hours", value: 1440 },
  { label: "Every 48 hours", value: 2880 },
  { label: "Weekly", value: 10080 },
] as const;

export const COMPRESSION_OPTIONS: { label: string; value: BackupCompression }[] = [
  { label: "zstd (recommended)", value: "zstd" },
  { label: "gzip", value: "gzip" },
  { label: "lzo", value: "lzo" },
  { label: "None", value: "none" },
];

export const MODE_OPTIONS: { label: string; value: BackupMode }[] = [
  { label: "Snapshot (no downtime)", value: "snapshot" },
  { label: "Suspend (brief pause)", value: "suspend" },
  { label: "Stop (full stop)", value: "stop" },
];

type BackupPolicyStore = {
  policies: BackupPolicy[];
};

function normalizePolicy(raw: Partial<BackupPolicy>): BackupPolicy {
  const validCompressions: BackupCompression[] = ["none", "lzo", "gzip", "zstd"];
  const validModes: BackupMode[] = ["snapshot", "suspend", "stop"];

  return {
    compression: validCompressions.includes(raw.compression as BackupCompression)
      ? (raw.compression as BackupCompression)
      : "zstd",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    description: typeof raw.description === "string" ? raw.description : "",
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    id: typeof raw.id === "string" ? raw.id : randomUUID(),
    intervalMinutes:
      typeof raw.intervalMinutes === "number" && Number.isFinite(raw.intervalMinutes)
        ? Math.max(60, Math.round(raw.intervalMinutes))
        : 1440,
    lastRunAt: typeof raw.lastRunAt === "string" ? raw.lastRunAt : null,
    mode: validModes.includes(raw.mode as BackupMode)
      ? (raw.mode as BackupMode)
      : "snapshot",
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Unnamed policy",
    nextRunAt: typeof raw.nextRunAt === "string" ? raw.nextRunAt : null,
    retentionCount:
      typeof raw.retentionCount === "number" && Number.isFinite(raw.retentionCount)
        ? Math.max(0, Math.round(raw.retentionCount))
        : 0,
    scope: raw.scope === "tagged" ? "tagged" : "all",
    storage: typeof raw.storage === "string" ? raw.storage.trim() : "",
    tagSlugs: Array.isArray(raw.tagSlugs)
      ? raw.tagSlugs.filter((s): s is string => typeof s === "string" && s.trim() !== "")
      : [],
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  };
}

async function readStore(): Promise<BackupPolicyStore> {
  try {
    const raw = await readFile(
      await resolveSiteDataFilePathFromContext("backup-policies.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<BackupPolicyStore>;

    return {
      policies: Array.isArray(parsed.policies)
        ? parsed.policies.map((p) => normalizePolicy(p as Partial<BackupPolicy>))
        : [],
    };
  } catch {
    return { policies: [] };
  }
}

async function writeStore(store: BackupPolicyStore) {
  const filePath = await resolveSiteDataFilePathFromContext("backup-policies.json");
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("backup-policies", readStore, writeStore);

export async function listBackupPolicies(): Promise<BackupPolicy[]> {
  const store = await readStore();
  return [...store.policies].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export async function getBackupPolicy(id: string): Promise<BackupPolicy | null> {
  const store = await readStore();
  return store.policies.find((p) => p.id === id) ?? null;
}

export async function createBackupPolicy(input: BackupPolicyInput): Promise<BackupPolicy> {
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

export async function updateBackupPolicy(
  id: string,
  input: Partial<BackupPolicyInput>,
): Promise<BackupPolicy | null> {
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

export async function deleteBackupPolicy(id: string): Promise<boolean> {
  return mutateStore((store) => {
    const index = store.policies.findIndex((p) => p.id === id);
    if (index === -1) return false;
    store.policies.splice(index, 1);
    return true;
  });
}

export async function duplicateBackupPolicy(id: string): Promise<BackupPolicy | null> {
  return mutateStore((store) => {
    const source = store.policies.find((p) => p.id === id);
    if (!source) return null;

    const timestamp = new Date().toISOString();
    const policy: BackupPolicy = {
      ...source,
      createdAt: timestamp,
      enabled: false,
      id: randomUUID(),
      lastRunAt: null,
      name: `${source.name} (copy)`,
      nextRunAt: computeNextRunAt(null, source.intervalMinutes),
      updatedAt: timestamp,
    };
    store.policies.push(policy);
    return policy;
  });
}

export async function toggleBackupPolicy(
  id: string,
  enabled: boolean,
): Promise<BackupPolicy | null> {
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

export async function markPolicyRun(
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

export function formatIntervalLabel(minutes: number): string {
  const match = INTERVAL_OPTIONS.find((o) => o.value === minutes);
  if (match) return match.label;
  if (minutes < 60) return `Every ${minutes}m`;
  if (minutes < 1440) return `Every ${Math.round(minutes / 60)}h`;
  return `Every ${Math.round(minutes / 1440)}d`;
}
