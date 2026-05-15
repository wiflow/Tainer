"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { BasicActionState } from "@/lib/action-states";
import { requirePermission, requireSession } from "@/lib/auth";
import { triggerManualBackupRun } from "@/lib/backup-engine";
import {
  createBackupPolicy,
  deleteBackupPolicy,
  duplicateBackupPolicy,
  toggleBackupPolicy,
  updateBackupPolicy,
  type BackupCompression,
  type BackupMode,
  type BackupPolicyInput,
  type BackupPolicyScope,
} from "@/lib/backup-policies";
import { withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

function parsePolicyInput(formData: FormData): BackupPolicyInput {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Policy name is required.");

  const storage = String(formData.get("storage") ?? "").trim();
  if (!storage) throw new Error("Target storage is required.");

  const scope = String(formData.get("scope") ?? "all") as BackupPolicyScope;
  const tagSlugs = scope === "tagged"
    ? String(formData.get("tagSlugs") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const validCompressions: BackupCompression[] = ["none", "lzo", "gzip", "zstd"];
  const compressionRaw = String(formData.get("compression") ?? "zstd");
  const compression: BackupCompression = validCompressions.includes(compressionRaw as BackupCompression)
    ? (compressionRaw as BackupCompression)
    : "zstd";

  const validModes: BackupMode[] = ["snapshot", "suspend", "stop"];
  const modeRaw = String(formData.get("mode") ?? "snapshot");
  const mode: BackupMode = validModes.includes(modeRaw as BackupMode)
    ? (modeRaw as BackupMode)
    : "snapshot";

  return {
    compression,
    description: String(formData.get("description") ?? "").trim(),
    enabled: formData.get("enabled") === "on",
    intervalMinutes: Math.max(
      60,
      Math.round(Number(formData.get("intervalMinutes") || "1440")),
    ),
    mode,
    name,
    retentionCount: Math.max(
      0,
      Math.round(Number(formData.get("retentionCount") || "0")),
    ),
    scope,
    storage,
    tagSlugs,
  };
}

export async function createBackupPolicyAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-backups");
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return await withSiteConfig(siteConfig, async () => {
    const input = parsePolicyInput(formData);
    await createBackupPolicy(input);
    revalidatePath(`/sites/${siteSlug}/backups`);

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

export async function updateBackupPolicyAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-backups");
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return await withSiteConfig(siteConfig, async () => {
    const policyId = String(formData.get("policyId") ?? "");
    if (!policyId) throw new Error("Policy ID is required.");

    const input = parsePolicyInput(formData);
    const updated = await updateBackupPolicy(policyId, input);
    if (!updated) throw new Error("Policy not found.");

    revalidatePath(`/sites/${siteSlug}/backups`);

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

export async function deleteBackupPolicyAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-backups");
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return await withSiteConfig(siteConfig, async () => {
    const policyId = String(formData.get("policyId") ?? "");
    if (!policyId) throw new Error("Policy ID is required.");

    const deleted = await deleteBackupPolicy(policyId);
    if (!deleted) throw new Error("Policy not found.");

    revalidatePath(`/sites/${siteSlug}/backups`);

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

export async function duplicateBackupPolicyAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-backups");
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return await withSiteConfig(siteConfig, async () => {
    const policyId = String(formData.get("policyId") ?? "");
    if (!policyId) throw new Error("Policy ID is required.");

    const copy = await duplicateBackupPolicy(policyId);
    if (!copy) throw new Error("Policy not found.");

    revalidatePath(`/sites/${siteSlug}/backups`);

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

export async function toggleBackupPolicyAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-backups");
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return await withSiteConfig(siteConfig, async () => {
    const policyId = String(formData.get("policyId") ?? "");
    const enabled = formData.get("enabled") === "true";

    const updated = await toggleBackupPolicy(policyId, enabled);
    if (!updated) throw new Error("Policy not found.");

    revalidatePath(`/sites/${siteSlug}/backups`);

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

export async function runBackupPolicyNowAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-backups");
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return await withSiteConfig(siteConfig, async () => {
    const policyId = String(formData.get("policyId") ?? "");
    if (!policyId) throw new Error("Policy ID is required.");

    const run = await triggerManualBackupRun(policyId, session.user.name);
    if (!run) throw new Error("Policy not found.");

    revalidatePath(`/sites/${siteSlug}/backups`);

    return {
      message: `Backup run started (${run.totalWorkloads} workload${run.totalWorkloads !== 1 ? "s" : ""}).`,
      requestId: randomUUID(),
      status: "success",
    };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to trigger backup.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}
