"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { BasicActionState } from "@/lib/action-states";
import { requireAdminSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/admin-audit-log";
import { clearAllHeartbeatAlerts, runHeartbeatCheck } from "@/lib/heartbeat-engine";
import { saveHeartbeatSettings } from "@/lib/heartbeat-settings";
import { dispatchWebhook } from "@/lib/webhook-dispatch";
import type { AlertWebhookKind } from "@/lib/alert-settings";

function errorResult(message: string): BasicActionState {
  return { message, requestId: randomUUID(), status: "error" };
}

function successResult(message: string): BasicActionState {
  return { message, requestId: randomUUID(), status: "success" };
}

export async function saveHeartbeatSettingsAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireAdminSession();

    const enabled = formData.get("enabled") === "true";
    const checkIntervalSeconds = Number(formData.get("checkIntervalSeconds") ?? 60);
    const stalenessThresholdMinutes = Number(formData.get("stalenessThresholdMinutes") ?? 5);
    const nodeHighCpuThreshold = Number(formData.get("nodeHighCpuThreshold") ?? 90);
    const nodeHighMemoryThreshold = Number(formData.get("nodeHighMemoryThreshold") ?? 90);
    const graceMinutes = Number(formData.get("graceMinutes") ?? 2);
    const reminderIntervalMinutes = Number(formData.get("reminderIntervalMinutes") ?? 60);
    const resolveNotificationsEnabled = formData.get("resolveNotificationsEnabled") === "true";
    const webhookUrl = String(formData.get("webhookUrl") ?? "").trim();
    const webhookKind = String(formData.get("webhookKind") ?? "auto") as AlertWebhookKind;
    const mentionUserUpns = String(formData.get("mentionUserUpns") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    await saveHeartbeatSettings({
      enabled,
      checkIntervalSeconds,
      stalenessThresholdMinutes,
      nodeHighCpuThreshold,
      nodeHighMemoryThreshold,
      graceMinutes,
      reminderIntervalMinutes,
      resolveNotificationsEnabled,
      webhookUrl,
      webhookKind,
      mentionUserUpns,
    });

    await recordAdminAudit({
      action: "settings-updated",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Updated heartbeat settings (${enabled ? "enabled" : "disabled"})`,
    });

    revalidatePath("/heartbeat");

    return successResult("Heartbeat settings saved.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "Failed to save settings.");
  }
}

export async function runHeartbeatCheckNowAction(
  _previousState: BasicActionState,
  _formData: FormData,
): Promise<BasicActionState> {
  try {
    await requireAdminSession();

    const result = await runHeartbeatCheck({ force: true });

    return successResult(
      `Checked ${result.sitesChecked} sites. ${result.alertsFired} alerts fired, ${result.resolvedAlerts} resolved.`,
    );
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "Heartbeat check failed.");
  }
}

export async function clearHeartbeatAlertsAction(
  _previousState: BasicActionState,
  _formData: FormData,
): Promise<BasicActionState> {
  try {
    await requireAdminSession();

    await clearAllHeartbeatAlerts();
    revalidatePath("/heartbeat");

    return successResult("All heartbeat alerts cleared.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "Failed to clear alerts.");
  }
}

export async function sendTestHeartbeatWebhookAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    await requireAdminSession();

    const webhookUrl = String(formData.get("webhookUrl") ?? "").trim();
    const webhookKind = String(formData.get("webhookKind") ?? "auto") as AlertWebhookKind;

    if (!webhookUrl) {
      return errorResult("No webhook URL provided.");
    }

    const result = await dispatchWebhook(
      webhookUrl,
      {
        alertKey: "heartbeat:test",
        category: "system",
        detailsLabel: null,
        detailsUrl: null,
        durationMinutes: null,
        mentionUserUpns: [],
        message: "This is a test notification from Tainer heartbeat monitoring.",
        severity: "info",
        source: "tainer-alerts",
        state: "test",
        subject: "Tainer Heartbeat",
        timestamp: new Date().toISOString(),
        title: "Heartbeat test notification",
      },
      webhookKind,
    );

    if (result.ok) {
      return successResult(`Test webhook sent successfully (${result.kind}).`);
    }

    return errorResult(`Webhook failed: ${result.error}`);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "Failed to send test webhook.");
  }
}
