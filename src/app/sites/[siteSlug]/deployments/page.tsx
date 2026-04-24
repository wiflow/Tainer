import { Activity, Layers3, Server, ShieldAlert } from "lucide-react";
import { unstable_cache } from "next/cache";

import { ensureSiteConfig } from "@/lib/site-context";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

import { BulkOperationsPanel } from "@/components/bulk-operations-panel";
import { DeploymentsBoard } from "@/components/deployments-board";
import { ProxmoxIssues } from "@/components/proxmox-issues";
import { MetricCard } from "@/components/ui/metric-card";
import { listContainerTags } from "@/lib/container-groups";
import { listDeploymentTemplates } from "@/lib/deployment-templates";
import { getDeploymentIndex, withSiteConfig } from "@/lib/proxmox";

export const dynamic = "force-dynamic";

const getDeploymentsPageData = unstable_cache(
  async (siteSlug: string) => {
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return withSiteConfig(siteConfig, async () => {
      return Promise.all([
        getDeploymentIndex(),
        listDeploymentTemplates(),
        listContainerTags(),
      ]);
    });
  },
  ["deployments-page-data"],
  { revalidate: 5, tags: ["deployments-page-data"] },
);

export default async function DeploymentsPage({
  params,
}: {
  params: Promise<{ siteSlug: string }>;
}) {
  const { siteSlug } = await params;
  await ensureSiteConfig(siteSlug);

  const [{ deployments, issues }, templates, tags] = await getDeploymentsPageData(siteSlug);

  // Build update map: deployment ID → true if template has been updated since deploy
  const templateMap = new Map(templates.map((t) => [t.id, t.updatedAt]));
  const updateMap: Record<string, boolean> = {};
  for (const d of deployments) {
    if (d.tainerMeta?.templateId) {
      const currentVersion = templateMap.get(d.tainerMeta.templateId);
      if (currentVersion && currentVersion > d.tainerMeta.templateVersion) {
        updateMap[d.id] = true;
      }
    }
  }

  const stats = deployments.reduce(
    (acc, d) => {
      if (d.rawStatus === "running") acc.running++;
      else if (d.rawStatus === "stopped") acc.stopped++;
      else acc.attention++;
      if (d.type === "qemu") acc.vms++;
      else acc.containers++;
      acc.nodes.add(d.node);
      return acc;
    },
    { running: 0, stopped: 0, attention: 0, vms: 0, containers: 0, nodes: new Set<string>() },
  );

  return (
    <div className="space-y-4">
      <ProxmoxIssues
        description="Deployment inventory and controls need VM.Audit plus lifecycle permissions. Empty results can still mean either no guests or a token that cannot see them yet."
        issues={issues}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Layers3 className="w-3.5 h-3.5" />}
          label="Total"
          value={String(deployments.length)}
          description={`${stats.containers} containers, ${stats.vms} VMs across ${stats.nodes.size} nodes.`}
        />
        <MetricCard
          icon={<Activity className="w-3.5 h-3.5" />}
          label="Running"
          value={String(stats.running)}
          description="Running deployments that accept restart and shutdown actions."
        />
        <MetricCard
          icon={<Server className="w-3.5 h-3.5" />}
          label="Stopped"
          value={String(stats.stopped)}
          description="Stopped deployments ready to be started again."
        />
        <MetricCard
          icon={<ShieldAlert className="w-3.5 h-3.5" />}
          label="Attention"
          value={String(stats.attention)}
          description={
            stats.attention > 0
              ? "Deployments with non-standard states worth checking."
              : `${stats.nodes.size} nodes currently host your visible deployments.`
          }
        />
      </div>

      <BulkOperationsPanel deployments={deployments} tags={tags} />

      <DeploymentsBoard deployments={deployments} updateMap={updateMap} tags={tags} />
    </div>
  );
}
