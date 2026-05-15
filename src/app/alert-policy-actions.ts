"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { BasicActionState } from "@/lib/action-states";
import type { AlertWebhookKind } from "@/lib/alert-settings";
import {
  createAlertPolicy,
  deleteAlertPolicy,
  duplicateAlertPolicy,
  toggleAlertPolicy,
  updateAlertPolicy,
  ALERT_RULE_TYPES,
  type AlertPolicyInput,
  type AlertPolicyScope,
  type AlertRuleConfig,
} from "@/lib/alert-policies";
import { requireSitePermission, requireSession } from "@/lib/auth";
import { assertSafeWebhookUrl } from "@/lib/import-url";
import { withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

function parseRulesFromForm(formData: FormData): AlertRuleConfig[] {
  const rules: AlertRuleConfig[] = [];

  for (const ruleType of ALERT_RULE_TYPES) {
    const enabled = formData.get(`rule_${ruleType}_enabled`) === "on";
    const graceMinutes = Math.max(
      0,
      Math.round(Number(formData.get(`rule_${ruleType}_grace`) || "10")),
    );
    const thresholdPercent = formData.has(`rule_${ruleType}_threshold_percent`)
      ? Math.max(1, Math.min(99, Math.round(Number(formData.get(`rule_${ruleType}_threshold_percent`) || "90"))))
      : undefined;
    const thresholdHours = formData.has(`rule_${ruleType}_threshold_hours`)
      ? Math.max(1, Math.round(Number(formData.get(`rule_${ruleType}_threshold_hours`) || "24")))
      : undefined;

    rules.push({
      enabled,
      graceMinutes,
      ...(thresholdPercent != null && { thresholdPercent }),
      ...(thresholdHours != null && { thresholdHours }),
      type: ruleType,
    });
  }

  return rules;
}

function parseMentionUpns(formData: FormData): string[] {
  const raw = String(formData.get("mentionUserUpns") ?? "").trim();
  if (!raw) return [];

  const seen = new Set<string>();
  const upns: string[] = [];

  for (const token of raw.split(/[\n,;]+/)) {
    const upn = token.trim().replace(/^@+/, "").toLowerCase();
    if (!upn || seen.has(upn)) continue;
    seen.add(upn);
    upns.push(upn);
  }

  return upns;
}

async function parsePolicyInput(formData: FormData): Promise<AlertPolicyInput> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Policy name is required.");

  const scope = String(formData.get("scope") ?? "all") as AlertPolicyScope;
  const tagSlugs = scope === "tagged"
    ? String(formData.get("tagSlugs") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  let webhookUrl = String(formData.get("webhookUrl") ?? "").trim();
  if (webhookUrl) {
    webhookUrl = await assertSafeWebhookUrl(webhookUrl);
  }

  const webhookKindRaw = String(formData.get("webhookKind") ?? "auto");
  const webhookKind: AlertWebhookKind =
    webhookKindRaw === "generic" || webhookKindRaw === "teams" ? webhookKindRaw : "auto";

  return {
    checkIntervalMinutes: Math.max(
      1,
      Math.min(1440, Math.round(Number(formData.get("checkIntervalMinutes") || "5"))),
    ),
    description: String(formData.get("description") ?? "").trim(),
    enabled: formData.get("enabled") === "on",
    mentionUserUpns: parseMentionUpns(formData),
    name,
    notifyOnce: formData.get("notifyOnce") === "on",
    reminderIntervalMinutes: Math.max(
      5,
      Math.min(10_080, Math.round(Number(formData.get("reminderIntervalMinutes") || "240"))),
    ),
    resolveNotificationsEnabled: formData.get("resolveNotificationsEnabled") === "on",
    rules: parseRulesFromForm(formData),
    scope,
    tagSlugs,
    webhookKind,
    webhookUrl,
  };
}

export async function createAlertPolicyAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    { const _s = await requireSession(); requireSitePermission(_s, siteConfig.siteId, "manage-alerts"); }
    return await withSiteConfig(siteConfig, async () => {
    const input = await parsePolicyInput(formData);
    await createAlertPolicy(input);
    revalidatePath(`/sites/${siteSlug}/alerts`);

    return {
      message: `Policy "${input.name}" created.`,
      requestId: randomUUID(),
      status: "success",
    };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to create policy.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function updateAlertPolicyAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    { const _s = await requireSession(); requireSitePermission(_s, siteConfig.siteId, "manage-alerts"); }
    return await withSiteConfig(siteConfig, async () => {
    const policyId = String(formData.get("policyId") ?? "");
    if (!policyId) throw new Error("Policy ID is required.");

    const input = await parsePolicyInput(formData);
    const updated = await updateAlertPolicy(policyId, input);
    if (!updated) throw new Error("Policy not found.");

    revalidatePath(`/sites/${siteSlug}/alerts`);

    return {
      message: `Policy "${input.name}" saved.`,
      requestId: randomUUID(),
      status: "success",
    };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to update policy.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function deleteAlertPolicyAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    { const _s = await requireSession(); requireSitePermission(_s, siteConfig.siteId, "manage-alerts"); }
    return await withSiteConfig(siteConfig, async () => {
    const policyId = String(formData.get("policyId") ?? "");
    if (!policyId) throw new Error("Policy ID is required.");

    const deleted = await deleteAlertPolicy(policyId);
    if (!deleted) throw new Error("Policy not found.");

    revalidatePath(`/sites/${siteSlug}/alerts`);

    return {
      message: "Policy deleted.",
      requestId: randomUUID(),
      status: "success",
    };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to delete policy.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function duplicateAlertPolicyAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    { const _s = await requireSession(); requireSitePermission(_s, siteConfig.siteId, "manage-alerts"); }
    return await withSiteConfig(siteConfig, async () => {
    const policyId = String(formData.get("policyId") ?? "");
    if (!policyId) throw new Error("Policy ID is required.");

    const copy = await duplicateAlertPolicy(policyId);
    if (!copy) throw new Error("Policy not found.");

    revalidatePath(`/sites/${siteSlug}/alerts`);

    return {
      message: `Duplicated as "${copy.name}".`,
      requestId: randomUUID(),
      status: "success",
    };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to duplicate policy.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function toggleAlertPolicyAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    { const _s = await requireSession(); requireSitePermission(_s, siteConfig.siteId, "manage-alerts"); }
    return await withSiteConfig(siteConfig, async () => {
    const policyId = String(formData.get("policyId") ?? "");
    const enabled = formData.get("enabled") === "true";

    const updated = await toggleAlertPolicy(policyId, enabled);
    if (!updated) throw new Error("Policy not found.");

    revalidatePath(`/sites/${siteSlug}/alerts`);

    return {
      message: `Policy ${enabled ? "enabled" : "disabled"}.`,
      requestId: randomUUID(),
      status: "success",
    };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to toggle policy.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}
