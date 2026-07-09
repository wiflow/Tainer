import "server-only";

import { getOverviewData } from "@/lib/proxmox";
import { listIpPools } from "@/lib/ip-pools";
import { registerTool } from "@/lib/copilot/registry";
import { runInSite, siteSlugSchema } from "@/lib/copilot/tools/helpers";

registerTool({
  name: "list_storage_pools",
  category: "Storage",
  klass: "read",
  description:
    "List Proxmox storage pools for a site with capacity/usage. Use this to answer 'where can I put a container' or 'why is storage full'.",
  input_schema: siteSlugSchema(),
  describe: (args) => `List storage pools in site ${args.siteSlug}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const { storagePools } = await getOverviewData();
      return storagePools.map((p) => ({
        node: p.node,
        storage: p.storage,
        type: p.type,
        shared: p.shared,
        usedBytes: p.usedBytes,
        availableBytes: p.availableBytes,
        totalBytes: p.totalBytes,
        usageRatio: p.usageRatio,
        contentTypes: p.contentTypes,
      }));
    });
  },
});

registerTool({
  name: "list_ip_pools",
  category: "Network",
  klass: "read",
  description:
    "List configured IP pools for a site (subnet, gateway, allocations). IP pools are per-site. Useful when the user is planning a deployment and needs to pick an address.",
  input_schema: siteSlugSchema(),
  describe: (args) => `List IP pools in site ${String(args.siteSlug)}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const pools = await listIpPools();
      return pools.map((p) => ({
        id: p.id,
        name: p.name,
        subnet: p.subnet,
        gateway: p.gateway,
        defaultDns: p.defaultDns,
        bridge: p.bridge,
        tagSlug: p.tagSlug,
      }));
    });
  },
});
