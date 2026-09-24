import "server-only";

import { postToWebhookUrl } from "@/lib/import-url";
import type { AlertWebhookKind } from "@/lib/alert-settings";
import type { AlertCategory, AlertSeverity } from "@/lib/alert-runtime-state";
import type { NotificationState } from "@/lib/notification-log";

export type WebhookPayload = {
  alertKey: string;
  category: AlertCategory;
  detailsLabel: string | null;
  detailsUrl: string | null;
  durationMinutes: number | null;
  message: string;
  mentionUserUpns: string[];
  severity: AlertSeverity;
  source: "tainer-alerts";
  state: NotificationState;
  subject: string;
  timestamp: string;
  title: string;
};

function detectWebhookKind(webhookUrl: string, preferredKind: AlertWebhookKind) {
  if (preferredKind !== "auto") {
    return preferredKind;
  }

  try {
    const url = new URL(webhookUrl);
    const host = url.hostname.toLowerCase();

    if (
      host.includes("webhook.office.com") ||
      host.includes("office.com") ||
      host.includes("logic.azure.com") ||
      url.pathname.includes("/IncomingWebhook/")
    ) {
      return "teams" as const;
    }

    if (host.includes("hooks.slack.com")) {
      return "slack" as const;
    }

    if (
      (host.includes("discord.com") || host.includes("discordapp.com")) &&
      url.pathname.includes("/api/webhooks")
    ) {
      return "discord" as const;
    }
  } catch {
    return "generic" as const;
  }

  return "generic" as const;
}

function stateLabel(state: NotificationState) {
  if (state === "resolved") return "Resolved";
  if (state === "test") return "Test";
  return "Active";
}

function categoryLabel(category: AlertCategory) {
  if (category === "backup-stale") return "Backup stale";
  if (category === "deployment-offline") return "Workload offline";
  if (category === "storage-low-space") return "Storage low space";
  if (category === "storage-unhealthy") return "Storage unhealthy";
  return "System";
}

function formatDuration(durationMinutes: number | null) {
  if (durationMinutes == null) {
    return "N/A";
  }

  if (durationMinutes < 60) {
    return `${durationMinutes}m`;
  }

  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;

  if (hours < 24) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  return remainingHours > 0
    ? `${days}d ${remainingHours}h`
    : `${days}d`;
}

function buildGenericPayload(payload: WebhookPayload) {
  return payload;
}

function buildMentionText(mentionUserUpns: string[]) {
  return mentionUserUpns.map((mentionUserUpn) => `<at>${mentionUserUpn}</at>`).join(" ");
}

function buildTeamsMentionEntities(mentionUserUpns: string[]) {
  return mentionUserUpns.map((mentionUserUpn) => ({
    mentioned: {
      id: mentionUserUpn,
      name: mentionUserUpn,
    },
    text: `<at>${mentionUserUpn}</at>`,
    type: "mention" as const,
  }));
}

function buildTeamsPayload(payload: WebhookPayload) {
  const mentionText = buildMentionText(payload.mentionUserUpns);
  const mentionEntities = buildTeamsMentionEntities(payload.mentionUserUpns);

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              text: payload.title,
              weight: "Bolder",
              size: "Large",
              wrap: true,
            },
            {
              type: "TextBlock",
              text: payload.message,
              wrap: true,
              spacing: "Medium",
            },
            ...(mentionText
              ? [{
                  type: "TextBlock",
                  text: `Notify ${mentionText}`,
                  wrap: true,
                  spacing: "Medium",
                }]
              : []),
            ...(payload.detailsUrl
              ? [{
                  type: "TextBlock",
                  text: `[${payload.detailsLabel ?? "Open in Tainer"}](${payload.detailsUrl})`,
                  wrap: true,
                  spacing: "Medium",
                }]
              : []),
            {
              type: "FactSet",
              spacing: "Medium",
              facts: [
                { title: "State", value: stateLabel(payload.state) },
                { title: "Severity", value: payload.severity },
                { title: "Category", value: categoryLabel(payload.category) },
                { title: "Target", value: payload.subject },
                { title: "Duration", value: formatDuration(payload.durationMinutes) },
                { title: "When", value: new Date(payload.timestamp).toLocaleString() },
              ],
            },
          ],
          msteams: {
            ...(mentionEntities.length > 0
              ? {
                  entities: mentionEntities,
                }
              : {}),
            width: "Full",
          },
        },
      },
    ],
  };
}

function severityEmoji(severity: AlertSeverity) {
  if (severity === "error") return "🔴";
  if (severity === "warning") return "🟡";
  return "ℹ️";
}

function buildSlackPayload(payload: WebhookPayload) {
  const emoji = severityEmoji(payload.severity);
  const mentionText = payload.mentionUserUpns.length > 0
    ? `\nNotify: ${payload.mentionUserUpns.join(", ")}`
    : "";

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji} ${payload.title}`, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: payload.message + mentionText },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `*State:* ${stateLabel(payload.state)}` },
        { type: "mrkdwn", text: `*Severity:* ${payload.severity}` },
        { type: "mrkdwn", text: `*Category:* ${categoryLabel(payload.category)}` },
        { type: "mrkdwn", text: `*Target:* ${payload.subject}` },
        { type: "mrkdwn", text: `*Duration:* ${formatDuration(payload.durationMinutes)}` },
      ],
    },
  ];

  if (payload.detailsUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: payload.detailsLabel ?? "Open in Tainer", emoji: true },
          url: payload.detailsUrl,
          style: "primary",
        },
      ],
    });
  }

  return { blocks };
}

function severityColor(severity: AlertSeverity) {
  if (severity === "error") return 0xFF0000;
  if (severity === "warning") return 0xFFAA00;
  return 0x3B82F6;
}

function buildDiscordPayload(payload: WebhookPayload) {
  const mentionText = payload.mentionUserUpns.length > 0
    ? `\n\nNotify: ${payload.mentionUserUpns.join(", ")}`
    : "";

  const embed: Record<string, unknown> = {
    title: payload.title,
    description: (payload.message + mentionText).slice(0, 4096),
    color: severityColor(payload.severity),
    fields: [
      { name: "State", value: stateLabel(payload.state), inline: true },
      { name: "Severity", value: payload.severity, inline: true },
      { name: "Category", value: categoryLabel(payload.category), inline: true },
      { name: "Target", value: payload.subject, inline: true },
      { name: "Duration", value: formatDuration(payload.durationMinutes), inline: true },
    ],
    timestamp: payload.timestamp,
  };

  if (payload.detailsUrl) {
    embed.url = payload.detailsUrl;
  }

  return { embeds: [embed] };
}

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1_000;

async function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

export async function dispatchWebhook(
  webhookUrl: string,
  payload: WebhookPayload,
  preferredKind: AlertWebhookKind = "auto",
): Promise<{ error: string | null; kind: "generic" | "teams" | "slack" | "discord"; ok: boolean; attempts: number }> {
  if (!webhookUrl) {
    return { error: "No webhook URL configured", kind: "generic", ok: false, attempts: 0 };
  }

  const kind = detectWebhookKind(webhookUrl, preferredKind);
  let body: unknown;
  switch (kind) {
    case "teams": body = buildTeamsPayload(payload); break;
    case "slack": body = buildSlackPayload(payload); break;
    case "discord": body = buildDiscordPayload(payload); break;
    default: body = buildGenericPayload(payload); break;
  }

  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await postToWebhookUrl(
        webhookUrl,
        JSON.stringify(body),
        {
          "Content-Type": "application/json",
          "User-Agent": "Tainer-Alerts/2.0",
        },
        10_000,
      );

      if (response.status >= 200 && response.status < 300) {
        return { error: null, kind, ok: true, attempts: attempt };
      }

      lastError = `Webhook returned ${response.status}: ${response.statusText || "Request failed"}`;

      // Only retry on 429 or 5xx
      if (!isRetryableStatus(response.status)) {
        return { error: lastError, kind, ok: false, attempts: attempt };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Webhook dispatch failed";
    }

    // Exponential backoff before next retry
    if (attempt < MAX_RETRIES) {
      const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      await sleep(backoffMs);
    }
  }

  return {
    error: `${lastError} (after ${MAX_RETRIES} attempts)`,
    kind,
    ok: false,
    attempts: MAX_RETRIES,
  };
}
