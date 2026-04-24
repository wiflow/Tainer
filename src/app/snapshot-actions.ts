"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { ProxmoxActionState } from "@/lib/action-states";
import { requireSitePermission, requireSession } from "@/lib/auth";
import { recordDeploymentActivity } from "@/lib/deployment-activity-log";
import { createRateLimiterOrThrow } from "@/lib/rate-limit";
import {
  createSnapshot,
  decodeDeploymentId,
  deleteSnapshot,
  rollbackSnapshot,
  validateUpid,
  withSiteConfig,
} from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

const enforceRateLimit = createRateLimiterOrThrow("snapshot-actions", 10, 5 * 60_000);

export async function createSnapshotAction(
  _previousState: ProxmoxActionState,
  formData: FormData,
): Promise<ProxmoxActionState> {
  try {
    const session = await requireSession();
    enforceRateLimit(session.user.id);

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return withSiteConfig(siteConfig, async () => {

    const deploymentId = String(formData.get("deploymentId") ?? "").trim();
    const snapname = String(formData.get("snapname") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();

    if (!deploymentId) {
      return { message: "No deployment specified.", requestId: randomUUID(), status: "error", task: null };
    }
    if (!snapname) {
      return { message: "Snapshot name is required.", requestId: randomUUID(), status: "error", task: null };
    }

    const { node, vmid, type } = decodeDeploymentId(deploymentId);

    const upid = await createSnapshot(node, vmid, type, snapname, description || undefined);
    const validUpid = validateUpid(upid);

    recordDeploymentActivity({
      action: "snapshot-created",
      deploymentId,
      message: `Snapshot "${snapname}" created for VMID ${vmid}`,
      userEmail: session.user.email,
      userName: session.user.name,
      vmid,
    }).catch(() => {});

    revalidatePath(`/sites/${siteSlug}/deployments/${deploymentId}`);

    return {
      message: `Snapshot "${snapname}" creation started.`,
      requestId: randomUUID(),
      status: "success",
      task: {
        node,
        siteSlug,
        submittedMessage: `Creating snapshot "${snapname}" for VMID ${vmid}…`,
        successHref: `/sites/${siteSlug}/deployments/${deploymentId}`,
        successMessage: `Snapshot "${snapname}" created successfully.`,
        title: `Creating snapshot "${snapname}"`,
        upid: validUpid,
      },
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to create snapshot.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function deleteSnapshotAction(
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
    requireSitePermission(session, siteConfig.siteId, "manage-snapshots");
    enforceRateLimit(session.user.id);

    return withSiteConfig(siteConfig, async () => {

    const deploymentId = String(formData.get("deploymentId") ?? "").trim();
    const snapname = String(formData.get("snapname") ?? "").trim();

    if (!deploymentId || !snapname) {
      return { message: "Missing deployment or snapshot name.", requestId: randomUUID(), status: "error", task: null };
    }

    const { node, vmid, type } = decodeDeploymentId(deploymentId);

    const upid = await deleteSnapshot(node, vmid, type, snapname);
    const validUpid = validateUpid(upid);

    recordDeploymentActivity({
      action: "snapshot-deleted",
      deploymentId,
      message: `Snapshot "${snapname}" deleted from VMID ${vmid}`,
      userEmail: session.user.email,
      userName: session.user.name,
      vmid,
    }).catch(() => {});

    revalidatePath(`/sites/${siteSlug}/deployments/${deploymentId}`);

    return {
      message: `Snapshot "${snapname}" deletion started.`,
      requestId: randomUUID(),
      status: "success",
      task: {
        node,
        siteSlug,
        submittedMessage: `Deleting snapshot "${snapname}" from VMID ${vmid}…`,
        successHref: `/sites/${siteSlug}/deployments/${deploymentId}`,
        successMessage: `Snapshot "${snapname}" deleted successfully.`,
        title: `Deleting snapshot "${snapname}"`,
        upid: validUpid,
      },
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to delete snapshot.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function rollbackSnapshotAction(
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
    requireSitePermission(session, siteConfig.siteId, "manage-snapshots");
    enforceRateLimit(session.user.id);

    return withSiteConfig(siteConfig, async () => {

    const deploymentId = String(formData.get("deploymentId") ?? "").trim();
    const snapname = String(formData.get("snapname") ?? "").trim();

    if (!deploymentId || !snapname) {
      return { message: "Missing deployment or snapshot name.", requestId: randomUUID(), status: "error", task: null };
    }

    const { node, vmid, type } = decodeDeploymentId(deploymentId);

    const upid = await rollbackSnapshot(node, vmid, type, snapname);
    const validUpid = validateUpid(upid);

    recordDeploymentActivity({
      action: "snapshot-rollback",
      deploymentId,
      message: `Rolled back VMID ${vmid} to snapshot "${snapname}"`,
      userEmail: session.user.email,
      userName: session.user.name,
      vmid,
    }).catch(() => {});

    revalidatePath(`/sites/${siteSlug}/deployments/${deploymentId}`);

    return {
      message: `Rolling back to snapshot "${snapname}"…`,
      requestId: randomUUID(),
      status: "success",
      task: {
        node,
        siteSlug,
        submittedMessage: `Rolling back VMID ${vmid} to snapshot "${snapname}"…`,
        successHref: `/sites/${siteSlug}/deployments/${deploymentId}`,
        successMessage: `Rollback to "${snapname}" completed.`,
        title: `Rolling back to "${snapname}"`,
        upid: validUpid,
      },
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to rollback snapshot.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}
