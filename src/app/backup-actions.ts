"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { ProxmoxActionState } from "@/lib/action-states";
import { getAppSettings } from "@/lib/app-settings";
import { requireSitePermission, requireSession } from "@/lib/auth";
import { recordDeploymentActivity } from "@/lib/deployment-activity-log";
import { createRateLimiterOrThrow } from "@/lib/rate-limit";

const enforceRateLimit = createRateLimiterOrThrow("backup-actions", 10, 5 * 60_000);
import { reapplySkippedCustomLxcConfig } from "@/lib/proxmox-host";
import {
  decodeDeploymentId,
  deleteBackup,
  encodeDeploymentId,
  getSkippedCustomLxcConfigLines,
  getNextId,
  listBackupStoragePools,
  restoreBackup,
  runContainerLifecycleAction,
  runVmLifecycleAction,
  triggerBackup,
  validateUpid,
  waitForTask,
  withSiteConfig,
} from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

export async function triggerBackupAction(
  _previousState: ProxmoxActionState,
  formData: FormData,
): Promise<ProxmoxActionState> {
  try {
    const session = await requireSession();
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-backups");
    enforceRateLimit(session.user.id);

    return await withSiteConfig(siteConfig, async () => {

    const deploymentId = String(formData.get("deploymentId") ?? "").trim();
    const storageOverride = String(formData.get("storage") ?? "").trim();

    if (!deploymentId) {
      return {
        message: "No deployment specified.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const { node, vmid } = decodeDeploymentId(deploymentId);

    let storage = storageOverride;
    if (!storage) {
      const settings = await getAppSettings();
      storage = settings.defaultBackupStorage;
    }

    if (!storage) {
      const { pools } = await listBackupStoragePools();
      const healthy = pools.find((p) => p.issues.length === 0);
      if (!healthy) {
        return {
          message: "No healthy backup storage available. Configure a backup-capable storage pool in Proxmox.",
          requestId: randomUUID(),
          status: "error",
          task: null,
        };
      }
      storage = healthy.storage;
    }

    const upid = await triggerBackup(node, vmid, storage);
    const validUpid = validateUpid(upid);

    recordDeploymentActivity({
      action: "backup-created",
      deploymentId,
      message: `Backup started for VMID ${vmid} on ${storage}`,
      userEmail: session.user.email,
      userName: session.user.name,
      vmid,
    }).catch(() => {});

    revalidatePath(`/sites/${siteSlug}/backups`);
    revalidatePath(`/sites/${siteSlug}/deployments/${deploymentId}`);

    return {
      message: `Backup started for VMID ${vmid} on ${storage}.`,
      requestId: randomUUID(),
      status: "success",
      task: {
        node,
        siteSlug,
        submittedMessage: `Backup of VMID ${vmid} submitted to ${storage}.`,
        successHref: `/sites/${siteSlug}/deployments/${deploymentId}`,
        successMessage: `Backup of VMID ${vmid} completed successfully.`,
        title: `Backing up VMID ${vmid}`,
        upid: validUpid,
      },
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to start backup.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function restoreBackupAction(
  _previousState: ProxmoxActionState,
  formData: FormData,
): Promise<ProxmoxActionState> {
  try {
    const session = await requireSession();
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-backups");

    return await withSiteConfig(siteConfig, async () => {

    const volid = String(formData.get("volid") ?? "").trim();
    const targetNode = String(formData.get("node") ?? "").trim();
    const storage = String(formData.get("storage") ?? "").trim();
    const targetVmidStr = String(formData.get("targetVmid") ?? "").trim();
    const replaceMode = formData.get("replace") === "1";

    if (!volid) {
      return {
        message: "No backup archive specified.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    if (!targetNode) {
      return {
        message: "Target node is required.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    if (!storage) {
      return {
        message: "Target storage for restored rootfs is required.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    let targetVmid: number;
    if (targetVmidStr) {
      targetVmid = Number.parseInt(targetVmidStr, 10);
      if (Number.isNaN(targetVmid) || targetVmid <= 0) {
        return {
          message: "Invalid target VMID.",
          requestId: randomUUID(),
          status: "error",
          task: null,
        };
      }
    } else {
      const nextIdStr = await getNextId();
      if (!nextIdStr) {
        return {
          message: "Could not allocate a new VMID from Proxmox.",
          requestId: randomUUID(),
          status: "error",
          task: null,
        };
      }
      targetVmid = Number.parseInt(nextIdStr, 10);
    }

    // Proxmox rejects a force restore over a running guest, so stop it first.
    if (replaceMode) {
      const restoredType = volid.includes("vzdump-lxc-") ? "lxc" : "qemu";
      try {
        const stopUpid = restoredType === "lxc"
          ? await runContainerLifecycleAction(targetNode, targetVmid, "stop")
          : await runVmLifecycleAction(targetNode, targetVmid, "stop");
        await waitForTask(targetNode, validateUpid(stopUpid));
      } catch {
      }
    }

    const upid = await restoreBackup(targetNode, targetVmid, volid, storage, replaceMode ? { force: true } : undefined);
    const validUpid = validateUpid(upid);
    const restoredType = volid.includes("vzdump-lxc-") ? "lxc" : "qemu";
    const restoredDeploymentId = encodeDeploymentId(targetNode, targetVmid, restoredType);

    if (restoredType === "lxc") {
      waitForTask(targetNode, validUpid)
        .then(async () => {
          const skippedLines = await getSkippedCustomLxcConfigLines(targetNode, validUpid);

          if (skippedLines.length === 0) {
            console.info(
              `Post-restore custom LXC config replay found no skipped lines for VMID ${targetVmid}.`,
            );
            return;
          }

          await reapplySkippedCustomLxcConfig(targetNode, targetVmid, skippedLines);
          console.info(
            `Post-restore custom LXC config replay applied ${skippedLines.length} line(s) for VMID ${targetVmid}.`,
          );
        })
        .catch((error) => {
          console.error(
            `Post-restore custom LXC config replay failed for VMID ${targetVmid}:`,
            error,
          );
        });
    }

    recordDeploymentActivity({
      action: "backup-restored",
      deploymentId: restoredDeploymentId,
      message: `Restored backup to VMID ${targetVmid} on ${targetNode}`,
      userEmail: session.user.email,
      userName: session.user.name,
      vmid: targetVmid,
    }).catch(() => {});

    revalidatePath(`/sites/${siteSlug}/backups`);
    revalidatePath(`/sites/${siteSlug}/deployments`);
    revalidatePath(`/sites/${siteSlug}/deployments/${restoredDeploymentId}`);

    return {
      message: `Restore started as VMID ${targetVmid} on ${targetNode}.`,
      requestId: randomUUID(),
      status: "success",
      task: {
        node: targetNode,
        siteSlug,
        submittedMessage: `Restoring backup to VMID ${targetVmid}.`,
        successHref: `/sites/${siteSlug}/deployments/${restoredDeploymentId}`,
        successMessage: restoredType === "lxc"
          ? `Backup restored as VMID ${targetVmid} on ${targetNode}. Any skipped custom LXC config will be replayed in the background.`
          : `Backup restored as VMID ${targetVmid} on ${targetNode}.`,
        title: `Restoring to VMID ${targetVmid}`,
        upid: validUpid,
      },
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to start restore.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function deleteBackupAction(
  _previousState: ProxmoxActionState,
  formData: FormData,
): Promise<ProxmoxActionState> {
  try {
    const session = await requireSession();
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-backups");

    return await withSiteConfig(siteConfig, async () => {

    const volid = String(formData.get("volid") ?? "").trim();
    const node = String(formData.get("node") ?? "").trim();
    const storage = String(formData.get("storage") ?? "").trim();

    if (!volid || !node || !storage) {
      return {
        message: "Missing backup archive details.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const upid = await deleteBackup(node, storage, volid);

    revalidatePath(`/sites/${siteSlug}/backups`);

    if (upid) {
      const validUpid = validateUpid(upid);

      return {
        message: "Backup deletion started.",
        requestId: randomUUID(),
        status: "success",
        task: {
          node,
          siteSlug,
          submittedMessage: "Deleting backup archive...",
          successMessage: "Backup archive deleted successfully.",
          title: "Deleting backup",
          upid: validUpid,
        },
      };
    }

    return {
      message: "Backup archive deleted.",
      requestId: randomUUID(),
      status: "success",
      task: null,
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to delete backup.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}
