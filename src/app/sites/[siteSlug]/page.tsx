import { unstable_cache } from "next/cache";

import { getActiveAlertRuntimeEntries } from "@/lib/alert-runtime-state";
import { listDeploymentTemplates } from "@/lib/deployment-templates";
import { getDashboardOverviewData, withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import { formatBytes } from "@/lib/utils";
import { AutoRefresh } from "@/components/auto-refresh";
import { DashboardCharts } from "@/components/dashboard-charts";
import { DashboardTabs } from "@/components/dashboard-tabs";
import { ArrowUpRight, ArrowDownRight, Cpu, MemoryStick, HardDrive, RefreshCw } from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";
import { requireSitePageAccess } from "@/lib/page-guard";

// Note: do NOT add `export const dynamic = "force-dynamic"` here. It silently
// disables `unstable_cache` and the `revalidate` value below becomes a no-op,
// turning every request into a full Proxmox refetch.
const getHomePageData = unstable_cache(
  async (siteSlug: string) => {
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return withSiteConfig(siteConfig, async () => {
      return Promise.all([
        getDashboardOverviewData(),
        listDeploymentTemplates(),
        getActiveAlertRuntimeEntries(),
      ]);
    });
  },
  ["home-page-data"],
  { revalidate: 30, tags: ["home-page-data"] },
);

function formatPercent(value: number | null) {
  if (value == null) {
    return "Unavailable";
  }
  return `${Math.round(value * 100)}%`;
}

function formatUsageLabel(usedBytes: number | null, totalBytes: number | null) {
  if (usedBytes == null || totalBytes == null || totalBytes === 0) {
    return "Unavailable";
  }
  return `${formatBytes(usedBytes)} / ${formatBytes(totalBytes)}`;
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ siteSlug: string }>;
}) {
  const { siteSlug } = await params;
  await requireSitePageAccess(siteSlug);
  const [overview, deploymentTemplates, activeAlerts] = await getHomePageData(siteSlug);
  const cluster = overview.clusterResources;

  return (
    <div className="flex flex-col space-y-4">
      {/* Matches the cache's 30s revalidate above — each refresh gets data
          at most one revalidation window old without extra Proxmox load. */}
      <AutoRefresh intervalMs={30_000} eventsSite={siteSlug} />
      {/* ── Top Metric Cards (Mapped to Tainer Data) ── */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Cpu className="w-3.5 h-3.5" />}
          label="CPU Usage"
          value={cluster ? formatPercent(cluster.cpuRatio) : "Unavailable"}
          description="Load relative to total cores"
          subtitle="Global Cluster Processing"
          badge={<><ArrowUpRight className="h-3 w-3" /> Active</>}
        />
        <MetricCard
          icon={<MemoryStick className="w-3.5 h-3.5" />}
          label="RAM Usage"
          value={
            cluster && cluster.memoryTotalBytes > 0
              ? `${Math.round((cluster.memoryUsedBytes / cluster.memoryTotalBytes) * 100)}%`
              : "Unavailable"
          }
          description={cluster ? formatUsageLabel(cluster.memoryUsedBytes, cluster.memoryTotalBytes) : "Unavailable"}
          subtitle="Allocated physical memory"
          badge={
            cluster?.memoryTotalBytes && cluster.memoryTotalBytes > 0 && cluster.memoryUsedBytes / cluster.memoryTotalBytes > 0.8 ? (
              <><ArrowUpRight className="h-3 w-3 text-rose-400" /><span className="text-rose-400">High</span></>
            ) : (
              <><ArrowDownRight className="h-3 w-3 text-emerald-400" /><span className="text-emerald-400">Nominal</span></>
            )
          }
        />
        <MetricCard
          icon={<HardDrive className="w-3.5 h-3.5" />}
          label="Storage"
          value={
            cluster && cluster.rootfsTotalBytes > 0
              ? `${Math.round((cluster.rootfsUsedBytes / cluster.rootfsTotalBytes) * 100)}%`
              : "Unavailable"
          }
          description={cluster ? formatUsageLabel(cluster.rootfsUsedBytes, cluster.rootfsTotalBytes) : "Unavailable"}
          subtitle="Total cluster storage blocks"
          badge="Rootfs"
        />
        <MetricCard
          icon={<RefreshCw className="w-3.5 h-3.5" />}
          label="Swap"
          value={
            cluster && cluster.swapTotalBytes > 0
              ? `${Math.round((cluster.swapUsedBytes / cluster.swapTotalBytes) * 100)}%`
              : "Unavailable"
          }
          description={cluster ? formatUsageLabel(cluster.swapUsedBytes, cluster.swapTotalBytes) : "Unavailable"}
          subtitle="Virtual memory utilization"
          badge="Paging"
        />
      </div>

      {/* ── Charts Section ── */}
      <DashboardCharts siteSlug={siteSlug} />

      {/* ── Table Section (Tabbed) ── */}
      <DashboardTabs
        siteSlug={siteSlug}
        deployments={overview.deployments}
        templates={deploymentTemplates}
        nodes={overview.nodes}
        activeAlerts={activeAlerts}
      />
    </div>
  );
}
