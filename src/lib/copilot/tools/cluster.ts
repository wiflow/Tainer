import "server-only";

import { getDashboardOverviewData, getTaskSnapshot } from "@/lib/proxmox";
import { registerTool } from "@/lib/copilot/registry";
import { runInSite, siteSlugSchema } from "@/lib/copilot/tools/helpers";

registerTool({
  name: "get_task_status",
  category: "Cluster",
  klass: "read",
  description:
    "Check the status of a Proxmox task by its UPID (returned by tools like pull_docker_image, download_iso, create_backup). Returns completed (true/false), status (running/success/warning/error), progress %, and the latest log line. Use this to wait for a long task before the next step, e.g. poll after pull_docker_image until completed before create_container_from_image. If still running, tell the user briefly and check again on their next message rather than looping endlessly.",
  input_schema: siteSlugSchema({
    node: { type: "string", description: "Node the task runs on (from the tool that returned the UPID)." },
    upid: { type: "string", description: "Task UPID, e.g. 'UPID:node1:...'." },
  }),
  describe: (args) => `Check task status on ${String(args.node)}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const node = String(args.node ?? "").trim();
    const upid = String(args.upid ?? "").trim();
    if (!node || !upid) throw new Error("node and upid are required.");
    return runInSite(ctx.session, siteSlug, async () => {
      const snapshot = await getTaskSnapshot(node, upid);
      return {
        completed: snapshot.completed,
        status: snapshot.status,
        progress: snapshot.progress,
        exitStatus: snapshot.exitStatus,
        latestLog: snapshot.latestLog,
        taskType: snapshot.taskType,
        message: snapshot.message,
      };
    });
  },
});

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
