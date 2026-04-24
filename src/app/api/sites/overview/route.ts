import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth";
import { getDashboardOverviewData, withSiteConfig } from "@/lib/proxmox";
import type { ClusterResourceSummary } from "@/lib/proxmox";
import { resolveSiteConfig } from "@/lib/site-resolver";
import { listEnabledSites } from "@/lib/site-store";
import type { SiteLocation } from "@/lib/site-types";

export const dynamic = "force-dynamic";

export type SiteOverviewEntry = {
  id: string;
  slug: string;
  name: string;
  location: SiteLocation | null;
  cluster: ClusterResourceSummary | null;
  nodeCount: number;
  deploymentCount: number;
  status: "online" | "degraded" | "offline";
};

export type OverviewResponse = {
  sites: SiteOverviewEntry[];
  totals: {
    sites: number;
    deployments: number;
    nodes: number;
  };
};

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const enabledSites = await listEnabledSites();

  const entries: SiteOverviewEntry[] = [];
  let totalDeployments = 0;
  let totalNodes = 0;

  await Promise.all(
    enabledSites.map(async (site) => {
      try {
        const config = await resolveSiteConfig(site);
        const overview = await Promise.race([
          withSiteConfig(config, () => getDashboardOverviewData()),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Site timeout")), 8000),
          ),
        ]);

        const nodeCount = overview.nodes.length;
        const deploymentCount = overview.deployments.length;
        const onlineNodes = overview.nodes.filter(
          (n) => n.status === "online",
        ).length;

        let status: SiteOverviewEntry["status"] = "online";
        if (onlineNodes === 0) status = "offline";
        else if (onlineNodes < nodeCount) status = "degraded";

        totalDeployments += deploymentCount;
        totalNodes += nodeCount;

        entries.push({
          id: site.id,
          slug: site.slug,
          name: site.name,
          location: site.location ?? null,
          cluster: overview.clusterResources,
          nodeCount,
          deploymentCount,
          status,
        });
      } catch {
        entries.push({
          id: site.id,
          slug: site.slug,
          name: site.name,
          location: site.location ?? null,
          cluster: null,
          nodeCount: 0,
          deploymentCount: 0,
          status: "offline",
        });
      }
    }),
  );

  const response: OverviewResponse = {
    sites: entries,
    totals: {
      sites: enabledSites.length,
      deployments: totalDeployments,
      nodes: totalNodes,
    },
  };

  return NextResponse.json(response);
}
