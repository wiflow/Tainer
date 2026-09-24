import "server-only";

import { getDeploymentDetail } from "@/lib/proxmox";
import { scanPorts } from "@/lib/port-scan";
import { recordDeploymentActivity } from "@/lib/deployment-activity-log";
import { registerTool } from "@/lib/copilot/registry";
import { runInSite, siteSlugSchema } from "@/lib/copilot/tools/helpers";

registerTool({
  name: "scan_deployment_ports",
  category: "Diagnostics",
  // Auto-runs as a read tool, but port scanning uses pct exec, so execute requires admin.
  klass: "read",
  description:
    "Scan an LXC container for open TCP ports and identify the services running on them (e.g. Grafana on 3000, SSH on 22, PostgreSQL on 5432). Returns a list of {port, service, url} entries. Admin-only. Use this when the user asks 'what services are running on X?' or 'where can I reach the web UI of Y?'.",
  input_schema: siteSlugSchema({
    deploymentId: {
      type: "string",
      description: "The deployment id returned by list_containers.",
    },
  }),
  describe: (args) =>
    `Scan ports on deployment ${String(args.deploymentId)} (site ${String(args.siteSlug)})`,
  execute: async (args, ctx) => {
    if (ctx.session.user.role !== "admin") {
      throw new Error(
        "Administrator access required for port scanning. It uses Proxmox SSH credentials under the hood.",
      );
    }
    const siteSlug = String(args.siteSlug ?? "");
    const deploymentId = String(args.deploymentId ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const detail = await getDeploymentDetail(deploymentId);
      if (!detail) throw new Error("Deployment not found.");
      if (detail.type !== "lxc") {
        throw new Error("Port scanning currently supports LXC containers only.");
      }
      const ip = detail.ipAddress?.trim() ?? "";
      if (!ip || ip === "Unavailable" || ip === "DHCP" || ip === "No IP") {
        throw new Error("Deployment has no routable IP address, can't port-scan.");
      }

      const ports = await scanPorts(ip, detail.node, detail.vmid);

      recordDeploymentActivity({
        action: "port-scanned",
        deploymentId,
        message: `Tainy port scan (${ports.length} open)`,
        userEmail: ctx.session.user.email,
        userName: ctx.session.user.name,
        vmid: detail.vmid,
      }).catch(() => {});

      return {
        deployment: {
          id: detail.id,
          vmid: detail.vmid,
          name: detail.name,
          node: detail.node,
          type: detail.type,
          status: detail.rawStatus,
          ip: detail.ipAddress,
        },
        ports,
      };
    });
  },
});
