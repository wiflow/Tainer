import "server-only";

import { getDashboardOverviewData } from "@/lib/proxmox";
import { registerTool } from "@/lib/copilot/registry";
import { runInSite, siteSlugSchema } from "@/lib/copilot/tools/helpers";

registerTool({
  name: "get_cluster_overview",
  category: "Cluster",
  klass: "read",
  description:
    "Get a cluster-wide overview for a site: node list with status, aggregate CPU/memory/disk usage, and current deployment summary. Use this for general 'how is the cluster doing?' questions.",
  input_schema: siteSlugSchema(),
  describe: (args) => `Read cluster overview for site ${args.siteSlug}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const data = await getDashboardOverviewData();
      return {
        nodes: data.nodes,
        nodeMetrics: data.nodeMetrics.map((m) => ({
          node: m.node,
          cpuRatio: m.cpuRatio,
          memoryUsedBytes: m.memoryUsedBytes,
          memoryTotalBytes: m.memoryTotalBytes,
          swapUsedBytes: m.swapUsedBytes,
          swapTotalBytes: m.swapTotalBytes,
          rootfsUsedBytes: m.rootfsUsedBytes,
          rootfsTotalBytes: m.rootfsTotalBytes,
          loadAverage: m.loadAverage,
          uptimeSeconds: m.uptimeSeconds,
        })),
        clusterResources: data.clusterResources,
        deploymentCount: data.deployments.length,
        runningCount: data.deployments.filter((d) => d.rawStatus === "running").length,
        stoppedCount: data.deployments.filter((d) => d.rawStatus === "stopped").length,
        issues: data.issues.slice(0, 10),
      };
    });
  },
});

registerTool({
  name: "list_nodes",
  category: "Cluster",
  klass: "read",
  description:
    "List nodes in a Proxmox cluster with their status. Lighter than get_cluster_overview when you just need names/status.",
  input_schema: siteSlugSchema(),
  describe: (args) => `List nodes in site ${args.siteSlug}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const data = await getDashboardOverviewData();
      return data.nodes;
    });
  },
});
