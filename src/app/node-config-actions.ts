"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { RestoreActionState } from "@/app/node-config-action-states";
import type { BasicActionState } from "@/lib/action-states";
import { requireSession, requireSitePermission } from "@/lib/auth";
import {
  createConfigSnapshotPolicy,
  deleteConfigSnapshotPolicy,
  forceConfigSnapshotPolicyDue,
  toggleConfigSnapshotPolicy,
  updateConfigSnapshotPolicy,
  type ConfigSnapshotPolicyInput,
} from "@/lib/config-snapshot-policies";
import {
  deleteConfigSnapshot,
  restoreConfigSnapshot,
  runConfigSnapshotTick,
  takeConfigSnapshot,
} from "@/lib/node-config-backup";
import type { RestoreSection, RestoreSelection } from "@/lib/node-config-backup";
import { withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

const ALL_SECTIONS: RestoreSection[] = [
  "dns",
  "firewallRules",
  "hosts",
  "network",
  "storage",
  "timezone",
];

function readSelection(formData: FormData): RestoreSelection {
  const selection = {} as RestoreSelection;
  for (const section of ALL_SECTIONS) {
    selection[section] = formData.get(`section_${section}`) === "on";
  }
  return selection;
}

export async function takeConfigSnapshotAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };

    const node = String(formData.get("node") ?? "").trim();
    if (!node) return { message: "Node is required.", requestId: randomUUID(), status: "error" };

    const label = String(formData.get("label") ?? "").trim();

    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-settings");
    return await withSiteConfig(siteConfig, async () => {
      const snapshot = await takeConfigSnapshot(node, session.user.name, label);

      revalidatePath(`/sites/${siteSlug}/node-configs`);

      return {
        message: `Configuration snapshot "${snapshot.label}" saved.`,
        requestId: randomUUID(),
        status: "success",
      };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to take config snapshot.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function restoreConfigSnapshotAction(
  _previousState: RestoreActionState,
  formData: FormData,
): Promise<RestoreActionState> {
  try {
    const session = await requireSession();

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return {
        message: "Missing site context.",
        requestId: randomUUID(),
        result: null,
        status: "error",
      };
    }

    const snapshotId = String(formData.get("snapshotId") ?? "");
    if (!snapshotId) {
      return {
        message: "Snapshot ID is required.",
        requestId: randomUUID(),
        result: null,
        status: "error",
      };
    }

    const confirmation = String(formData.get("confirmation") ?? "").trim();
    if (confirmation !== "RESTORE") {
      return {
        message: 'Please type "RESTORE" to confirm.',
        requestId: randomUUID(),
        result: null,
        status: "error",
      };
    }

    const selection = readSelection(formData);
    const anySelected = ALL_SECTIONS.some((s) => selection[s]);
    if (!anySelected) {
      return {
        message: "Select at least one section to restore.",
        requestId: randomUUID(),
        result: null,
        status: "error",
      };
    }

    const destructive = formData.get("destructive") === "on";
    const reloadNetwork = formData.get("reloadNetwork") !== "off";

    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-settings");
    return await withSiteConfig(siteConfig, async () => {
      const result = await restoreConfigSnapshot(snapshotId, selection, {
        destructive,
        reloadNetwork,
      });

      revalidatePath(`/sites/${siteSlug}/node-configs`);

      const ranSections = result.sections.filter((s) => s.status !== "skipped");
      const failed = ranSections.filter((s) => s.status === "failed");
      const partial = ranSections.filter((s) => s.status === "partial");
      const ok = ranSections.filter((s) => s.status === "ok");

      let status: RestoreActionState["status"];
      let message: string;
      if (failed.length === 0 && partial.length === 0) {
        status = "success";
        message = `Restored ${ok.length} section${ok.length === 1 ? "" : "s"} from snapshot.`;
      } else if (ok.length === 0 && partial.length === 0) {
        status = "error";
        message = "Restore failed for all selected sections.";
      } else {
        status = "error";
        message = `Restore completed with issues: ${ok.length} ok, ${partial.length} partial, ${failed.length} failed.`;
      }

      return {
        message,
        requestId: randomUUID(),
        result,
        status,
      };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to restore snapshot.",
      requestId: randomUUID(),
      result: null,
      status: "error",
    };
  }
}

export async function deleteConfigSnapshotAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };

    const snapshotId = String(formData.get("snapshotId") ?? "");
    if (!snapshotId) return { message: "Snapshot ID is required.", requestId: randomUUID(), status: "error" };

    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-settings");
    return await withSiteConfig(siteConfig, async () => {
      const deleted = await deleteConfigSnapshot(snapshotId);
      if (!deleted) return { message: "Snapshot not found.", requestId: randomUUID(), status: "error" };

      revalidatePath(`/sites/${siteSlug}/node-configs`);

      return {
        message: "Config snapshot deleted.",
        requestId: randomUUID(),
        status: "success",
      };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to delete snapshot.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

function parsePolicyInput(formData: FormData): ConfigSnapshotPolicyInput {
  const intervalRaw = Number(formData.get("intervalMinutes"));
  const retentionRaw = Number(formData.get("retentionCount"));
  return {
    description: String(formData.get("description") ?? "").trim(),
    enabled: formData.get("enabled") === "on",
    intervalMinutes:
      Number.isFinite(intervalRaw) && intervalRaw > 0 ? Math.max(15, Math.round(intervalRaw)) : 1440,
    name: String(formData.get("name") ?? "").trim() || "Unnamed schedule",
    nodeName: String(formData.get("nodeName") ?? "").trim(),
    retentionCount:
      Number.isFinite(retentionRaw) && retentionRaw >= 0 ? Math.max(0, Math.round(retentionRaw)) : 14,
  };
}

export async function createConfigSnapshotPolicyAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug)
      return { message: "Missing site context.", requestId: randomUUID(), status: "error" };

    const input = parsePolicyInput(formData);
    if (!input.nodeName)
      return { message: "Node is required.", requestId: randomUUID(), status: "error" };

    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-settings");
    return await withSiteConfig(siteConfig, async () => {
      const policy = await createConfigSnapshotPolicy(input);
      revalidatePath(`/sites/${siteSlug}/node-configs`);
      return {
        message: `Schedule "${policy.name}" created.`,
        requestId: randomUUID(),
        status: "success",
      };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to create schedule.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function updateConfigSnapshotPolicyAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug)
      return { message: "Missing site context.", requestId: randomUUID(), status: "error" };

    const id = String(formData.get("policyId") ?? "");
    if (!id)
      return { message: "Schedule ID is required.", requestId: randomUUID(), status: "error" };

    const input = parsePolicyInput(formData);
    if (!input.nodeName)
      return { message: "Node is required.", requestId: randomUUID(), status: "error" };

    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-settings");
    return await withSiteConfig(siteConfig, async () => {
      const policy = await updateConfigSnapshotPolicy(id, input);
      if (!policy)
        return { message: "Schedule not found.", requestId: randomUUID(), status: "error" };
      revalidatePath(`/sites/${siteSlug}/node-configs`);
      return {
        message: `Schedule "${policy.name}" updated.`,
        requestId: randomUUID(),
        status: "success",
      };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to update schedule.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function deleteConfigSnapshotPolicyAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug)
      return { message: "Missing site context.", requestId: randomUUID(), status: "error" };

    const id = String(formData.get("policyId") ?? "");
    if (!id)
      return { message: "Schedule ID is required.", requestId: randomUUID(), status: "error" };

    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-settings");
    return await withSiteConfig(siteConfig, async () => {
      const deleted = await deleteConfigSnapshotPolicy(id);
      if (!deleted)
        return { message: "Schedule not found.", requestId: randomUUID(), status: "error" };
      revalidatePath(`/sites/${siteSlug}/node-configs`);
      return {
        message: "Schedule deleted.",
        requestId: randomUUID(),
        status: "success",
      };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to delete schedule.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function toggleConfigSnapshotPolicyAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug)
      return { message: "Missing site context.", requestId: randomUUID(), status: "error" };

    const id = String(formData.get("policyId") ?? "");
    if (!id)
      return { message: "Schedule ID is required.", requestId: randomUUID(), status: "error" };

    const enabled = formData.get("enabled") === "on";

    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-settings");
    return await withSiteConfig(siteConfig, async () => {
      const policy = await toggleConfigSnapshotPolicy(id, enabled);
      if (!policy)
        return { message: "Schedule not found.", requestId: randomUUID(), status: "error" };
      revalidatePath(`/sites/${siteSlug}/node-configs`);
      return {
        message: `Schedule "${policy.name}" ${enabled ? "enabled" : "paused"}.`,
        requestId: randomUUID(),
        status: "success",
      };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to toggle schedule.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function runConfigSnapshotPolicyNowAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug)
      return { message: "Missing site context.", requestId: randomUUID(), status: "error" };

    const id = String(formData.get("policyId") ?? "");
    if (!id)
      return { message: "Schedule ID is required.", requestId: randomUUID(), status: "error" };

    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-settings");
    return await withSiteConfig(siteConfig, async () => {
      const forced = await forceConfigSnapshotPolicyDue(id);
      if (!forced)
        return { message: "Schedule not found.", requestId: randomUUID(), status: "error" };

      const result = await runConfigSnapshotTick();
      revalidatePath(`/sites/${siteSlug}/node-configs`);

      if (result.snapshotsTaken === 0 && result.errors.length > 0) {
        return {
          message: `Run failed: ${result.errors[0]}`,
          requestId: randomUUID(),
          status: "error",
        };
      }
      return {
        message:
          result.snapshotsTaken > 0
            ? `Snapshot taken (${result.snapshotsTaken} run${result.snapshotsTaken === 1 ? "" : "s"}).`
            : "No snapshot was taken. The schedule may be paused.",
        requestId: randomUUID(),
        status: result.snapshotsTaken > 0 ? "success" : "error",
      };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to run schedule.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}
