import "server-only";

import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import type { AlertWebhookKind } from "@/lib/alert-settings";
import { writeJsonFileAtomically } from "@/lib/store-utils";

export type HeartbeatSettings = {
  checkIntervalSeconds: number;
  enabled: boolean;
  graceMinutes: number;
  mentionUserUpns: string[];
  nodeHighCpuThreshold: number;
  nodeHighMemoryThreshold: number;
  reminderIntervalMinutes: number;
  resolveNotificationsEnabled: boolean;
  stalenessThresholdMinutes: number;
  updatedAt: string | null;
  webhookKind: AlertWebhookKind;
  webhookUrl: string;
};

const DEFAULTS: HeartbeatSettings = {
  checkIntervalSeconds: 60,
  enabled: false,
  graceMinutes: 2,
  mentionUserUpns: [],
  nodeHighCpuThreshold: 90,
  nodeHighMemoryThreshold: 90,
  reminderIntervalMinutes: 60,
  resolveNotificationsEnabled: true,
  stalenessThresholdMinutes: 5,
  updatedAt: null,
  webhookKind: "auto",
  webhookUrl: "",
};

function clamp(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeWebhookKind(value: unknown): AlertWebhookKind {
  if (value === "generic" || value === "teams" || value === "slack" || value === "discord") return value;
  return "auto";
}

function normalizeMentions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const v = entry.trim().replace(/^@+/, "").toLowerCase();
    if (!v || v.includes(" ") || seen.has(v)) continue;
    seen.add(v);
    result.push(v);
  }
  return result;
}

function normalize(parsed: Partial<HeartbeatSettings>): HeartbeatSettings {
  return {
    checkIntervalSeconds: clamp(parsed.checkIntervalSeconds, DEFAULTS.checkIntervalSeconds, 10, 3600),
    enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULTS.enabled,
    graceMinutes: clamp(parsed.graceMinutes, DEFAULTS.graceMinutes, 1, 60),
    mentionUserUpns: normalizeMentions(parsed.mentionUserUpns),
    nodeHighCpuThreshold: clamp(parsed.nodeHighCpuThreshold, DEFAULTS.nodeHighCpuThreshold, 1, 100),
    nodeHighMemoryThreshold: clamp(parsed.nodeHighMemoryThreshold, DEFAULTS.nodeHighMemoryThreshold, 1, 100),
    reminderIntervalMinutes: clamp(parsed.reminderIntervalMinutes, DEFAULTS.reminderIntervalMinutes, 5, 10_080),
    resolveNotificationsEnabled:
      typeof parsed.resolveNotificationsEnabled === "boolean"
        ? parsed.resolveNotificationsEnabled
        : DEFAULTS.resolveNotificationsEnabled,
    stalenessThresholdMinutes: clamp(parsed.stalenessThresholdMinutes, DEFAULTS.stalenessThresholdMinutes, 1, 60),
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : DEFAULTS.updatedAt,
    webhookKind: normalizeWebhookKind(parsed.webhookKind),
    webhookUrl: typeof parsed.webhookUrl === "string" ? parsed.webhookUrl.trim() : DEFAULTS.webhookUrl,
  };
}

export async function getHeartbeatSettings(): Promise<HeartbeatSettings> {
  try {
    const raw = await readFile(await resolveDataFilePath("heartbeat-settings.json"), "utf8");
    return normalize(JSON.parse(raw) as Partial<HeartbeatSettings>);
  } catch {
    return { ...DEFAULTS };
  }
}

let mutationQueue = Promise.resolve();

export async function saveHeartbeatSettings(
  input: Partial<HeartbeatSettings>,
): Promise<HeartbeatSettings> {
  const prev = mutationQueue;
  let release!: () => void;
  mutationQueue = new Promise<void>((r) => { release = r; });
  await prev.catch(() => {});

  try {
    const current = await getHeartbeatSettings();
    const next = normalize({
      ...current,
      ...input,
      updatedAt: new Date().toISOString(),
    });
    const filePath = await resolveDataFilePath("heartbeat-settings.json");
    await writeJsonFileAtomically(filePath, next);
    return next;
  } finally {
    release();
  }
}
