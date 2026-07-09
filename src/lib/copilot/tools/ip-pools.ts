import "server-only";

import { getIpPoolCatalog, resolveIpPoolSelection } from "@/lib/ip-pools";
import {
  buildContainerNetworkConfig,
  decodeDeploymentId,
  getDeploymentDetail,
  updateContainerConfig,
} from "@/lib/proxmox";
import { recordDeploymentActivity } from "@/lib/deployment-activity-log";
import { registerTool } from "@/lib/copilot/registry";
import {
  runInSite,
  runInSiteWithPermission,
  siteSlugSchema,
} from "@/lib/copilot/tools/helpers";

// Cap the address lists we hand to the model — a /22 pool has 1000+ entries
// and the full list would blow the context for no benefit.
const MAX_AVAILABLE_IN_LIST = 10;
const MAX_AVAILABLE_IN_DETAIL = 50;
const MAX_USED_IN_DETAIL = 50;

registerTool({
  name: "list_ip_pools",
  category: "Network",
  klass: "read",
  description:
    "List the IP pools configured for a site: subnet, bridge, gateway, DNS, how many addresses are free, and the first few available IPs. Use this before change_deployment_ip to pick a free address. Availability accounts for both Tainer deployments and the external IPAM (when configured).",
  input_schema: siteSlugSchema(),
  describe: (args) => `List IP pools in site ${args.siteSlug}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const catalog = await getIpPoolCatalog();
      return catalog.map((pool) => ({
        id: pool.id,
        name: pool.name,
        subnet: pool.subnet,
        bridge: pool.bridge,
        gateway: pool.gateway,
        dns: pool.defaultDns,
        tagSlug: pool.tagSlug,
        usableHostCount: pool.usableHostCount,
        usedCount: pool.usedCount,
        availableCount: pool.availableCount,
        nextAvailable: pool.availableAddresses.slice(0, MAX_AVAILABLE_IN_LIST),
        ipamIssue: pool.ipamIssue,
      }));
    });
  },
});

registerTool({
  name: "get_ip_pool",
  category: "Network",
  klass: "read",
  description:
    "Get one IP pool in detail: which addresses are in use (and by which deployment), and a longer list of available addresses. Use when the user asks what's using an IP, or when the first few addresses from list_ip_pools aren't suitable.",
  input_schema: siteSlugSchema({
    poolId: {
      type: "string",
      description: "The pool id returned by list_ip_pools.",
    },
  }),
  describe: (args) => `Read IP pool ${args.poolId} in site ${args.siteSlug}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const poolId = String(args.poolId ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const catalog = await getIpPoolCatalog();
      const pool = catalog.find((entry) => entry.id === poolId);
      if (!pool) return { error: "IP pool not found. Use list_ip_pools for valid ids." };
      return {
        id: pool.id,
        name: pool.name,
        subnet: pool.subnet,
        bridge: pool.bridge,
        gateway: pool.gateway,
        dns: pool.defaultDns,
        tagSlug: pool.tagSlug,
        range: `${pool.firstHost} – ${pool.lastHost}`,
        usableHostCount: pool.usableHostCount,
        usedCount: pool.usedCount,
        availableCount: pool.availableCount,
        used: pool.usedAddresses.slice(0, MAX_USED_IN_DETAIL).map((entry) => ({
          address: entry.address,
          usedBy: entry.deploymentLabel,
          source: entry.source,
          service: entry.service,
        })),
        usedTruncated: Math.max(0, pool.usedAddresses.length - MAX_USED_IN_DETAIL),
        available: pool.availableAddresses.slice(0, MAX_AVAILABLE_IN_DETAIL),
        availableTruncated: Math.max(
          0,
          pool.availableAddresses.length - MAX_AVAILABLE_IN_DETAIL,
        ),
        ipamIssue: pool.ipamIssue,
      };
    });
  },
});

registerTool({
  name: "change_deployment_ip",
  category: "Network",
  klass: "write",
  description:
    "Change an LXC container's static IPv4 address to a free address from one of the site's IP pools. Rewrites the container's eth0 (net0) config with the pool's bridge, gateway, and prefix, and sets the pool's DNS servers when configured. The server validates that the address is actually free in that pool — already-used or out-of-range addresses are refused. A running container usually picks the new address up live, but some services cache the old IP until a restart_deployment. LXC only — QEMU VMs are not supported.",
  input_schema: siteSlugSchema({
    deploymentId: {
      type: "string",
      description: "The deployment id returned by list_containers (LXC only).",
    },
    poolId: {
      type: "string",
      description: "The IP pool id returned by list_ip_pools.",
    },
    address: {
      type: "string",
      description:
        "The exact IPv4 address to assign, picked from the pool's available addresses (see list_ip_pools / get_ip_pool). Always pass a specific address so the user can see it in the approval card.",
    },
  }),
  describe: (args) =>
    `Change IP of ${String(args.deploymentId)} to ${String(args.address)} (site ${String(args.siteSlug)})`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const deploymentId = String(args.deploymentId ?? "");
    const poolId = String(args.poolId ?? "");
    const address = String(args.address ?? "");

    return runInSiteWithPermission(ctx.session, siteSlug, "manage-deployments", async () => {
      const { node, vmid, type } = decodeDeploymentId(deploymentId);
      if (type !== "lxc") {
        throw new Error("change_deployment_ip supports LXC containers only.");
      }

      // Re-validates availability server-side at execution time — the model's
      // (or a stale approval card's) idea of "free" is not trusted.
      const selection = await resolveIpPoolSelection(poolId, address);

      const params = new URLSearchParams();
      params.set(
        "net0",
        buildContainerNetworkConfig({
          bridge: selection.bridge,
          gateway: selection.gateway,
          ipv4Cidr: selection.ipv4Cidr,
          mode: "static",
        }),
      );
      if (selection.nameserver) {
        params.set("nameserver", selection.nameserver);
      }
      await updateContainerConfig(node, vmid, params);

      recordDeploymentActivity({
        action: "network-updated",
        deploymentId,
        message: `Copilot moved CT ${vmid} to ${selection.ipv4Cidr} (pool "${selection.pool.name}")`,
        userEmail: ctx.session.user.email,
        userName: ctx.session.user.name,
        vmid,
      }).catch(() => {});

      let deployment = null;
      try {
        const detail = await getDeploymentDetail(deploymentId);
        deployment = detail
          ? { id: detail.id, vmid: detail.vmid, name: detail.name, node: detail.node, ip: detail.ipAddress }
          : null;
      } catch {
        // non-fatal — result still carries the applied config
      }

      return {
        ok: true,
        verb: "change-ip",
        applied: {
          address,
          cidr: selection.ipv4Cidr,
          gateway: selection.gateway,
          bridge: selection.bridge,
          dns: selection.nameserver || null,
          pool: selection.pool.name,
        },
        message: `CT ${vmid} moved to ${selection.ipv4Cidr} on ${selection.bridge}. If a service still answers on the old IP, restart the container.`,
        deployment,
      };
    });
  },
});
