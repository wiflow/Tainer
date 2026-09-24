"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { ProxmoxActionState } from "@/lib/action-states";
import { recordAdminAudit } from "@/lib/admin-audit-log";
import { saveAppSettings } from "@/lib/app-settings";
import { requireSitePermission, requireSession } from "@/lib/auth";
import { getContainerTagBySlug } from "@/lib/container-groups";
import { createIpPool, deleteIpPool } from "@/lib/ip-pools";
import { getRootfsTargets, listBackupStoragePools, withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

function revalidateIpPoolSurfaces(siteSlug: string) {
  revalidatePath(`/sites/${siteSlug}`);
  revalidatePath(`/sites/${siteSlug}/images`);
  revalidatePath(`/sites/${siteSlug}/settings`);
  revalidatePath(`/sites/${siteSlug}/templates`);
}

export async function updateRootfsDefaultsAction(
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
    requireSitePermission(session, siteConfig.siteId, "manage-settings");

    return await withSiteConfig(siteConfig, async () => {
    const defaultRootfsStorage = String(formData.get("defaultRootfsStorage") ?? "").trim();

    if (!defaultRootfsStorage) {
      return {
        message: "Pick a default rootfs storage pool before saving.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const { targets } = await getRootfsTargets();

    if (!targets.some((target) => target.storage === defaultRootfsStorage)) {
      return {
        message: "That storage pool is not currently available for LXC rootfs volumes.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    await saveAppSettings({
      defaultRootfsStorage,
    });

    recordAdminAudit({
      action: "settings-updated",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Updated default rootfs storage to ${defaultRootfsStorage}`,
    }).catch(() => {});

    revalidatePath(`/sites/${siteSlug}`);
    revalidatePath(`/sites/${siteSlug}/settings`);
    revalidatePath(`/sites/${siteSlug}/templates`);

    return {
      message: `Saved ${defaultRootfsStorage} as the default rootfs storage pool.`,
      requestId: randomUUID(),
      status: "success",
      task: null,
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to save settings.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function updateDockerLibraryAction(
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
    requireSitePermission(session, siteConfig.siteId, "manage-settings");

    return await withSiteConfig(siteConfig, async () => {
      const dockerLibraryPath = String(formData.get("dockerLibraryPath") ?? "").trim();

      if (dockerLibraryPath && !dockerLibraryPath.startsWith("/")) {
        return {
          message: "The library path must be absolute (start with '/'), e.g. /app/data/docker-library.",
          requestId: randomUUID(),
          status: "error",
          task: null,
        };
      }

      await saveAppSettings({ dockerLibraryPath });

      recordAdminAudit({
        action: "settings-updated",
        actorEmail: session.user.email,
        actorName: session.user.name,
        message: dockerLibraryPath
          ? `Set Docker library path to ${dockerLibraryPath}`
          : "Cleared Docker library path (falling back to env)",
      }).catch(() => {});

      revalidatePath(`/sites/${siteSlug}/settings`);
      revalidatePath(`/sites/${siteSlug}/images`);

      return {
        message: dockerLibraryPath
          ? `Docker library path set to ${dockerLibraryPath}.`
          : "Docker library path cleared (using environment default).",
        requestId: randomUUID(),
        status: "success",
        task: null,
      };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to save Docker library path.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function updateBackupDefaultsAction(
  _previousState: ProxmoxActionState,
  formData: FormData,
): Promise<ProxmoxActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    { const _s = await requireSession(); requireSitePermission(_s, siteConfig.siteId, "manage-settings"); }

    return await withSiteConfig(siteConfig, async () => {
    const defaultBackupStorage = String(formData.get("defaultBackupStorage") ?? "").trim();
    const slaHoursRaw = Number(formData.get("defaultBackupSlaHours"));
    const defaultBackupSlaHours = Number.isFinite(slaHoursRaw) && slaHoursRaw > 0 ? slaHoursRaw : 24;

    if (defaultBackupStorage) {
      const { pools } = await listBackupStoragePools();
      if (!pools.some((p) => p.storage === defaultBackupStorage)) {
        return {
          message: "That storage pool is not currently available as a backup target.",
          requestId: randomUUID(),
          status: "error",
          task: null,
        };
      }
    }

    await saveAppSettings({
      defaultBackupSlaHours,
      defaultBackupStorage,
    });

    revalidatePath(`/sites/${siteSlug}`);
    revalidatePath(`/sites/${siteSlug}/settings`);
    revalidatePath(`/sites/${siteSlug}/backups`);

    return {
      message: `Backup defaults saved${defaultBackupStorage ? ` (storage: ${defaultBackupStorage}, SLA: ${defaultBackupSlaHours}h)` : ` (SLA: ${defaultBackupSlaHours}h)`}.`,
      requestId: randomUUID(),
      status: "success",
      task: null,
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to save backup settings.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function createIpPoolAction(
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
    requireSitePermission(session, siteConfig.siteId, "manage-settings");

    return await withSiteConfig(siteConfig, async () => {
    const name = String(formData.get("name") ?? "").trim();
    const subnet = String(formData.get("subnet") ?? "").trim();
    const bridge = String(formData.get("bridge") ?? "").trim();
    const gateway = String(formData.get("gateway") ?? "").trim();
    const defaultDns = String(formData.get("defaultDns") ?? "").trim();
    const tagSlug = String(formData.get("tagSlug") ?? "").trim();

    if (tagSlug) {
      const tag = await getContainerTagBySlug(tagSlug);
      if (!tag) {
        throw new Error("The selected Tainer tag no longer exists.");
      }
    }

    const pool = await createIpPool({
      bridge,
      defaultDns,
      gateway,
      name,
      subnet,
      tagSlug: tagSlug || null,
    });

    recordAdminAudit({
      action: "ip-pool-created",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Created IP pool "${pool.name}" (${pool.subnet})`,
    }).catch(() => {});

    revalidateIpPoolSurfaces(siteSlug);

    return {
      message: `Created IP pool "${pool.name}" (${pool.subnet}).`,
      requestId: randomUUID(),
      status: "success",
      task: null,
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to create IP pool.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function deleteIpPoolAction(
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
    requireSitePermission(session, siteConfig.siteId, "manage-settings");

    return await withSiteConfig(siteConfig, async () => {
    const poolId = String(formData.get("poolId") ?? "").trim();
    const poolName = String(formData.get("poolName") ?? "").trim();

    if (!poolId) {
      throw new Error("Missing IP pool reference.");
    }

    const deleted = await deleteIpPool(poolId);
    if (!deleted) {
      throw new Error("That IP pool no longer exists.");
    }

    recordAdminAudit({
      action: "ip-pool-deleted",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Deleted IP pool "${poolName || poolId}"`,
    }).catch(() => {});

    revalidateIpPoolSurfaces(siteSlug);

    return {
      message: `Deleted IP pool "${poolName || poolId}".`,
      requestId: randomUUID(),
      status: "success",
      task: null,
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to delete IP pool.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}
