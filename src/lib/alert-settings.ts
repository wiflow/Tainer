import "server-only";

import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import { writeJsonFileAtomically } from "@/lib/store-utils";

export type AlertWebhookKind = "auto" | "generic" | "teams" | "slack" | "discord";

export type AlertSettings = {
  deploymentOfflineEnabled: boolean;
  deploymentOfflineGraceMinutes: number;
  enabled: boolean;
  lowSpaceEnabled: boolean;
  lowSpaceGraceMinutes: number;
  lowSpaceThresholdPercent: number;
  mentionUserUpns: string[];
  reminderIntervalMinutes: number;
  resolveNotificationsEnabled: boolean;
  slaBreachEnabled: boolean;
  slaBreachHours: number;
  storageOfflineEnabled: boolean;
  storageOfflineGraceMinutes: number;
  updatedAt: string | null;
  webhookKind: AlertWebhookKind;
  webhookUrl: string;
};

const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  deploymentOfflineEnabled: false,
  deploymentOfflineGraceMinutes: 15,
  enabled: false,
  lowSpaceEnabled: true,
  lowSpaceGraceMinutes: 10,
  lowSpaceThresholdPercent: 90,
  mentionUserUpns: [],
  reminderIntervalMinutes: 240,
  resolveNotificationsEnabled: true,
  slaBreachEnabled: true,
  slaBreachHours: 24,
  storageOfflineEnabled: true,
  storageOfflineGraceMinutes: 5,
  updatedAt: null,
  webhookKind: "auto",
  webhookUrl: "",
};

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.round(value);
  return Math.max(min, Math.min(max, normalized));
}

function normalizeWebhookKind(value: unknown): AlertWebhookKind {
  if (value === "generic" || value === "teams" || value === "slack" || value === "discord") return value;
  return "auto";
}

function normalizeMentionUserUpns(value: unknown) {
  if (!Array.isArray(value)) {
    return DEFAULT_ALERT_SETTINGS.mentionUserUpns;
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const mentionUserUpn = entry.trim().replace(/^@+/, "").toLowerCase();
    if (!mentionUserUpn || mentionUserUpn.includes(" ")) {
      continue;
    }

    if (seen.has(mentionUserUpn)) {
      continue;
    }

    seen.add(mentionUserUpn);
    normalized.push(mentionUserUpn);
  }

  return normalized;
}

function normalizeAlertSettings(parsed: Partial<AlertSettings> & {
  backupFailureEnabled?: boolean;
}): AlertSettings {
  return {
    deploymentOfflineEnabled:
      typeof parsed.deploymentOfflineEnabled === "boolean"
        ? parsed.deploymentOfflineEnabled
        : DEFAULT_ALERT_SETTINGS.deploymentOfflineEnabled,
    deploymentOfflineGraceMinutes: clampInteger(
      parsed.deploymentOfflineGraceMinutes,
      DEFAULT_ALERT_SETTINGS.deploymentOfflineGraceMinutes,
      1,
      1440,
    ),
    enabled:
      typeof parsed.enabled === "boolean"
        ? parsed.enabled
        : DEFAULT_ALERT_SETTINGS.enabled,
    lowSpaceEnabled:
      typeof parsed.lowSpaceEnabled === "boolean"
        ? parsed.lowSpaceEnabled
        : DEFAULT_ALERT_SETTINGS.lowSpaceEnabled,
    lowSpaceGraceMinutes: clampInteger(
      parsed.lowSpaceGraceMinutes,
      DEFAULT_ALERT_SETTINGS.lowSpaceGraceMinutes,
      1,
      1440,
    ),
    lowSpaceThresholdPercent: clampInteger(
      parsed.lowSpaceThresholdPercent,
      DEFAULT_ALERT_SETTINGS.lowSpaceThresholdPercent,
      1,
      99,
    ),
    mentionUserUpns: normalizeMentionUserUpns(parsed.mentionUserUpns),
    reminderIntervalMinutes: clampInteger(
      parsed.reminderIntervalMinutes,
      DEFAULT_ALERT_SETTINGS.reminderIntervalMinutes,
      5,
      10_080,
    ),
    resolveNotificationsEnabled:
      typeof parsed.resolveNotificationsEnabled === "boolean"
        ? parsed.resolveNotificationsEnabled
        : DEFAULT_ALERT_SETTINGS.resolveNotificationsEnabled,
    slaBreachEnabled:
      typeof parsed.slaBreachEnabled === "boolean"
        ? parsed.slaBreachEnabled
        : DEFAULT_ALERT_SETTINGS.slaBreachEnabled,
    slaBreachHours: clampInteger(
      parsed.slaBreachHours,
      DEFAULT_ALERT_SETTINGS.slaBreachHours,
      1,
      720,
    ),
    storageOfflineEnabled:
      typeof parsed.storageOfflineEnabled === "boolean"
        ? parsed.storageOfflineEnabled
        : DEFAULT_ALERT_SETTINGS.storageOfflineEnabled,
    storageOfflineGraceMinutes: clampInteger(
      parsed.storageOfflineGraceMinutes,
      DEFAULT_ALERT_SETTINGS.storageOfflineGraceMinutes,
      1,
      1440,
    ),
    updatedAt:
      typeof parsed.updatedAt === "string"
        ? parsed.updatedAt
        : DEFAULT_ALERT_SETTINGS.updatedAt,
    webhookKind: normalizeWebhookKind(parsed.webhookKind),
    webhookUrl:
      typeof parsed.webhookUrl === "string"
        ? parsed.webhookUrl.trim()
        : DEFAULT_ALERT_SETTINGS.webhookUrl,
  };
}

export async function getAlertSettings(): Promise<AlertSettings> {
  try {
    const raw = await readFile(await resolveDataFilePath("alert-settings.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<AlertSettings> & {
      backupFailureEnabled?: boolean;
    };

    return normalizeAlertSettings(parsed);
  } catch {
    return { ...DEFAULT_ALERT_SETTINGS };
  }
}

let alertSettingsMutationQueue = Promise.resolve();

export async function saveAlertSettings(
  input: Partial<AlertSettings>,
): Promise<AlertSettings> {
  const previousMutation = alertSettingsMutationQueue;
  let releaseMutation!: () => void;
  alertSettingsMutationQueue = new Promise<void>((resolve) => {
    releaseMutation = resolve;
  });

  await previousMutation.catch(() => {});

  try {
    const current = await getAlertSettings();
    const next = normalizeAlertSettings({
      ...current,
      ...input,
      updatedAt: new Date().toISOString(),
      webhookUrl:
        input.webhookUrl != null
          ? input.webhookUrl.trim()
          : current.webhookUrl,
    });

    const filePath = await resolveDataFilePath("alert-settings.json");
    await writeJsonFileAtomically(filePath, next);

    return next;
  } finally {
    releaseMutation();
  }
}

export function countEnabledAlertPolicies(settings: AlertSettings) {
  return [
    settings.deploymentOfflineEnabled,
    settings.lowSpaceEnabled,
    settings.slaBreachEnabled,
    settings.storageOfflineEnabled,
  ].filter(Boolean).length;
}
