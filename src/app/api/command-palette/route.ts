import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth";
import { listDeploymentTemplates } from "@/lib/deployment-templates";
import { getDeploymentIndex, getNodes, withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const siteSlug = searchParams.get("siteSlug");

  if (!siteSlug) {
    return NextResponse.json({ error: "Missing siteSlug" }, { status: 400 });
  }

  try {
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    const data = await withSiteConfig(siteConfig, async () => {
      const [deploymentIndex, nodesResult, templates] = await Promise.all([
        getDeploymentIndex(),
        getNodes(),
        listDeploymentTemplates(),
      ]);

      return {
        deployments: deploymentIndex.deployments.map((d) => ({
          id: d.id,
          ip: d.ipAddress,
          name: d.name,
          node: d.node,
          status: d.rawStatus,
          type: d.type,
          vmid: d.vmid,
        })),
        nodes: nodesResult.nodes.map((n) => ({
          name: n.name,
          status: n.status,
        })),
        templates: templates.map((t) => ({
          id: t.id,
          name: t.name,
        })),
      };
    });

    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=5" },
    });
  } catch {
    return NextResponse.json({ error: "Failed to load data" }, { status: 500 });
  }
}
