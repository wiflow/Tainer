import "server-only";

import {
  getAlertSettings,
  type AlertSettings,
} from "@/lib/alert-settings";
import {
  listAlertPolicies,
  markPolicyChecked,
  type AlertPolicy,
  type AlertRuleConfig,
} from "@/lib/alert-policies";
import {
  mutateAlertRuntimeState,
  type AlertCategory,
  type AlertRuntimeEntry,
  type AlertSeverity,
} from "@/lib/alert-runtime-state";
import {
  recordNotification,
  type NotificationState,
} from "@/lib/notification-log";
import {
  getDeploymentIndex,
  getNodes,
  listAllBackups,
  listBackupStoragePools,
  type LiveDeployment,
  type LiveNodeMetrics,
} from "@/lib/proxmox";
import { extractManagedTagSlugs } from "@/lib/tag-utils";
import { dispatchWebhook, type WebhookPayload } from "@/lib/webhook-dispatch";

type EvaluatedCondition = {
  category: AlertCategory;
  detailsLabel: string | null;
  detailsUrl: string | null;
  key: string;
  message: string;
  severity: AlertSeverity;
  subject: string;
  thresholdMs: number;
  title: string;
};

type PendingAlertNotification = {
  category: AlertCategory;
  detailsLabel: string | null;
  detailsUrl: string | null;
  durationMinutes: number | null;
  key: string;
  mentionUserUpns: string[];
  message: string;
  policyName: string;
  severity: AlertSeverity;
  state: NotificationState;
  subject: string;
  timestamp: string;
  title: string;
  webhookKind: AlertSettings["webhookKind"];
  webhookUrl: string;
};

export type AlertCheckResult = {
  activeConditions: number;
  alertsFired: number;
  errors: string[];
  policiesEvaluated: number;
  resolvedAlerts: number;
  suppressedEvents: number;
  webhookDispatches: number;
};

function minutesToMs(minutes: number) {
  return Math.max(0, minutes) * 60_000;
}

function hoursToMs(hours: number) {
  return Math.max(0, hours) * 3_600_000;
}

function durationMinutesSince(startedAt: string, endedAt: string) {
  const durationMs = Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
  return Math.round(durationMs / 60_000);
}

function formatDurationMinutes(totalMinutes: number | null) {
  if (totalMinutes == null) return "unknown duration";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function workloadLabel(deployment: LiveDeployment) {
  return `${deployment.name} (${deployment.type === "qemu" ? "VM" : "CT"} ${deployment.vmid} on ${deployment.node})`;
}

function buildAppUrl(pathname: string) {
  const configuredAppUrl = process.env.APP_URL?.trim();
  if (!configuredAppUrl) return null;

  try {
    const baseUrl = new URL(configuredAppUrl);
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") return null;
    const basePath = baseUrl.pathname.endsWith("/")
      ? baseUrl.pathname
      : `${baseUrl.pathname}/`;
    const normalizedPath = pathname.replace(/^\/+/, "");
    return new URL(`${basePath}${normalizedPath}`, baseUrl).toString();
  } catch {
    return null;
  }
}

function deploymentDetailsUrl(deployment: LiveDeployment) {
  return buildAppUrl(`/deployments/${encodeURIComponent(deployment.id)}`);
}

function storageKey(node: string, storage: string, shared: boolean) {
  return shared ? storage : `${node}:${storage}`;
}

function filterDeploymentsByScope(
  deployments: LiveDeployment[],
  policy: AlertPolicy,
): LiveDeployment[] {
  if (policy.scope === "all" || policy.tagSlugs.length === 0) {
    return deployments;
  }

  const slugSet = new Set(policy.tagSlugs);
  return deployments.filter((d) => {
    const managedSlugs = extractManagedTagSlugs(d.tagList);
    return managedSlugs.some((slug) => slugSet.has(slug));
  });
}

function evaluateDeploymentOffline(
  policyId: string,
  rule: AlertRuleConfig,
  deployments: LiveDeployment[],
): EvaluatedCondition[] {
  return deployments
    .filter((d) => d.rawStatus !== "running")
    .map((d) => ({
      category: "deployment-offline" as AlertCategory,
      detailsLabel: "Open workload in Tainer",
      detailsUrl: deploymentDetailsUrl(d),
      key: `policy:${policyId}:deployment-offline:${d.id}`,
      message: `${workloadLabel(d)} has been ${d.statusLabel.toLowerCase()}.`,
      severity: "error" as AlertSeverity,
      subject: workloadLabel(d),
      thresholdMs: minutesToMs(rule.graceMinutes),
      title: `Workload offline: ${d.name}`,
    }));
}

function evaluateDeploymentHighCpu(
  policyId: string,
  rule: AlertRuleConfig,
  deployments: LiveDeployment[],
): EvaluatedCondition[] {
  const threshold = (rule.thresholdPercent ?? 90) / 100;
  return deployments
    .filter((d) => d.rawStatus === "running" && d.cpuUsage != null && d.cpuUsage > threshold)
    .map((d) => ({
      category: "deployment-high-cpu" as AlertCategory,
      detailsLabel: "Open workload in Tainer",
      detailsUrl: deploymentDetailsUrl(d),
      key: `policy:${policyId}:deployment-high-cpu:${d.id}`,
      message: `${workloadLabel(d)} CPU at ${Math.round((d.cpuUsage ?? 0) * 100)}%, threshold ${rule.thresholdPercent ?? 90}%.`,
      severity: "warning" as AlertSeverity,
      subject: workloadLabel(d),
      thresholdMs: minutesToMs(rule.graceMinutes),
      title: `High CPU: ${d.name}`,
    }));
}

function evaluateDeploymentHighMemory(
  policyId: string,
  rule: AlertRuleConfig,
  deployments: LiveDeployment[],
): EvaluatedCondition[] {
  const threshold = (rule.thresholdPercent ?? 90) / 100;
  return deployments
    .filter((d) => {
      if (d.rawStatus !== "running" || d.memUsedBytes == null || d.memTotalBytes == null) return false;
      if (d.memTotalBytes === 0) return false;
      return d.memUsedBytes / d.memTotalBytes > threshold;
    })
    .map((d) => {
      const pct = d.memTotalBytes! > 0 ? Math.round((d.memUsedBytes! / d.memTotalBytes!) * 100) : 0;
      return {
        category: "deployment-high-memory" as AlertCategory,
        detailsLabel: "Open workload in Tainer",
        detailsUrl: deploymentDetailsUrl(d),
        key: `policy:${policyId}:deployment-high-memory:${d.id}`,
        message: `${workloadLabel(d)} memory at ${pct}%, threshold ${rule.thresholdPercent ?? 90}%.`,
        severity: "warning" as AlertSeverity,
        subject: workloadLabel(d),
        thresholdMs: minutesToMs(rule.graceMinutes),
        title: `High memory: ${d.name}`,
      };
    });
}

function evaluateDeploymentHighDisk(
  policyId: string,
  rule: AlertRuleConfig,
  deployments: LiveDeployment[],
): EvaluatedCondition[] {
  const threshold = (rule.thresholdPercent ?? 90) / 100;
  return deployments
    .filter((d) => {
      if (d.rawStatus !== "running" || d.diskUsedBytes == null || d.diskTotalBytes == null) return false;
      if (d.diskTotalBytes === 0) return false;
      return d.diskUsedBytes / d.diskTotalBytes > threshold;
    })
    .map((d) => {
      const pct = d.diskTotalBytes! > 0 ? Math.round((d.diskUsedBytes! / d.diskTotalBytes!) * 100) : 0;
      return {
        category: "deployment-high-disk" as AlertCategory,
        detailsLabel: "Open workload in Tainer",
        detailsUrl: deploymentDetailsUrl(d),
        key: `policy:${policyId}:deployment-high-disk:${d.id}`,
        message: `${workloadLabel(d)} disk at ${pct}%, threshold ${rule.thresholdPercent ?? 90}%.`,
        severity: "warning" as AlertSeverity,
        subject: workloadLabel(d),
        thresholdMs: minutesToMs(rule.graceMinutes),
        title: `High disk: ${d.name}`,
      };
    });
}

function evaluateStorageUnhealthy(
  policyId: string,
  rule: AlertRuleConfig,
  storagePools: Awaited<ReturnType<typeof listBackupStoragePools>>["pools"],
): EvaluatedCondition[] {
  const conditions: EvaluatedCondition[] = [];
  const seen = new Set<string>();

  for (const pool of storagePools) {
    if (pool.issues.length === 0) continue;
    const poolKey = storageKey(pool.node, pool.storage, pool.shared);
    if (seen.has(poolKey)) continue;
    seen.add(poolKey);

    conditions.push({
      category: "storage-unhealthy",
      detailsLabel: "Open backups in Tainer",
      detailsUrl: buildAppUrl("/backups"),
      key: `policy:${policyId}:storage-unhealthy:${poolKey}`,
      message: `Backup storage "${pool.storage}" has issues: ${pool.issues.join(", ")}`,
      severity: "error",
      subject: pool.shared ? `${pool.storage} (shared)` : `${pool.storage} on ${pool.node}`,
      thresholdMs: minutesToMs(rule.graceMinutes),
      title: `Storage unhealthy: ${pool.storage}`,
    });
  }

  return conditions;
}

function evaluateStorageLowSpace(
  policyId: string,
  rule: AlertRuleConfig,
  storagePools: Awaited<ReturnType<typeof listBackupStoragePools>>["pools"],
): EvaluatedCondition[] {
  const threshold = (rule.thresholdPercent ?? 90) / 100;
  const conditions: EvaluatedCondition[] = [];
  const seen = new Set<string>();

  for (const pool of storagePools) {
    if (pool.usageRatio == null || pool.usageRatio < threshold) continue;
    const poolKey = storageKey(pool.node, pool.storage, pool.shared);
    if (seen.has(poolKey)) continue;
    seen.add(poolKey);

    conditions.push({
      category: "storage-low-space",
      detailsLabel: "Open backups in Tainer",
      detailsUrl: buildAppUrl("/backups"),
      key: `policy:${policyId}:storage-low-space:${poolKey}`,
      message: `Backup storage "${pool.storage}" is ${Math.round(pool.usageRatio * 100)}% full, exceeding the ${rule.thresholdPercent ?? 90}% threshold.`,
      severity: "warning",
      subject: pool.shared ? `${pool.storage} (shared)` : `${pool.storage} on ${pool.node}`,
      thresholdMs: minutesToMs(rule.graceMinutes),
      title: `Storage low space: ${pool.storage}`,
    });
  }

  return conditions;
}

function evaluateBackupStale(
  policyId: string,
  rule: AlertRuleConfig,
  deployments: LiveDeployment[],
  archives: Awaited<ReturnType<typeof listAllBackups>>["archives"],
): EvaluatedCondition[] {
  const latestByVmid = new Map<number, (typeof archives)[number]>();
  for (const archive of archives) {
    const current = latestByVmid.get(archive.vmid);
    if (!current || archive.ctime > current.ctime) {
      latestByVmid.set(archive.vmid, archive);
    }
  }

  const now = Date.now();
  const thresholdMs = hoursToMs(rule.thresholdHours ?? 24);

  return deployments.flatMap<EvaluatedCondition>((d) => {
    const latest = latestByVmid.get(d.vmid);
    const subject = workloadLabel(d);

    if (!latest) {
      return [{
        category: "backup-stale",
        detailsLabel: "Open workload in Tainer",
        detailsUrl: deploymentDetailsUrl(d),
        key: `policy:${policyId}:backup-stale:${d.id}`,
        message: `${subject} has no backup archives on any backup storage pool.`,
        severity: "error",
        subject,
        thresholdMs: 0,
        title: `Backup missing: ${d.name}`,
      }];
    }

    const ageMs = now - latest.ctime * 1000;
    if (ageMs <= thresholdMs) return [];

    const ageHours = Math.round(ageMs / 3_600_000);
    return [{
      category: "backup-stale",
      detailsLabel: "Open workload in Tainer",
      detailsUrl: deploymentDetailsUrl(d),
      key: `policy:${policyId}:backup-stale:${d.id}`,
      message: `${subject} last completed backup is ${ageHours}h old, exceeding the ${rule.thresholdHours ?? 24}h alert threshold.`,
      severity: "warning",
      subject,
      thresholdMs: 0,
      title: `Backup stale: ${d.name}`,
    }];
  });
}

function evaluateNodeHighCpu(
  policyId: string,
  rule: AlertRuleConfig,
  metrics: LiveNodeMetrics[],
): EvaluatedCondition[] {
  const threshold = (rule.thresholdPercent ?? 90) / 100;
  return metrics
    .filter((m) => m.cpuRatio != null && m.cpuRatio > threshold)
    .map((m) => ({
      category: "system" as AlertCategory,
      detailsLabel: "Open dashboard in Tainer",
      detailsUrl: buildAppUrl("/"),
      key: `policy:${policyId}:node-high-cpu:${m.node}`,
      message: `Node ${m.node} CPU at ${Math.round((m.cpuRatio ?? 0) * 100)}%, threshold ${rule.thresholdPercent ?? 90}%.`,
      severity: "warning" as AlertSeverity,
      subject: `Node ${m.node}`,
      thresholdMs: minutesToMs(rule.graceMinutes),
      title: `Node high CPU: ${m.node}`,
    }));
}

function evaluateNodeHighMemory(
  policyId: string,
  rule: AlertRuleConfig,
  metrics: LiveNodeMetrics[],
): EvaluatedCondition[] {
  const threshold = (rule.thresholdPercent ?? 90) / 100;
  return metrics
    .filter((m) => {
      if (m.memoryUsedBytes == null || m.memoryTotalBytes == null) return false;
      if (m.memoryTotalBytes === 0) return false;
      return m.memoryUsedBytes / m.memoryTotalBytes > threshold;
    })
    .map((m) => {
      const pct = m.memoryTotalBytes! > 0
        ? Math.round((m.memoryUsedBytes! / m.memoryTotalBytes!) * 100)
        : 0;
      return {
        category: "system" as AlertCategory,
        detailsLabel: "Open dashboard in Tainer",
        detailsUrl: buildAppUrl("/"),
        key: `policy:${policyId}:node-high-memory:${m.node}`,
        message: `Node ${m.node} memory at ${pct}%, threshold ${rule.thresholdPercent ?? 90}%.`,
        severity: "warning" as AlertSeverity,
        subject: `Node ${m.node}`,
        thresholdMs: minutesToMs(rule.graceMinutes),
        title: `Node high memory: ${m.node}`,
      };
    });
}

type ProxmoxSnapshot = {
  archives: Awaited<ReturnType<typeof listAllBackups>>["archives"];
  deployments: LiveDeployment[];
  nodeMetrics: LiveNodeMetrics[];
  storagePools: Awaited<ReturnType<typeof listBackupStoragePools>>["pools"];
};

function evaluateRulesForPolicy(
  policy: AlertPolicy,
  snapshot: ProxmoxSnapshot,
): EvaluatedCondition[] {
  const scopedDeployments = filterDeploymentsByScope(snapshot.deployments, policy);
  const conditions: EvaluatedCondition[] = [];

  for (const rule of policy.rules) {
    if (!rule.enabled) continue;

    switch (rule.type) {
      case "deployment-offline":
        conditions.push(...evaluateDeploymentOffline(policy.id, rule, scopedDeployments));
        break;
      case "deployment-high-cpu":
        conditions.push(...evaluateDeploymentHighCpu(policy.id, rule, scopedDeployments));
        break;
      case "deployment-high-memory":
        conditions.push(...evaluateDeploymentHighMemory(policy.id, rule, scopedDeployments));
        break;
      case "deployment-high-disk":
        conditions.push(...evaluateDeploymentHighDisk(policy.id, rule, scopedDeployments));
        break;
      case "storage-unhealthy":
        conditions.push(...evaluateStorageUnhealthy(policy.id, rule, snapshot.storagePools));
        break;
      case "storage-low-space":
        conditions.push(...evaluateStorageLowSpace(policy.id, rule, snapshot.storagePools));
        break;
      case "backup-stale":
        conditions.push(...evaluateBackupStale(policy.id, rule, scopedDeployments, snapshot.archives));
        break;
      case "node-high-cpu":
        conditions.push(...evaluateNodeHighCpu(policy.id, rule, snapshot.nodeMetrics));
        break;
      case "node-high-memory":
        conditions.push(...evaluateNodeHighMemory(policy.id, rule, snapshot.nodeMetrics));
        break;
    }
  }

  return conditions;
}

function buildResolvedMessage(entry: AlertRuntimeEntry, durationMinutes: number | null) {
  const durationLabel = formatDurationMinutes(durationMinutes);
  return `${entry.title} recovered after ${durationLabel}. Previous condition: ${entry.lastMessage}`;
}

async function evaluateNotifications(
  policy: AlertPolicy,
  globalSettings: AlertSettings,
  conditions: EvaluatedCondition[],
): Promise<{
  pendingNotifications: PendingAlertNotification[];
  suppressedEvents: number;
}> {
  const nowIso = new Date().toISOString();
  const reminderMs = minutesToMs(policy.reminderIntervalMinutes);
  const conditionMap = new Map(conditions.map((c) => [c.key, c]));
  const policyKeyPrefix = `policy:${policy.id}:`;

  const webhookUrl = policy.webhookUrl || globalSettings.webhookUrl;
  const webhookKind = policy.webhookUrl ? policy.webhookKind : globalSettings.webhookKind;
  const mentionUpns = policy.mentionUserUpns.length > 0
    ? policy.mentionUserUpns
    : globalSettings.mentionUserUpns;

  return mutateAlertRuntimeState((store) => {
    const pendingNotifications: PendingAlertNotification[] = [];
    let suppressedEvents = 0;

    for (const condition of conditions) {
      const existingEntry = store.alerts[condition.key];
      const activeEntry: AlertRuntimeEntry = existingEntry?.active
        ? existingEntry
        : {
            active: true,
            category: condition.category,
            detailsLabel: condition.detailsLabel,
            detailsUrl: condition.detailsUrl,
            firstObservedAt: nowIso,
            key: condition.key,
            lastMessage: condition.message,
            lastNotifiedAt: null,
            lastObservedAt: nowIso,
            lastResolvedAt: null,
            notificationCount: 0,
            policyName: policy.name,
            severity: condition.severity,
            subject: condition.subject,
            title: condition.title,
          };

      activeEntry.active = true;
      activeEntry.category = condition.category;
      activeEntry.detailsLabel = condition.detailsLabel;
      activeEntry.detailsUrl = condition.detailsUrl;
      activeEntry.lastMessage = condition.message;
      activeEntry.lastObservedAt = nowIso;
      activeEntry.policyName = policy.name;
      activeEntry.severity = condition.severity;
      activeEntry.subject = condition.subject;
      activeEntry.title = condition.title;

      if (!existingEntry || !existingEntry.active) {
        activeEntry.firstObservedAt = nowIso;
        activeEntry.lastNotifiedAt = null;
        activeEntry.lastResolvedAt = null;
        activeEntry.notificationCount = 0;
      }

      store.alerts[condition.key] = activeEntry;

      const activeForMs = Math.max(
        0,
        new Date(nowIso).getTime() - new Date(activeEntry.firstObservedAt).getTime(),
      );

      if (activeForMs < condition.thresholdMs) continue;

      const lastNotifiedAtMs = activeEntry.lastNotifiedAt
        ? new Date(activeEntry.lastNotifiedAt).getTime()
        : null;

      if (policy.notifyOnce && activeEntry.notificationCount >= 1) {
        suppressedEvents++;
        continue;
      }

      if (lastNotifiedAtMs != null && new Date(nowIso).getTime() - lastNotifiedAtMs < reminderMs) {
        suppressedEvents++;
        continue;
      }

      activeEntry.lastNotifiedAt = nowIso;
      activeEntry.notificationCount += 1;

      pendingNotifications.push({
        category: condition.category,
        detailsLabel: condition.detailsLabel,
        detailsUrl: condition.detailsUrl,
        durationMinutes: durationMinutesSince(activeEntry.firstObservedAt, nowIso),
        key: condition.key,
        mentionUserUpns: activeEntry.notificationCount === 1 ? mentionUpns : [],
        message: condition.message,
        policyName: policy.name,
        severity: condition.severity,
        state: "firing",
        subject: condition.subject,
        timestamp: nowIso,
        title: condition.title,
        webhookKind,
        webhookUrl,
      });
    }

    for (const [key, entry] of Object.entries(store.alerts)) {
      if (!key.startsWith(policyKeyPrefix)) continue;
      if (!entry.active || conditionMap.has(key)) continue;

      entry.active = false;
      entry.lastObservedAt = nowIso;
      entry.lastResolvedAt = nowIso;

      const shouldNotify = policy.resolveNotificationsEnabled && entry.lastNotifiedAt;
      if (!shouldNotify) continue;

      pendingNotifications.push({
        category: entry.category,
        detailsLabel: entry.detailsLabel,
        detailsUrl: entry.detailsUrl,
        durationMinutes: durationMinutesSince(entry.firstObservedAt, nowIso),
        key,
        mentionUserUpns: [],
        message: buildResolvedMessage(entry, durationMinutesSince(entry.firstObservedAt, nowIso)),
        policyName: policy.name,
        severity: "info",
        state: "resolved",
        subject: entry.subject,
        timestamp: nowIso,
        title: `Resolved: ${entry.title}`,
        webhookKind,
        webhookUrl,
      });
    }

    return { pendingNotifications, suppressedEvents };
  });
}

function shouldRunPolicy(policy: AlertPolicy, nowMs: number): boolean {
  if (!policy.enabled) return false;
  if (!policy.lastCheckedAt) return true;

  const lastMs = new Date(policy.lastCheckedAt).getTime();
  const intervalMs = minutesToMs(policy.checkIntervalMinutes);
  return nowMs - lastMs >= intervalMs;
}

export async function runAlertCheck(options?: { force?: boolean }): Promise<AlertCheckResult> {
  const force = options?.force ?? false;

  const [alertSettings, policies] = await Promise.all([
    getAlertSettings(),
    listAlertPolicies(),
  ]);

  if (!alertSettings.enabled) {
    return {
      activeConditions: 0,
      alertsFired: 0,
      errors: [],
      policiesEvaluated: 0,
      resolvedAlerts: 0,
      suppressedEvents: 0,
      webhookDispatches: 0,
    };
  }

  const nowMs = Date.now();
  const policiesToRun = force
    ? policies.filter((p) => p.enabled)
    : policies.filter((p) => shouldRunPolicy(p, nowMs));

  if (policiesToRun.length === 0) {
    return {
      activeConditions: 0,
      alertsFired: 0,
      errors: [],
      policiesEvaluated: 0,
      resolvedAlerts: 0,
      suppressedEvents: 0,
      webhookDispatches: 0,
    };
  }

  const [storageResult, archivesResult, deploymentsResult, nodesResult] = await Promise.all([
    listBackupStoragePools(),
    listAllBackups(),
    getDeploymentIndex(),
    getNodes(),
  ]);

  const snapshot: ProxmoxSnapshot = {
    archives: archivesResult.archives,
    deployments: deploymentsResult.deployments,
    nodeMetrics: nodesResult.metrics,
    storagePools: storageResult.pools,
  };

  const errors: string[] = [];
  let totalConditions = 0;
  let totalFired = 0;
  let totalResolved = 0;
  let totalSuppressed = 0;
  let totalWebhooks = 0;
  const nowIso = new Date(nowMs).toISOString();

  for (const policy of policiesToRun) {
    const conditions = evaluateRulesForPolicy(policy, snapshot);
    totalConditions += conditions.length;

    const { pendingNotifications, suppressedEvents } = await evaluateNotifications(
      policy,
      alertSettings,
      conditions,
    );
    totalSuppressed += suppressedEvents;

    for (const notification of pendingNotifications) {
      if (notification.state === "resolved") {
        totalResolved++;
      } else {
        totalFired++;
      }

      await recordNotification({
        alertKey: notification.key,
        category: notification.category,
        detailsLabel: notification.detailsLabel,
        detailsUrl: notification.detailsUrl,
        durationMinutes: notification.durationMinutes,
        message: notification.message,
        policyName: notification.policyName,
        severity: notification.severity,
        state: notification.state,
        subject: notification.subject,
        title: notification.title,
      });

      if (!notification.webhookUrl) continue;

      const payload: WebhookPayload = {
        alertKey: notification.key,
        category: notification.category,
        detailsLabel: notification.detailsLabel,
        detailsUrl: notification.detailsUrl,
        durationMinutes: notification.durationMinutes,
        mentionUserUpns: notification.mentionUserUpns,
        message: notification.message,
        severity: notification.severity,
        source: "tainer-alerts",
        state: notification.state,
        subject: notification.subject,
        timestamp: notification.timestamp,
        title: notification.title,
      };

      const result = await dispatchWebhook(
        notification.webhookUrl,
        payload,
        notification.webhookKind,
      );

      if (!result.ok) {
        errors.push(`Webhook failed for ${notification.key}: ${result.error}`);
        continue;
      }

      totalWebhooks++;
    }

    await markPolicyChecked(policy.id, nowIso);
  }

  const legacyResolved = await mutateAlertRuntimeState((store) => {
    let count = 0;
    for (const [key, entry] of Object.entries(store.alerts)) {
      if (!key.startsWith("policy:") && entry.active) {
        entry.active = false;
        entry.lastResolvedAt = nowIso;
        count++;
      }
    }
    return count;
  });
  totalResolved += legacyResolved;

  return {
    activeConditions: totalConditions,
    alertsFired: totalFired,
    errors,
    policiesEvaluated: policiesToRun.length,
    resolvedAlerts: totalResolved,
    suppressedEvents: totalSuppressed,
    webhookDispatches: totalWebhooks,
  };
}

export async function sendTestAlert() {
  const settings = await getAlertSettings();

  if (!settings.webhookUrl) {
    throw new Error("Set a webhook URL before sending a test alert.");
  }

  const timestamp = new Date().toISOString();
  const payload: WebhookPayload = {
    alertKey: `test:${timestamp}`,
    category: "system",
    detailsLabel: "Open alerts in Tainer",
    detailsUrl: buildAppUrl("/alerts"),
    durationMinutes: null,
    mentionUserUpns: settings.mentionUserUpns,
    message: "This is a test alert from Tainer. If you can read this, the webhook and formatting are working.",
    severity: "info",
    source: "tainer-alerts",
    state: "test",
    subject: "Tainer alert pipeline",
    timestamp,
    title: "Tainer alert test",
  };

  const result = await dispatchWebhook(
    settings.webhookUrl,
    payload,
    settings.webhookKind,
  );

  if (!result.ok) {
    throw new Error(result.error ?? "Test webhook failed.");
  }

  await recordNotification({
    alertKey: payload.alertKey,
    category: payload.category,
    detailsLabel: payload.detailsLabel,
    detailsUrl: payload.detailsUrl,
    durationMinutes: payload.durationMinutes,
    message: payload.message,
    severity: payload.severity,
    state: payload.state,
    subject: payload.subject,
    title: payload.title,
  });

  return result.kind;
}
