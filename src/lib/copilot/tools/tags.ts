import "server-only";

import {
  decodeDeploymentId,
  getDeploymentDetail,
  getDeploymentIndex,
  migrateContainer,
  migrateVm,
  updateContainerConfig,
  updateVmConfig,
} from "@/lib/proxmox";
import { listContainerTags } from "@/lib/container-groups";
import { normalizeTagValues, stringifyTagValues } from "@/lib/tag-utils";
import { recordDeploymentActivity } from "@/lib/deployment-activity-log";
import { registerTool } from "@/lib/copilot/registry";
import {
  runInSite,
  runInSiteWithPermission,
  siteSlugSchema,
} from "@/lib/copilot/tools/helpers";

registerTool({
  name: "list_tags",
  category: "Containers",
  klass: "read",
  description:
    "List the container tags defined in a site (curated groups) plus how the copilot can filter by them. Use before set_deployment_tags, or to answer 'what tags exist?' / 'group containers by tag'.",
  input_schema: siteSlugSchema(),
  describe: (args) => `List tags in site ${String(args.siteSlug)}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const tags = await listContainerTags();
      const { deployments } = await getDeploymentIndex();
      return tags.map((t) => ({
        slug: t.slug,
        name: t.name,
        color: t.color,
        memberCount: deployments.filter((d) => d.tagList.includes(t.slug)).length,
      }));
    });
  },
});

registerTool({
  name: "set_deployment_tags",
  category: "Containers",
  klass: "write",
  description:
    "Add and/or remove tags on a container or VM. Pass tags to add and/or tags to remove; other existing tags are preserved. Use for 'tag web01 as prod', 'remove the staging tag from CT 105'. Tags are free-form strings; use list_tags to see curated ones.",
  input_schema: siteSlugSchema({
    deploymentId: {
      type: "string",
      description: "The deployment id from list_containers.",
    },
    add: {
      type: "array",
      items: { type: "string" },
      description: "Tags to add. Omit or [] for none.",
    },
    remove: {
      type: "array",
      items: { type: "string" },
      description: "Tags to remove. Omit or [] for none.",
    },
  }),
  describe: (args) => {
    const add = Array.isArray(args.add) ? (args.add as string[]) : [];
    const remove = Array.isArray(args.remove) ? (args.remove as string[]) : [];
    const parts: string[] = [];
    if (add.length) parts.push(`+${add.join(", ")}`);
    if (remove.length) parts.push(`-${remove.join(", ")}`);
    return `Tags on ${String(args.deploymentId)}: ${parts.join(" ") || "(no change)"} (site ${String(args.siteSlug)})`;
  },
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const deploymentId = String(args.deploymentId ?? "");
    const add = Array.isArray(args.add) ? (args.add as unknown[]).map(String) : [];
    const remove = Array.isArray(args.remove) ? (args.remove as unknown[]).map(String) : [];
    if (add.length === 0 && remove.length === 0) {
      throw new Error("Pass at least one tag to add or remove.");
    }

    return runInSiteWithPermission(ctx.session, siteSlug, "manage-deployments", async () => {
      const detail = await getDeploymentDetail(deploymentId);
      if (!detail) throw new Error("Deployment not found.");

      const removeSet = new Set(normalizeTagValues(remove));
      const next = normalizeTagValues([...detail.tagList, ...add]).filter(
        (t) => !removeSet.has(t),
      );

      const { node, vmid, type } = decodeDeploymentId(deploymentId);
      const params = new URLSearchParams();
      if (next.length === 0) {
        params.set("delete", "tags");
      } else {
        params.set("tags", stringifyTagValues(next));
      }
      if (type === "qemu") await updateVmConfig(node, vmid, params);
      else await updateContainerConfig(node, vmid, params);

      recordDeploymentActivity({
        action: "resources-updated",
        deploymentId,
        message: `Copilot updated tags on ${type === "qemu" ? "VM" : "CT"} ${vmid} → [${next.join(", ")}]`,
        userEmail: ctx.session.user.email,
        userName: ctx.session.user.name,
        vmid,
      }).catch(() => {});

      return {
        ok: true,
        verb: "update-resources",
        applied: { tags: next.join(", ") || "(none)" },
        deployment: {
          id: detail.id,
          vmid: detail.vmid,
          name: detail.name,
          node: detail.node,
          type: detail.type,
          status: detail.rawStatus,
          ip: detail.ipAddress,
        },
      };
    });
  },
});

registerTool({
  name: "migrate_deployment",
  category: "Containers",
  klass: "write",
  description:
    "Migrate (move) a container or VM to a different Proxmox node in the same cluster. For LXC this uses restart-migration (a brief restart); for QEMU it uses live migration where possible. Use for 'move web01 to node2', 'rebalance the busy container off node1'. Use list_nodes to see valid target nodes.",
  input_schema: siteSlugSchema({
    deploymentId: {
      type: "string",
      description: "The deployment id from list_containers.",
    },
    targetNode: {
      type: "string",
      description: "The destination node name (from list_nodes). Must differ from the current node.",
    },
  }),
  describe: (args) =>
    `Migrate ${String(args.deploymentId)} → node ${String(args.targetNode)} (site ${String(args.siteSlug)})`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const deploymentId = String(args.deploymentId ?? "");
    const targetNode = String(args.targetNode ?? "").trim();
    if (!targetNode) throw new Error("targetNode is required.");

    return runInSiteWithPermission(ctx.session, siteSlug, "manage-deployments", async () => {
      const { node, vmid, type } = decodeDeploymentId(deploymentId);
      if (node === targetNode) {
        throw new Error(`Already on node "${targetNode}" — nothing to migrate.`);
      }
      const upid =
        type === "qemu"
          ? await migrateVm(node, vmid, targetNode)
          : await migrateContainer(node, vmid, targetNode);

      recordDeploymentActivity({
        action: "migrated",
        deploymentId,
        message: `Copilot migrated ${type === "qemu" ? "VM" : "CT"} ${vmid} from ${node} to ${targetNode}`,
        userEmail: ctx.session.user.email,
        userName: ctx.session.user.name,
        vmid,
      }).catch(() => {});

      return {
        ok: true,
        verb: "migrate",
        upid,
        fromNode: node,
        toNode: targetNode,
        message: `Migrating ${type === "qemu" ? "VM" : "CT"} ${vmid} from ${node} to ${targetNode}.`,
      };
    });
  },
});
