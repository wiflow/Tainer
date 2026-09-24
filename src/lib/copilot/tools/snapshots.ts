import "server-only";

import { recordDeploymentActivity } from "@/lib/deployment-activity-log";
import {
  createSnapshot,
  decodeDeploymentId,
  deleteSnapshot,
  getDeploymentDetail,
  listSnapshots,
  rollbackSnapshot,
} from "@/lib/proxmox";
import { registerTool } from "@/lib/copilot/registry";
import { runInSite, runInSiteWithPermission, siteSlugSchema } from "@/lib/copilot/tools/helpers";

const SNAPNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;

registerTool({
  name: "list_snapshots",
  category: "Snapshots",
  klass: "read",
  description:
    "List snapshots for a deployment (LXC or VM). Returns each snapshot's name, parent, created-at, description, and whether it captured RAM state.",
  input_schema: siteSlugSchema({
    deploymentId: { type: "string", description: "Deployment id from list_containers." },
  }),
  describe: (args) => `List snapshots for ${String(args.deploymentId)}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const deploymentId = String(args.deploymentId ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const { node, vmid, type } = decodeDeploymentId(deploymentId);
      const detail = await getDeploymentDetail(deploymentId);
      const snapshots = await listSnapshots(node, vmid, type);
      return {
        deployment: detail
          ? {
              id: detail.id,
              vmid: detail.vmid,
              name: detail.name,
              node: detail.node,
              type: detail.type,
              status: detail.rawStatus,
              ip: detail.ipAddress,
            }
          : null,
        snapshots,
      };
    });
  },
});

registerTool({
  name: "create_snapshot",
  category: "Snapshots",
  klass: "write",
  description:
    "Take a new snapshot of a deployment. Snapshots capture the rootfs (and optionally RAM for QEMU) at a point in time so you can roll back later. Use a short, descriptive name.",
  input_schema: siteSlugSchema({
    deploymentId: { type: "string", description: "Deployment id from list_containers." },
    snapshotName: {
      type: "string",
      description:
        "Snapshot name. Letters/digits/underscore/hyphen, must start with a letter, max 40 chars.",
    },
    description: {
      type: "string",
      description: "Optional human-readable note about why this snapshot was taken.",
    },
  }),
  describe: (args) =>
    `Snapshot ${String(args.deploymentId)} as "${String(args.snapshotName)}"`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const deploymentId = String(args.deploymentId ?? "");
    const snapshotName = String(args.snapshotName ?? "").trim();
    const description = String(args.description ?? "").trim() || undefined;

    if (!SNAPNAME_REGEX.test(snapshotName)) {
      throw new Error(
        `Snapshot name must match [a-zA-Z][a-zA-Z0-9_-]{0,39} — got "${snapshotName}".`,
      );
    }

    return runInSiteWithPermission(ctx.session, siteSlug, "manage-snapshots", async () => {
      const { node, vmid, type } = decodeDeploymentId(deploymentId);
      const upid = await createSnapshot(node, vmid, type, snapshotName, description);

      recordDeploymentActivity({
        action: "snapshot-created",
        deploymentId,
        message: `Tainy created snapshot "${snapshotName}"`,
        userEmail: ctx.session.user.email,
        userName: ctx.session.user.name,
        vmid,
      }).catch(() => {});

      const detail = await getDeploymentDetail(deploymentId).catch(() => null);
      return {
        ok: true,
        verb: "snapshot-create",
        snapshotName,
        upid,
        message: `Snapshot "${snapshotName}" submitted.`,
        deployment: detail
          ? {
              id: detail.id,
              vmid: detail.vmid,
              name: detail.name,
              node: detail.node,
              type: detail.type,
              status: detail.rawStatus,
              ip: detail.ipAddress,
            }
          : null,
      };
    });
  },
});

registerTool({
  name: "rollback_snapshot",
  category: "Snapshots",
  klass: "destructive",
  description:
    "Roll a deployment back to a snapshot. THIS DISCARDS ALL CHANGES made since the snapshot was taken — rootfs and (for VMs with snapshotted RAM) memory state are overwritten. Container is briefly stopped during the rollback.",
  input_schema: siteSlugSchema({
    deploymentId: { type: "string", description: "Deployment id from list_containers." },
    snapshotName: {
      type: "string",
      description: "Snapshot name to roll back to (from list_snapshots).",
    },
  }),
  describe: (args) =>
    `ROLL BACK ${String(args.deploymentId)} to snapshot "${String(args.snapshotName)}"`,
  confirmString: (args) => String(args.snapshotName ?? ""),
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const deploymentId = String(args.deploymentId ?? "");
    const snapshotName = String(args.snapshotName ?? "").trim();

    return runInSiteWithPermission(ctx.session, siteSlug, "manage-snapshots", async () => {
      const { node, vmid, type } = decodeDeploymentId(deploymentId);
      const snapshots = await listSnapshots(node, vmid, type);
      if (!snapshots.some((s) => s.name === snapshotName)) {
        throw new Error(
          `Snapshot "${snapshotName}" not found on ${type === "qemu" ? "VM" : "CT"} ${vmid}.`,
        );
      }

      const upid = await rollbackSnapshot(node, vmid, type, snapshotName);

      recordDeploymentActivity({
        action: "snapshot-rollback",
        deploymentId,
        message: `Tainy rolled back to snapshot "${snapshotName}"`,
        userEmail: ctx.session.user.email,
        userName: ctx.session.user.name,
        vmid,
      }).catch(() => {});

      const detail = await getDeploymentDetail(deploymentId).catch(() => null);
      return {
        ok: true,
        verb: "snapshot-rollback",
        snapshotName,
        upid,
        message: `Rollback to "${snapshotName}" submitted.`,
        deployment: detail
          ? {
              id: detail.id,
              vmid: detail.vmid,
              name: detail.name,
              node: detail.node,
              type: detail.type,
              status: detail.rawStatus,
              ip: detail.ipAddress,
            }
          : null,
      };
    });
  },
});

registerTool({
  name: "delete_snapshot",
  category: "Snapshots",
  klass: "write",
  description: "Delete a snapshot. Can't be undone, but doesn't touch the live deployment.",
  input_schema: siteSlugSchema({
    deploymentId: { type: "string", description: "Deployment id from list_containers." },
    snapshotName: { type: "string", description: "Snapshot name from list_snapshots." },
  }),
  describe: (args) =>
    `Delete snapshot "${String(args.snapshotName)}" from ${String(args.deploymentId)}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const deploymentId = String(args.deploymentId ?? "");
    const snapshotName = String(args.snapshotName ?? "").trim();
    if (!snapshotName) throw new Error("snapshotName is required.");

    return runInSiteWithPermission(ctx.session, siteSlug, "manage-snapshots", async () => {
      const { node, vmid, type } = decodeDeploymentId(deploymentId);
      const upid = await deleteSnapshot(node, vmid, type, snapshotName);

      recordDeploymentActivity({
        action: "snapshot-deleted",
        deploymentId,
        message: `Tainy deleted snapshot "${snapshotName}"`,
        userEmail: ctx.session.user.email,
        userName: ctx.session.user.name,
        vmid,
      }).catch(() => {});

      return {
        ok: true,
        verb: "snapshot-delete",
        snapshotName,
        upid,
        message: `Deleted snapshot "${snapshotName}".`,
      };
    });
  },
});
