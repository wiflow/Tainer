import "server-only";

import { getDeploymentNetSpecs, withSiteConfig } from "@/lib/proxmox";
import { resolveDeploymentNetworkPath } from "@/lib/lldp-deployment-path";
import { getLldpSnapshotsForSite } from "@/lib/lldp-snapshots";
import { registerTool } from "@/lib/copilot/registry";
import { resolveSiteForUser, siteSlugSchema } from "@/lib/copilot/tools/helpers";

registerTool({
  name: "get_network_path",
  category: "Network",
  klass: "read",
  returnsExternalContent: true,
  description:
    "Trace a container/VM's physical network path: for each interface, the bridge on the host, the uplink NIC, and (from LLDP) the upstream switch + port + VLAN it terminates at. Answers 'what switch is CT 101 behind?', 'which port does web01 use?', 'are these two containers on the same switch?'. Requires an LLDP agent to have reported from the hosting node; otherwise returns the local chain only.",
  input_schema: siteSlugSchema({
    deploymentId: {
      type: "string",
      description: "The deployment id from list_containers.",
    },
  }),
  describe: (args) => `Trace network path for ${String(args.deploymentId)} (site ${String(args.siteSlug)})`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const deploymentId = String(args.deploymentId ?? "");
    const config = await resolveSiteForUser(ctx.session, siteSlug);
    return withSiteConfig(config, async () => {
      const specs = await getDeploymentNetSpecs(deploymentId);
      if (!specs) return { error: "Deployment has no network config or was not found." };
      const snapshots = await getLldpSnapshotsForSite(config.siteId).catch(() => ({
        hosts: {},
      }));
      const path = await resolveDeploymentNetworkPath({
        node: specs.node,
        netConfig: specs.specs,
        snapshots,
      });
      if (!path) return { error: "No network interfaces to trace." };
      return {
        node: specs.node,
        agentHost: path.agentHost,
        lldpObserved: Boolean(path.agentHost),
        freshestSnapshotAt: path.freshestSnapshotAt,
        interfaces: path.entries.map((e) => ({
          netKey: e.netKey,
          bridge: e.bridge,
          vlan: e.vlanTag,
          uplinks: e.uplinks.map((u) => ({
            nic: u.uplinkInterface,
            upstreamDevice: u.remote?.systemName ?? null,
            upstreamPort: u.remote?.portDescription ?? u.remote?.portId ?? null,
            chassisId: u.remote?.chassisId ?? null,
            vlan: u.remote?.vlanId ?? null,
          })),
        })),
      };
    });
  },
});
