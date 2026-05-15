"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { BasicActionState } from "@/lib/action-states";
import { requireSession, requireSitePermission } from "@/lib/auth";
import { withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import { saveLoadBalancerSettings } from "@/lib/load-balancer/settings";

function toBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function toClampedNumber(
  formData: FormData,
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = Number(formData.get(key));
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

function toClampedInteger(
  formData: FormData,
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  return Math.round(toClampedNumber(formData, key, fallback, min, max));
}

export async function updateLoadBalancerSettingsAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    }

    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    const session = await requireSession();
    requireSitePermission(session, siteConfig.siteId, "manage-settings");

    return await withSiteConfig(siteConfig, async () => {
      await saveLoadBalancerSettings({
        enabled: toBoolean(formData, "enabled"),
        migrationEnabled: toBoolean(formData, "migrationEnabled"),
        pollIntervalSeconds: toClampedInteger(formData, "pollIntervalSeconds", 10, 5, 300),
        weights: {
          cpu: toClampedNumber(formData, "weightCpu", 0.4, 0, 1),
          memory: toClampedNumber(formData, "weightMemory", 0.3, 0, 1),
          latency: toClampedNumber(formData, "weightLatency", 0.2, 0, 1),
          disk: toClampedNumber(formData, "weightDisk", 0.1, 0, 1),
        },
        migrationThresholdPercent: toClampedInteger(formData, "migrationThresholdPercent", 50, 10, 200),
        migrationConsecutivePolls: toClampedInteger(formData, "migrationConsecutivePolls", 3, 1, 20),
        migrationCooldownSeconds: toClampedInteger(formData, "migrationCooldownSeconds", 300, 30, 3600),
        cpuStealPenalty: toClampedInteger(formData, "cpuStealPenalty", 50, 0, 200),
        cpuStealThresholdPercent: toClampedInteger(formData, "cpuStealThresholdPercent", 10, 1, 100),
        failcntPenalty: toClampedInteger(formData, "failcntPenalty", 50, 0, 200),
        ewmaAlpha: toClampedNumber(formData, "ewmaAlpha", 0.3, 0.01, 1),
        latencyMaxMs: toClampedInteger(formData, "latencyMaxMs", 500, 50, 10000),
      });

      revalidatePath(`/sites/${siteSlug}/load-balancer`);

      return {
        message: "Load balancer settings saved.",
        requestId: randomUUID(),
        status: "success",
      };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to save settings.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}
