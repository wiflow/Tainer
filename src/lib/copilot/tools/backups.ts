import "server-only";

import {
  decodeDeploymentId,
  getDeploymentDetail,
  listAllBackups,
  listBackupStoragePools,
  listBackupsForVm,
  restoreBackup,
  triggerBackup,
  type ProxmoxBackupArchive,
} from "@/lib/proxmox";
import { recordDeploymentActivity } from "@/lib/deployment-activity-log";
import { registerTool } from "@/lib/copilot/registry";
import {
  runInSite,
  runInSiteWithPermission,
  siteSlugSchema,
} from "@/lib/copilot/tools/helpers";

function leanArchive(a: ProxmoxBackupArchive) {
  return {
    volid: a.volid,
    vmid: a.vmid,
    node: a.node,
    storage: a.storage,
    createdAt: a.ctimeIso,
    sizeBytes: a.sizeBytes,
    format: a.format,
    notes: a.notes,
  };
}

registerTool({
  name: "list_backups",
  category: "Backups",
  klass: "read",
  description:
    "List backup archives in a site. Without a deploymentId, returns every backup across the cluster (newest first). With a deploymentId, returns just that container/VM's backups. Each archive has a volid (use for restore_backup), the VMID it belongs to, storage, creation time, and size.",
  input_schema: siteSlugSchema({
    deploymentId: {
      type: "string",
      description:
        "Optional deployment id from list_containers to filter to one guest's backups.",
    },
  }),
  describe: (args) =>
    args.deploymentId
      ? `List backups for ${String(args.deploymentId)} (site ${String(args.siteSlug)})`
      : `List all backups in site ${String(args.siteSlug)}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const deploymentId = typeof args.deploymentId === "string" ? args.deploymentId.trim() : "";
    return runInSite(ctx.session, siteSlug, async () => {
      if (deploymentId) {
        const { node, vmid } = decodeDeploymentId(deploymentId);
        const { archives } = await listBackupsForVm(node, vmid);
        return archives.map(leanArchive);
      }
      const { archives } = await listAllBackups();
      return archives.map(leanArchive);
    });
  },
});

registerTool({
  name: "create_backup",
  category: "Backups",
  klass: "write",
  description:
    "Create a backup (vzdump snapshot) of a container or VM. Uses zstd compression and snapshot mode by default (no downtime). If no storage is given, the first backup-capable storage in the site is used. Returns the backup task UPID. Good before risky changes ('back up CT 101 before I upgrade it').",
  input_schema: siteSlugSchema({
    deploymentId: {
      type: "string",
      description: "The deployment id from list_containers to back up.",
    },
    storage: {
      type: "string",
      description:
        "Optional backup storage name (from list_storage_pools / list_backups). Omit to auto-pick the first backup-capable storage.",
    },
    notes: {
      type: "string",
      description: "Optional note stamped on the archive.",
    },
  }),
  describe: (args) =>
    `Back up ${String(args.deploymentId)}${args.storage ? ` to ${String(args.storage)}` : ""} (site ${String(args.siteSlug)})`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const deploymentId = String(args.deploymentId ?? "");
    const requestedStorage = typeof args.storage === "string" ? args.storage.trim() : "";
    const notes = typeof args.notes === "string" ? args.notes.trim() : "";

    return runInSiteWithPermission(ctx.session, siteSlug, "manage-backups", async () => {
      const { node, vmid, type } = decodeDeploymentId(deploymentId);

      let storage = requestedStorage;
      if (!storage) {
        const { pools } = await listBackupStoragePools();
        const pick = pools.find((p) => p.node === node) ?? pools[0];
        if (!pick) throw new Error("No backup-capable storage found in this site.");
        storage = pick.storage;
      }

      const upid = await triggerBackup(node, vmid, storage, {
        notes: notes || undefined,
      });

      recordDeploymentActivity({
        action: "backup-created",
        deploymentId,
        message: `Tainy backed up ${type === "qemu" ? "VM" : "CT"} ${vmid} to ${storage}`,
        userEmail: ctx.session.user.email,
        userName: ctx.session.user.name,
        vmid,
      }).catch(() => {});

      return {
        ok: true,
        verb: "backup-create",
        upid,
        storage,
        message: `Backup of ${type === "qemu" ? "VM" : "CT"} ${vmid} started to ${storage}.`,
      };
    });
  },
});

registerTool({
  name: "restore_backup",
  category: "Backups",
  klass: "destructive",
  description:
    "Restore a backup archive OVER an existing container/VM, replacing its current rootfs/disks. This is destructive and irreversible. The guest should be stopped first. Use the archive volid from list_backups and the deployment id of the target to overwrite. Requires typing the target's name to confirm.",
  input_schema: siteSlugSchema({
    deploymentId: {
      type: "string",
      description: "The deployment id to restore INTO (will be overwritten).",
    },
    archiveVolid: {
      type: "string",
      description: "The backup archive volid from list_backups.",
    },
    storage: {
      type: "string",
      description:
        "Storage to restore the rootfs onto. Omit to reuse the target's current rootfs storage.",
    },
    confirmName: {
      type: "string",
      description: "The target's current name (from get_container). The server rejects a mismatch.",
    },
  }),
  describe: (args) =>
    `RESTORE ${String(args.archiveVolid)} over ${String(args.deploymentId)}${args.storage ? ` onto storage ${String(args.storage)}` : ""} (site ${String(args.siteSlug)})`,
  confirmString: (args) => String(args.confirmName ?? ""),
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const deploymentId = String(args.deploymentId ?? "");
    const archiveVolid = String(args.archiveVolid ?? "");
    const confirmName = String(args.confirmName ?? "");
    const requestedStorage = typeof args.storage === "string" ? args.storage.trim() : "";

    return runInSiteWithPermission(ctx.session, siteSlug, "manage-backups", async () => {
      const detail = await getDeploymentDetail(deploymentId);
      if (!detail) throw new Error("Target deployment not found.");
      if (detail.name !== confirmName) {
        throw new Error(
          `confirmName mismatch: expected "${detail.name}", got "${confirmName}". Refusing to restore.`,
        );
      }
      if (detail.rawStatus === "running") {
        throw new Error(
          `${detail.name} is running. Stop it first (stop_deployment), then restore.`,
        );
      }

      const { node, vmid } = decodeDeploymentId(deploymentId);
      // rootfs is a Proxmox volume spec like "local-lvm:vm-101-disk-0,size=8G".
      const rootfsStorage = detail.rootfs.includes(":") ? detail.rootfs.split(":")[0] : "";
      const storage = requestedStorage || rootfsStorage;
      if (!storage) throw new Error("Couldn't determine target storage. Pass storage explicitly.");

      const upid = await restoreBackup(node, vmid, archiveVolid, storage, { force: true });

      recordDeploymentActivity({
        action: "backup-restored",
        deploymentId,
        message: `Tainy restored ${detail.name} (${vmid}) from ${archiveVolid}`,
        userEmail: ctx.session.user.email,
        userName: ctx.session.user.name,
        vmid,
      }).catch(() => {});

      return {
        ok: true,
        verb: "backup-restore",
        upid,
        message: `Restoring ${detail.name} from ${archiveVolid}.`,
      };
    });
  },
});
