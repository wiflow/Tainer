import "server-only";

import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import type { AlertCategory, AlertRuntimeEntry, AlertSeverity } from "@/lib/alert-runtime-state";
import { getHeartbeatSettings, type HeartbeatSettings } from "@/lib/heartbeat-settings";
import type { NotificationState } from "@/lib/notification-log";
import { resolveSiteConfig } from "@/lib/site-resolver";
import { listEnabledSites, updateSiteValidation } from "@/lib/site-store";
import type { SiteRecord } from "@/lib/site-types";
import { validateSiteConnection } from "@/lib/site-validation";
import { writeJsonFileAtomically } from "@/lib/store-utils";
import { dispatchWebhook, type WebhookPayload } from "@/lib/webhook-dispatch";

type HeartbeatCondition = {
  category: AlertCategory;
  key: string;
  message: string;
  severity: AlertSeverity;
  subject: string;
  thresholdMs: number;
  title: string;
};

export type HeartbeatCheckResult = {
  alertsFired: number;
  errors: string[];
  resolvedAlerts: number;
  sitesChecked: number;
};

type HeartbeatRuntimeStore = {
  alerts: Record<string, AlertRuntimeEntry>;
};

async function readRuntimeStore(): Promise<HeartbeatRuntimeStore> {
  try {
    const raw = await readFile(await resolveDataFilePath("heartbeat-runtime-state.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<HeartbeatRuntimeStore>;
    return { alerts: parsed.alerts && typeof parsed.alerts === "object" ? parsed.alerts : {} };
  } catch {
    return { alerts: {} };
  }
}

async function writeRuntimeStore(store: HeartbeatRuntimeStore): Promise<void> {
  const filePath = await resolveDataFilePath("heartbeat-runtime-state.json");
  await writeJsonFileAtomically(filePath, store);
}

export async function getActiveHeartbeatAlerts(): Promise<AlertRuntimeEntry[]> {
  const store = await readRuntimeStore();
  return Object.values(store.alerts).filter((a) => a.active);
}

export async function clearAllHeartbeatAlerts(): Promise<void> {
  const store = await readRuntimeStore();
  const now = new Date().toISOString();
  for (const entry of Object.values(store.alerts)) {
    if (entry.active) {
      entry.active = false;
      entry.lastResolvedAt = now;
    }
  }
  await writeRuntimeStore(store);
}

let lastHeartbeatCheckAt = 0;

export function shouldRunHeartbeat(settings: HeartbeatSettings): boolean {
  if (!settings.enabled) return false;
  const intervalMs = settings.checkIntervalSeconds * 1000;
  return Date.now() - lastHeartbeatCheckAt >= intervalMs;
}

export async function runHeartbeatCheck(options?: { force?: boolean }): Promise<HeartbeatCheckResult> {
  const settings = await getHeartbeatSettings();
  const result: HeartbeatCheckResult = { alertsFired: 0, errors: [], resolvedAlerts: 0, sitesChecked: 0 };

  if (!settings.enabled && !options?.force) return result;
  if (!options?.force && !shouldRunHeartbeat(settings)) return result;

  lastHeartbeatCheckAt = Date.now();

  const sites = await listEnabledSites();
  if (sites.length === 0) return result;

  const conditions: HeartbeatCondition[] = [];
  const graceMs = settings.graceMinutes * 60_000;

  for (const site of sites) {
    result.sitesChecked++;

    try {
      const config = await resolveSiteConfig(site);
      const validation = await validateSiteConnection(config);

      await updateSiteValidation(site.id, validation.ok);

      if (!validation.ok) {
        conditions.push({
          category: "system",
          key: `heartbeat:connection:${site.id}`,
          message: `Cannot reach ${site.name}: ${validation.message ?? "Connection failed"}`,
          severity: "error",
          subject: site.name,
          thresholdMs: graceMs,
          title: `Site unreachable: ${site.name}`,
        });
        continue;
      }

      checkStaleness(site, settings, conditions, graceMs);
      await checkNodeHealth(config, site, settings, conditions, graceMs);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`${site.name}: ${msg}`);

      conditions.push({
        category: "system",
        key: `heartbeat:connection:${site.id}`,
        message: `Error checking ${site.name}: ${msg}`,
        severity: "error",
        subject: site.name,
        thresholdMs: graceMs,
        title: `Site check error: ${site.name}`,
      });
    }
  }

  const store = await readRuntimeStore();
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const conditionKeys = new Set(conditions.map((c) => c.key));

  for (const condition of conditions) {
    let entry = store.alerts[condition.key];

    if (!entry) {
      entry = {
        active: true,
        category: condition.category,
        detailsLabel: null,
        detailsUrl: null,
        firstObservedAt: now,
        key: condition.key,
        lastMessage: condition.message,
        lastNotifiedAt: null,
        lastObservedAt: now,
        lastResolvedAt: null,
        notificationCount: 0,
        policyName: "Heartbeat Monitor",
        severity: condition.severity,
        subject: condition.subject,
        title: condition.title,
      };
      store.alerts[condition.key] = entry;
    } else {
      entry.active = true;
      entry.lastObservedAt = now;
      entry.lastMessage = condition.message;
      entry.severity = condition.severity;
      entry.title = condition.title;
    }

    const activeForMs = nowMs - new Date(entry.firstObservedAt).getTime();
    if (activeForMs < condition.thresholdMs) continue;

    if (entry.lastNotifiedAt) {
      const sinceLastNotify = nowMs - new Date(entry.lastNotifiedAt).getTime();
      if (sinceLastNotify < settings.reminderIntervalMinutes * 60_000) continue;
    }

    entry.lastNotifiedAt = now;
    entry.notificationCount++;
    result.alertsFired++;

    await sendHeartbeatWebhook(settings, {
      key: condition.key,
      category: condition.category,
      severity: condition.severity,
      state: "firing",
      subject: condition.subject,
      title: condition.title,
      message: condition.message,
      durationMinutes: Math.round(activeForMs / 60_000),
      isFirstNotification: entry.notificationCount === 1,
    });
  }

  for (const [key, entry] of Object.entries(store.alerts)) {
    if (entry.active && !conditionKeys.has(key)) {
      entry.active = false;
      entry.lastResolvedAt = now;
      result.resolvedAlerts++;

      if (settings.resolveNotificationsEnabled && entry.notificationCount > 0) {
        const durationMs = nowMs - new Date(entry.firstObservedAt).getTime();

        await sendHeartbeatWebhook(settings, {
          key,
          category: entry.category,
          severity: "info",
          state: "resolved",
          subject: entry.subject,
          title: `Resolved: ${entry.title}`,
          message: `${entry.title} has been resolved.`,
          durationMinutes: Math.round(durationMs / 60_000),
          isFirstNotification: false,
        });
      }
    }
  }

  await writeRuntimeStore(store);
  return result;
}

function checkStaleness(
  site: SiteRecord,
  settings: HeartbeatSettings,
  conditions: HeartbeatCondition[],
  graceMs: number,
) {
  if (!site.lastValidatedAt) return;

  const staleMs = Date.now() - new Date(site.lastValidatedAt).getTime();
  const thresholdMs = settings.stalenessThresholdMinutes * 60_000;

  if (staleMs > thresholdMs) {
    conditions.push({
      category: "system",
      key: `heartbeat:stale:${site.id}`,
      message: `Last successful check for ${site.name} was ${Math.round(staleMs / 60_000)} minutes ago`,
      severity: "warning",
      subject: site.name,
      thresholdMs: graceMs,
      title: `Stale site: ${site.name}`,
    });
  }
}

async function checkNodeHealth(
  config: import("@/lib/site-types").ResolvedSiteConfig,
  site: SiteRecord,
  settings: HeartbeatSettings,
  conditions: HeartbeatCondition[],
  graceMs: number,
) {
  try {
    const { getNodes, withSiteConfig, setSiteConfigForRequest } = await import("@/lib/proxmox");

    const result = await withSiteConfig(config, async () => {
      return getNodes();
    });

    for (const node of result.nodes) {
      if (node.status !== "online") continue;

      const metrics = result.metrics.find((m) => m.node === node.name);
      if (!metrics) continue;

      if (metrics.cpuRatio != null && metrics.cpuRatio * 100 >= settings.nodeHighCpuThreshold) {
        const cpuPercent = metrics.cpuRatio * 100;
        conditions.push({
          category: "system",
          key: `heartbeat:node-cpu:${site.id}:${node.name}`,
          message: `Node ${node.name} on ${site.name} CPU at ${cpuPercent.toFixed(1)}% (threshold: ${settings.nodeHighCpuThreshold}%)`,
          severity: "warning",
          subject: `${site.name} / ${node.name}`,
          thresholdMs: graceMs,
          title: `High node CPU: ${node.name}`,
        });
      }

      if (metrics.memoryTotalBytes != null && metrics.memoryUsedBytes != null && metrics.memoryTotalBytes > 0) {
        const memPercent = (metrics.memoryUsedBytes / metrics.memoryTotalBytes) * 100;
        if (memPercent >= settings.nodeHighMemoryThreshold) {
          conditions.push({
            category: "system",
            key: `heartbeat:node-memory:${site.id}:${node.name}`,
            message: `Node ${node.name} on ${site.name} memory at ${memPercent.toFixed(1)}% (threshold: ${settings.nodeHighMemoryThreshold}%)`,
            severity: "warning",
            subject: `${site.name} / ${node.name}`,
            thresholdMs: graceMs,
            title: `High node memory: ${node.name}`,
          });
        }
      }
    }
  } catch {
    // Node health check is best-effort; don't fail the whole heartbeat
  }
}

async function sendHeartbeatWebhook(
  settings: HeartbeatSettings,
  alert: {
    key: string;
    category: AlertCategory;
    severity: AlertSeverity;
    state: NotificationState;
    subject: string;
    title: string;
    message: string;
    durationMinutes: number;
    isFirstNotification: boolean;
  },
) {
  if (!settings.webhookUrl) return;

  const payload: WebhookPayload = {
    alertKey: alert.key,
    category: alert.category,
    detailsLabel: null,
    detailsUrl: null,
    durationMinutes: alert.durationMinutes,
    mentionUserUpns: alert.isFirstNotification ? settings.mentionUserUpns : [],
    message: alert.message,
    severity: alert.severity,
    source: "tainer-alerts",
    state: alert.state,
    subject: alert.subject,
    timestamp: new Date().toISOString(),
    title: alert.title,
  };

  try {
    await dispatchWebhook(settings.webhookUrl, payload, settings.webhookKind);
  } catch {
    // Best effort
  }
}
