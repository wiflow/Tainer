import "server-only";

import { decodeDeploymentId, getGuestRrdData } from "@/lib/proxmox";
import { registerTool } from "@/lib/copilot/registry";
import { runInSite, siteSlugSchema } from "@/lib/copilot/tools/helpers";

const TIMEFRAMES = ["hour", "day", "week", "month", "year"] as const;

registerTool({
  name: "get_deployment_metrics",
  category: "Diagnostics",
  klass: "read",
  description:
    "Get the historical CPU %, memory %, and network throughput trend for a container/VM over a timeframe (hour/day/week/month/year). Returns average and peak plus a compact series. Use for 'is web01 trending hot?', 'show memory over the last day', 'has CPU been spiking this week?'. get_container only shows the current instant; this shows the trend.",
  input_schema: siteSlugSchema({
    deploymentId: {
      type: "string",
      description: "The deployment id from list_containers.",
    },
    timeframe: {
      type: "string",
      enum: [...TIMEFRAMES],
      description: "Window to summarise. Defaults to 'day'.",
    },
  }),
  describe: (args) =>
    `Metrics for ${String(args.deploymentId)} over ${String(args.timeframe ?? "day")} (site ${String(args.siteSlug)})`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const deploymentId = String(args.deploymentId ?? "");
    const timeframe = (TIMEFRAMES as readonly string[]).includes(String(args.timeframe))
      ? (String(args.timeframe) as (typeof TIMEFRAMES)[number])
      : "day";
    return runInSite(ctx.session, siteSlug, async () => {
      const { node, vmid, type } = decodeDeploymentId(deploymentId);
      const series = await getGuestRrdData(node, vmid, type, timeframe);
      return {
        deploymentId,
        vmid,
        timeframe,
        points: series.points,
        cpuPercent: series.cpuPercent,
        memPercent: series.memPercent,
        netInKBps: series.netInKBps,
        netOutKBps: series.netOutKBps,
        issue: series.issue,
      };
    });
  },
});
