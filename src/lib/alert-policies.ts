import "server-only";

import { randomUUID } from "node:crypto";

import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import type { AlertWebhookKind } from "@/lib/alert-settings";
import {
  createStoreMutator,
  readJsonFileCached,
  writeJsonFileAtomically,
} from "@/lib/store-utils";

export const ALERT_RULE_TYPES = [
  "deployment-offline",
  "deployment-high-cpu",
  "deployment-high-memory",
  "deployment-high-disk",
  "storage-unhealthy",
  "storage-low-space",
  "backup-stale",
  "node-high-cpu",
  "node-high-memory",
] as const;

export type AlertRuleType = (typeof ALERT_RULE_TYPES)[number];

export type AlertRuleConfig = {
  enabled: boolean;
  graceMinutes: number;
  thresholdHours?: number;
  thresholdPercent?: number;
  type: AlertRuleType;
};

export const RULE_META: Record<
  AlertRuleType,
  {
    category: "deployment" | "infrastructure";
    description: string;
    hasThresholdHours: boolean;
    hasThresholdPercent: boolean;
    label: string;
  }
> = {
  "backup-stale": {
    category: "infrastructure",
    description: "Alert when the latest backup age exceeds a threshold.",
    hasThresholdHours: true,
    hasThresholdPercent: false,
    label: "Backup stale",
  },
  "deployment-high-cpu": {
    category: "deployment",
    description: "Alert when a workload CPU usage exceeds a percentage threshold.",
    hasThresholdHours: false,
    hasThresholdPercent: true,
    label: "High CPU",
  },
  "deployment-high-disk": {
    category: "deployment",
    description: "Alert when a workload disk usage exceeds a percentage threshold.",
    hasThresholdHours: false,
    hasThresholdPercent: true,
    label: "High disk",
  },
  "deployment-high-memory": {
    category: "deployment",
    description: "Alert when a workload memory usage exceeds a percentage threshold.",
    hasThresholdHours: false,
    hasThresholdPercent: true,
    label: "High memory",
  },
  "deployment-offline": {
    category: "deployment",
    description: "Alert when a CT or VM is stopped, paused, or otherwise not running.",
    hasThresholdHours: false,
    hasThresholdPercent: false,
    label: "Workload offline",
  },
  "node-high-cpu": {
    category: "infrastructure",
    description: "Alert when a Proxmox node CPU usage exceeds a percentage threshold.",
    hasThresholdHours: false,
    hasThresholdPercent: true,
    label: "Node high CPU",
  },
  "node-high-memory": {
    category: "infrastructure",
    description: "Alert when a Proxmox node memory usage exceeds a percentage threshold.",
    hasThresholdHours: false,
    hasThresholdPercent: true,
    label: "Node high memory",
  },
  "storage-low-space": {
    category: "infrastructure",
    description: "Alert before a backup storage pool fills up completely.",
    hasThresholdHours: false,
    hasThresholdPercent: true,
    label: "Storage low space",
  },
  "storage-unhealthy": {
    category: "infrastructure",
    description: "Alert when a backup storage target is inaccessible or reporting issues.",
    hasThresholdHours: false,
    hasThresholdPercent: false,
    label: "Storage unhealthy",
  },
};

export type AlertPolicyScope = "all" | "tagged";

export type AlertPolicy = {
  checkIntervalMinutes: number;
  createdAt: string;
  description: string;
  enabled: boolean;
  id: string;
  lastCheckedAt: string | null;
  mentionUserUpns: string[];
  name: string;
  notifyOnce: boolean;
  reminderIntervalMinutes: number;
  resolveNotificationsEnabled: boolean;
  rules: AlertRuleConfig[];
  scope: AlertPolicyScope;
  tagSlugs: string[];
  updatedAt: string;
  webhookKind: AlertWebhookKind;
  webhookUrl: string;
};

export type AlertPolicyInput = Omit<
  AlertPolicy,
  "createdAt" | "id" | "lastCheckedAt" | "updatedAt"
>;

export function defaultRules(): AlertRuleConfig[] {
  return [
    { enabled: true, graceMinutes: 15, type: "deployment-offline" },
    { enabled: false, graceMinutes: 10, thresholdPercent: 90, type: "deployment-high-cpu" },
    { enabled: false, graceMinutes: 10, thresholdPercent: 90, type: "deployment-high-memory" },
    { enabled: false, graceMinutes: 10, thresholdPercent: 90, type: "deployment-high-disk" },
    { enabled: true, graceMinutes: 5, type: "storage-unhealthy" },
    { enabled: true, graceMinutes: 10, thresholdPercent: 90, type: "storage-low-space" },
    { enabled: true, graceMinutes: 0, thresholdHours: 24, type: "backup-stale" },
    { enabled: false, graceMinutes: 10, thresholdPercent: 90, type: "node-high-cpu" },
    { enabled: false, graceMinutes: 10, thresholdPercent: 90, type: "node-high-memory" },
  ];
}

type AlertPolicyStore = {
  policies: AlertPolicy[];
};

function normalizeRules(raw: unknown): AlertRuleConfig[] {
  if (!Array.isArray(raw)) return defaultRules();

  const ruleTypeSet = new Set<string>(ALERT_RULE_TYPES);
  const seen = new Set<string>();
  const rules: AlertRuleConfig[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Partial<AlertRuleConfig>;
    if (typeof r.type !== "string" || !ruleTypeSet.has(r.type)) continue;
    if (seen.has(r.type)) continue;
    seen.add(r.type);

    rules.push({
      enabled: typeof r.enabled === "boolean" ? r.enabled : false,
      graceMinutes:
        typeof r.graceMinutes === "number" && Number.isFinite(r.graceMinutes)
          ? Math.max(0, Math.round(r.graceMinutes))
          : 10,
      ...(r.thresholdHours != null &&
        typeof r.thresholdHours === "number" &&
        Number.isFinite(r.thresholdHours) && {
          thresholdHours: Math.max(1, Math.round(r.thresholdHours)),
        }),
      ...(r.thresholdPercent != null &&
        typeof r.thresholdPercent === "number" &&
        Number.isFinite(r.thresholdPercent) && {
          thresholdPercent: Math.max(1, Math.min(99, Math.round(r.thresholdPercent))),
        }),
      type: r.type as AlertRuleType,
    });
  }

  const defaults = defaultRules();
  for (const d of defaults) {
    if (!seen.has(d.type)) {
      rules.push(d);
    }
  }

  return rules;
}

function normalizePolicy(raw: Partial<AlertPolicy>): AlertPolicy {
  return {
    checkIntervalMinutes:
      typeof raw.checkIntervalMinutes === "number" && Number.isFinite(raw.checkIntervalMinutes)
        ? Math.max(1, Math.min(1440, Math.round(raw.checkIntervalMinutes)))
        : 5,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    description: typeof raw.description === "string" ? raw.description : "",
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    id: typeof raw.id === "string" ? raw.id : randomUUID(),
    lastCheckedAt: typeof raw.lastCheckedAt === "string" ? raw.lastCheckedAt : null,
    mentionUserUpns: Array.isArray(raw.mentionUserUpns)
      ? raw.mentionUserUpns.filter((u): u is string => typeof u === "string")
      : [],
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Unnamed policy",
    notifyOnce: typeof raw.notifyOnce === "boolean" ? raw.notifyOnce : false,
    reminderIntervalMinutes:
      typeof raw.reminderIntervalMinutes === "number" &&
      Number.isFinite(raw.reminderIntervalMinutes)
        ? Math.max(5, Math.min(10_080, Math.round(raw.reminderIntervalMinutes)))
        : 240,
    resolveNotificationsEnabled:
      typeof raw.resolveNotificationsEnabled === "boolean"
        ? raw.resolveNotificationsEnabled
        : true,
    rules: normalizeRules(raw.rules),
    scope: raw.scope === "tagged" ? "tagged" : "all",
    tagSlugs: Array.isArray(raw.tagSlugs)
      ? raw.tagSlugs.filter((s): s is string => typeof s === "string" && s.trim() !== "")
      : [],
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    webhookKind:
      raw.webhookKind === "generic" || raw.webhookKind === "teams"
        ? raw.webhookKind
        : "auto",
    webhookUrl: typeof raw.webhookUrl === "string" ? raw.webhookUrl.trim() : "",
  };
}

async function readStore(): Promise<AlertPolicyStore> {
  return readJsonFileCached(
    await resolveSiteDataFilePathFromContext("alert-policies.json"),
    {
      fallback: () => ({ policies: [] }),
      normalize: (parsed) => {
        const store = parsed as Partial<AlertPolicyStore>;
        return {
          policies: Array.isArray(store.policies)
            ? store.policies.map((policy) => normalizePolicy(policy as Partial<AlertPolicy>))
            : [],
        };
      },
    },
  );
}

async function writeStore(store: AlertPolicyStore) {
  const filePath = await resolveSiteDataFilePathFromContext("alert-policies.json");
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("alert-policies", readStore, writeStore);

export async function listAlertPolicies(): Promise<AlertPolicy[]> {
  const store = await readStore();
  return [...store.policies].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export async function getAlertPolicy(id: string): Promise<AlertPolicy | null> {
  const store = await readStore();
  return store.policies.find((p) => p.id === id) ?? null;
}

export async function createAlertPolicy(input: AlertPolicyInput): Promise<AlertPolicy> {
  return mutateStore((store) => {
    const timestamp = new Date().toISOString();
    const policy = normalizePolicy({
      ...input,
      createdAt: timestamp,
      id: randomUUID(),
      lastCheckedAt: null,
      updatedAt: timestamp,
    });
    store.policies.push(policy);
    return policy;
  });
}

export async function updateAlertPolicy(
  id: string,
  input: Partial<AlertPolicyInput>,
): Promise<AlertPolicy | null> {
  return mutateStore((store) => {
    const index = store.policies.findIndex((p) => p.id === id);
    if (index === -1) return null;

    const existing = store.policies[index];
    store.policies[index] = normalizePolicy({
      ...existing,
      ...input,
      id: existing.id,
      createdAt: existing.createdAt,
      lastCheckedAt: existing.lastCheckedAt,
      updatedAt: new Date().toISOString(),
    });
    return store.policies[index];
  });
}

export async function deleteAlertPolicy(id: string): Promise<boolean> {
  return mutateStore((store) => {
    const index = store.policies.findIndex((p) => p.id === id);
    if (index === -1) return false;
    store.policies.splice(index, 1);
    return true;
  });
}

export async function duplicateAlertPolicy(id: string): Promise<AlertPolicy | null> {
  return mutateStore((store) => {
    const source = store.policies.find((p) => p.id === id);
    if (!source) return null;

    const timestamp = new Date().toISOString();
    const policy: AlertPolicy = {
      ...source,
      createdAt: timestamp,
      enabled: false,
      id: randomUUID(),
      lastCheckedAt: null,
      name: `${source.name} (copy)`,
      updatedAt: timestamp,
    };
    store.policies.push(policy);
    return policy;
  });
}

export async function toggleAlertPolicy(
  id: string,
  enabled: boolean,
): Promise<AlertPolicy | null> {
  return mutateStore((store) => {
    const policy = store.policies.find((p) => p.id === id);
    if (!policy) return null;
    policy.enabled = enabled;
    policy.updatedAt = new Date().toISOString();
    return policy;
  });
}

export async function markPolicyChecked(
  id: string,
  checkedAt: string,
): Promise<void> {
  await mutateStore((store) => {
    const policy = store.policies.find((p) => p.id === id);
    if (policy) {
      policy.lastCheckedAt = checkedAt;
    }
  });
}

export function countEnabledRules(policy: AlertPolicy): number {
  return policy.rules.filter((r) => r.enabled).length;
}
