"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { BasicActionState } from "@/lib/action-states";
import { requireSession, requireSitePermission } from "@/lib/auth";
import { getDeploymentIndex, withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import { recordLbEvent } from "@/lib/load-balancer/event-log";
import { LB_PRESET_STOPS } from "@/lib/load-balancer/presets";
import {
  getNodeScoresForSite,
  getSiteMetricsSnapshot,
} from "@/lib/load-balancer/observer";
import { computeRebalancePlan } from "@/lib/load-balancer/optimizer";
import {
  clearRebalancePlan,
  getRebalancePlan,
  saveRebalancePlan,
  updateRebalancePlan,
} from "@/lib/load-balancer/plan-store";
import {
  getLoadBalancerSettings,
  saveLoadBalancerSettings,
} from "@/lib/load-balancer/settings";
import type {
  ContainerMigrationMode,
  LoadBalancerSettings,
  MigrationWindow,
} from "@/lib/load-balancer/types";

function toBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function toStringList(formData: FormData, key: string): string[] {
  return String(formData.get(key) ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function toVmidList(formData: FormData, key: string): number[] {
  return toStringList(formData, key)
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => Math.round(v));
}

function toContainerMigrationMode(formData: FormData, key: string): ContainerMigrationMode {
  const raw = formData.get(key);
  if (raw === "always" || raw === "windows-only" || raw === "never") return raw;
  return "never";
}

/** Parse "22:00-06:00, 12:00-13:00" into migration windows; bad ranges are dropped. */
function toMigrationWindows(formData: FormData, key: string): MigrationWindow[] {
  const windows: MigrationWindow[] = [];
  for (const range of toStringList(formData, key)) {
    const match = range.match(/^([01]?\d|2[0-3]):([0-5]\d)\s*-\s*([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!match) continue;
    windows.push({ start: `${match[1]}:${match[2]}`, end: `${match[3]}:${match[4]}` });
  }
  return windows;
}

function summarizeSettingsChanges(
  before: LoadBalancerSettings,
  after: LoadBalancerSettings,
): string[] {
  const changed: string[] = [];
  for (const key of Object.keys(after) as Array<keyof LoadBalancerSettings>) {
    if (key === "updatedAt") continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
  }
  return changed;
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

/**
 * Compute a whole-cluster rebalance plan and save it as a draft for the
 * admin to review. Nothing migrates until the draft is explicitly applied.
 */
export async function computeRebalancePlanAction(
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

    const includeContainers = toBoolean(formData, "includeContainers");
    const maxMoves = toClampedInteger(formData, "maxMoves", 5, 1, 20);

    const scores = getNodeScoresForSite(siteConfig.siteId);
    const metrics = getSiteMetricsSnapshot(siteConfig.siteId);
    if (scores.length < 2) {
      return {
        message:
          "The load balancer has no fresh node scores yet. Enable it and wait a poll interval, and make sure the cluster has at least two nodes.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    return await withSiteConfig(siteConfig, async () => {
      const existing = await getRebalancePlan();
      if (existing?.status === "active") {
        return {
          message: "A rebalance plan is already running. Cancel it before computing a new one.",
          requestId: randomUUID(),
          status: "error",
        };
      }

      const settings = await getLoadBalancerSettings();
      const { deployments } = await getDeploymentIndex();

      const result = computeRebalancePlan({
        scores,
        deployments,
        nodeMetrics: metrics,
        settings,
        maxMoves,
        includeContainers,
      });

      if (result.moves.length === 0) {
        await clearRebalancePlan();
        revalidatePath(`/sites/${siteSlug}/load-balancer`);
        return {
          message: "The cluster is already balanced — no moves would improve it meaningfully.",
          requestId: randomUUID(),
          status: "success",
        };
      }

      const now = new Date().toISOString();
      await saveRebalancePlan({
        id: randomUUID(),
        createdAt: now,
        createdBy: session.user.email,
        status: "draft",
        includeContainers,
        imbalanceBefore: result.imbalanceBefore,
        imbalanceAfter: result.imbalanceAfter,
        projectedScores: result.projectedScores,
        moves: result.moves.map((m) => ({
          vmid: m.vmid,
          name: m.name,
          type: m.type,
          sourceNode: m.sourceNode,
          targetNode: m.targetNode,
          memBytes: m.memBytes,
          status: "queued" as const,
          upid: null,
          error: null,
        })),
        updatedAt: now,
      });

      revalidatePath(`/sites/${siteSlug}/load-balancer`);
      return {
        message: `Plan ready: ${result.moves.length} move${result.moves.length === 1 ? "" : "s"}, projected imbalance ${result.imbalanceBefore.toFixed(3)} → ${result.imbalanceAfter.toFixed(3)}. Review and apply below.`,
        requestId: randomUUID(),
        status: "success",
      };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to compute rebalance plan.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

/** Apply a draft plan — the observer executes it one validated move at a time. */
export async function applyRebalancePlanAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    const planId = String(formData.get("planId") ?? "");
    if (!siteSlug || !planId) {
      return { message: "Missing site or plan context.", requestId: randomUUID(), status: "error" };
    }

    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    const session = await requireSession();
    requireSitePermission(session, siteConfig.siteId, "manage-settings");

    return await withSiteConfig(siteConfig, async () => {
      const updated = await updateRebalancePlan(planId, (plan) => {
        if (plan.status === "draft") plan.status = "active";
      });
      if (!updated || updated.status !== "active") {
        return {
          message: "Plan not found or no longer applicable — compute a fresh one.",
          requestId: randomUUID(),
          status: "error",
        };
      }

      await recordLbEvent({
        category: "rebalance-plan",
        level: "info",
        siteId: siteConfig.siteId,
        siteName: siteConfig.siteName,
        node: null,
        vmid: null,
        message: `Rebalance plan applied by ${session.user.email}: ${updated.moves.length} move${updated.moves.length === 1 ? "" : "s"} queued.`,
        details: { planId, changedBy: session.user.email },
      }).catch(() => {});

      revalidatePath(`/sites/${siteSlug}/load-balancer`);
      return {
        message: "Plan applied. The balancer executes one move at a time — watch progress below.",
        requestId: randomUUID(),
        status: "success",
      };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to apply rebalance plan.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

/**
 * Cancel or dismiss a plan. Drafts and finished plans are removed; an
 * active plan stops queuing new moves (an already in-flight migration
 * finishes in Proxmox — it cannot be recalled).
 */
export async function cancelRebalancePlanAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    const planId = String(formData.get("planId") ?? "");
    if (!siteSlug || !planId) {
      return { message: "Missing site or plan context.", requestId: randomUUID(), status: "error" };
    }

    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    const session = await requireSession();
    requireSitePermission(session, siteConfig.siteId, "manage-settings");

    return await withSiteConfig(siteConfig, async () => {
      const plan = await getRebalancePlan();
      if (!plan || plan.id !== planId) {
        return { message: "Plan not found.", requestId: randomUUID(), status: "error" };
      }

      if (plan.status === "active") {
        await updateRebalancePlan(planId, (p) => {
          p.status = "cancelled";
          for (const move of p.moves) {
            if (move.status === "queued") {
              move.status = "skipped";
              move.error = "plan cancelled";
            }
          }
        });
        await recordLbEvent({
          category: "rebalance-plan",
          level: "warning",
          siteId: siteConfig.siteId,
          siteName: siteConfig.siteName,
          node: null,
          vmid: null,
          message: `Rebalance plan cancelled by ${session.user.email}. In-flight migrations finish; queued moves were dropped.`,
          details: { planId, changedBy: session.user.email },
        }).catch(() => {});
      } else {
        await clearRebalancePlan();
      }

      revalidatePath(`/sites/${siteSlug}/load-balancer`);
      return { message: "Plan removed.", requestId: randomUUID(), status: "success" };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to cancel rebalance plan.",
      requestId: randomUUID(),
      status: "error",
    };
  }
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
      const before = await getLoadBalancerSettings();
      const after = await saveLoadBalancerSettings({
        enabled: toBoolean(formData, "enabled"),
        migrationEnabled: toBoolean(formData, "migrationEnabled"),
        migrationDryRun: toBoolean(formData, "migrationDryRun"),
        containerMigrations: toContainerMigrationMode(formData, "containerMigrations"),
        containerMigrationWindows: toMigrationWindows(formData, "containerMigrationWindows"),
        maxConcurrentMigrations: toClampedInteger(formData, "maxConcurrentMigrations", 1, 1, 10),
        maintenanceNodes: toStringList(formData, "maintenanceNodes"),
        excludedNodes: toStringList(formData, "excludedNodes"),
        excludedVmids: toVmidList(formData, "excludedVmids"),
        pollIntervalSeconds: toClampedInteger(formData, "pollIntervalSeconds", 10, 5, 300),
        weights: {
          cpu: toClampedNumber(formData, "weightCpu", 0.25, 0, 1),
          memory: toClampedNumber(formData, "weightMemory", 0.5, 0, 1),
          latency: toClampedNumber(formData, "weightLatency", 0.1, 0, 1),
          disk: toClampedNumber(formData, "weightDisk", 0.15, 0, 1),
        },
        migrationThresholdPercent: toClampedInteger(formData, "migrationThresholdPercent", 50, 10, 200),
        migrationConsecutivePolls: toClampedInteger(formData, "migrationConsecutivePolls", 3, 1, 20),
        migrationCooldownSeconds: toClampedInteger(formData, "migrationCooldownSeconds", 300, 30, 3600),
        minTargetImprovementPercent: toClampedInteger(formData, "minTargetImprovementPercent", 20, 5, 80),
        cpuStealPenalty: toClampedInteger(formData, "cpuStealPenalty", 50, 0, 200),
        cpuStealThresholdPercent: toClampedInteger(formData, "cpuStealThresholdPercent", 10, 1, 100),
        failcntPenalty: toClampedInteger(formData, "failcntPenalty", 50, 0, 200),
        psiPenalty: toClampedInteger(formData, "psiPenalty", 40, 0, 200),
        psiThresholdPercent: toClampedInteger(formData, "psiThresholdPercent", 10, 1, 100),
        predictiveEnabled: toBoolean(formData, "predictiveEnabled"),
        predictiveHorizonMinutes: toClampedInteger(formData, "predictiveHorizonMinutes", 30, 5, 120),
        predictiveMinConfidencePercent: toClampedInteger(formData, "predictiveMinConfidencePercent", 70, 10, 99),
        ewmaAlpha: toClampedNumber(formData, "ewmaAlpha", 0.3, 0.01, 1),
        latencyMaxMs: toClampedInteger(formData, "latencyMaxMs", 500, 50, 10000),
      });

      const changedKeys = summarizeSettingsChanges(before, after);
      if (changedKeys.length > 0) {
        await recordLbEvent({
          category: "settings-changed",
          level: "info",
          siteId: siteConfig.siteId,
          siteName: siteConfig.siteName,
          node: null,
          vmid: null,
          message: `Load balancer settings changed by ${session.user.email}: ${changedKeys.join(", ")}`,
          details: { changedKeys, changedBy: session.user.email },
        }).catch(() => {});
      }

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

export async function applyLbPresetAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    }

    const presetIndex = Number(formData.get("preset") ?? "");
    const preset = LB_PRESET_STOPS[presetIndex];
    if (!preset) {
      return { message: "Unknown preset.", requestId: randomUUID(), status: "error" };
    }

    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    const session = await requireSession();
    requireSitePermission(session, siteConfig.siteId, "manage-settings");

    return await withSiteConfig(siteConfig, async () => {
      // Merge-only: the preset touches its bundle of migration knobs and the
      // enabled flag; every Advanced-mode setting outside it survives.
      await saveLoadBalancerSettings({
        ...preset.overrides,
        enabled: toBoolean(formData, "enabled"),
      });

      await recordLbEvent({
        category: "settings-changed",
        level: "info",
        siteId: siteConfig.siteId,
        siteName: siteConfig.siteName,
        node: null,
        vmid: null,
        message: `Load balancer preset "${preset.label}" applied by ${session.user.email}`,
        details: { preset: preset.key, changedBy: session.user.email },
      }).catch(() => {});

      revalidatePath(`/sites/${siteSlug}/load-balancer`);

      return {
        message: `"${preset.label}" applied.`,
        requestId: randomUUID(),
        status: "success",
      };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to apply the preset.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}
