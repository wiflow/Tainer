"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { BasicActionState, ProxmoxActionState } from "@/lib/action-states";
import { clearAllActiveAlerts, clearSingleAlert } from "@/lib/alert-runtime-state";
import { requireSitePermission, requireSession } from "@/lib/auth";
import { assertSafeWebhookUrl } from "@/lib/import-url";
import { saveAlertSettings } from "@/lib/alert-settings";
import { runAlertCheck, sendTestAlert } from "@/lib/alert-engine";
import { clearAlertHistory, recordNotification } from "@/lib/notification-log";
import { withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

function toBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function toClampedInteger(
  formData: FormData,
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = Number(formData.get(key));

  if (!Number.isFinite(raw)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(raw)));
}

async function validateWebhookUrl(webhookUrl: string) {
  if (!webhookUrl) {
    return;
  }

  await assertSafeWebhookUrl(webhookUrl);
}

function parseMentionUserUpns(formData: FormData, key: string) {
  const rawValue = String(formData.get(key) ?? "");

  if (!rawValue.trim()) {
    return [];
  }

  const seen = new Set<string>();
  const mentionUserUpns: string[] = [];

  for (const token of rawValue.split(/[\n,;]+/)) {
    const mentionUserUpn = token.trim().replace(/^@+/, "").toLowerCase();

    if (!mentionUserUpn) {
      continue;
    }

    if (!mentionUserUpn.includes("@")) {
      throw new Error("Mention recipients must use Microsoft 365 email/UPN format.");
    }

    if (mentionUserUpn.includes(" ")) {
      throw new Error("Mention recipients can't include spaces.");
    }

    if (seen.has(mentionUserUpn)) {
      continue;
    }

    seen.add(mentionUserUpn);
    mentionUserUpns.push(mentionUserUpn);
  }

  return mentionUserUpns;
}

export async function updateAlertSettingsAction(
  _previousState: ProxmoxActionState,
  formData: FormData,
): Promise<ProxmoxActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    { const _s = await requireSession(); requireSitePermission(_s, siteConfig.siteId, "manage-alerts"); }

    return await withSiteConfig(siteConfig, async () => {

    const webhookUrl = String(formData.get("webhookUrl") ?? "").trim();
    const webhookKind = String(formData.get("webhookKind") ?? "auto").trim();
    const mentionUserUpns = parseMentionUserUpns(formData, "mentionUserUpns");

    await validateWebhookUrl(webhookUrl);

    await saveAlertSettings({
      enabled: toBoolean(formData, "enabled"),
      mentionUserUpns,
      reminderIntervalMinutes: toClampedInteger(
        formData,
        "reminderIntervalMinutes",
        240,
        5,
        10_080,
      ),
      resolveNotificationsEnabled: toBoolean(formData, "resolveNotificationsEnabled"),
      webhookKind:
        webhookKind === "generic" || webhookKind === "teams" || webhookKind === "slack" || webhookKind === "discord"
          ? webhookKind
          : "auto",
      webhookUrl,
    });

    revalidatePath(`/sites/${siteSlug}/alerts`);

    return {
      message: "Global alert settings saved.",
      requestId: randomUUID(),
      status: "success",
      task: null,
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to save alert settings.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function sendTestAlertAction(
  _previousState: ProxmoxActionState,
  formData: FormData,
): Promise<ProxmoxActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    { const _s = await requireSession(); requireSitePermission(_s, siteConfig.siteId, "manage-alerts"); }

    const kind = await sendTestAlert();

    revalidatePath("/alerts");

    return {
      message: `Test alert delivered using ${kind} webhook formatting.`,
      requestId: randomUUID(),
      status: "success",
      task: null,
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to send test alert.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function runAlertCheckNowAction(
  _previousState: ProxmoxActionState,
  formData: FormData,
): Promise<ProxmoxActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    { const _s = await requireSession(); requireSitePermission(_s, siteConfig.siteId, "manage-alerts"); }

    const result = await runAlertCheck({ force: true });

    revalidatePath("/alerts");

    return {
      message: `Alert check finished: ${result.policiesEvaluated} policies evaluated, ${result.alertsFired} new, ${result.resolvedAlerts} resolved, ${result.webhookDispatches} webhooks, ${result.suppressedEvents} suppressed.`,
      requestId: randomUUID(),
      status: "success",
      task: null,
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to run alert check.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

function durationMinutesSince(startIso: string) {
  const ms = Math.max(0, Date.now() - new Date(startIso).getTime());
  return Math.round(ms / 60_000);
}

export async function clearAllActiveAlertsAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-alerts");
    const clearedEntries = await clearAllActiveAlerts();

    for (const entry of clearedEntries) {
      const duration = durationMinutesSince(entry.firstObservedAt);
      await recordNotification({
        alertKey: entry.key,
        category: entry.category,
        clearedBy: session.user.name,
        detailsLabel: entry.detailsLabel,
        detailsUrl: entry.detailsUrl,
        durationMinutes: duration,
        message: `${entry.title} manually resolved by ${session.user.name}. Previous condition: ${entry.lastMessage}`,
        policyName: entry.policyName,
        severity: "info",
        state: "resolved",
        subject: entry.subject,
        title: `Resolved: ${entry.title}`,
      });
    }

    revalidatePath("/alerts");

    const count = clearedEntries.length;
    return {
      message: `${count} active alert${count !== 1 ? "s" : ""} cleared.`,
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to clear alerts.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function clearSingleAlertAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-alerts");
    return await withSiteConfig(siteConfig, async () => {
    const alertKey = String(formData.get("alertKey") ?? "");
    if (!alertKey) throw new Error("Alert key is required.");

    const entry = await clearSingleAlert(alertKey);
    if (!entry) throw new Error("Alert not found or already resolved.");

    const duration = durationMinutesSince(entry.firstObservedAt);
    await recordNotification({
      alertKey: entry.key,
      category: entry.category,
      clearedBy: session.user.name,
      detailsLabel: entry.detailsLabel,
      detailsUrl: entry.detailsUrl,
      durationMinutes: duration,
      message: `${entry.title} manually resolved by ${session.user.name}. Previous condition: ${entry.lastMessage}`,
      policyName: entry.policyName,
      severity: "info",
      state: "resolved",
      subject: entry.subject,
      title: `Resolved: ${entry.title}`,
    });

    revalidatePath(`/sites/${siteSlug}/alerts`);

    return {
      message: "Alert cleared.",
      requestId: randomUUID(),
      status: "success",
    };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to clear alert.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function clearAlertHistoryAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-alerts");
    const count = await clearAlertHistory();

    revalidatePath("/alerts");

    return {
      message: `${count} history entr${count !== 1 ? "ies" : "y"} cleared by ${session.user.name}.`,
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to clear history.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}
