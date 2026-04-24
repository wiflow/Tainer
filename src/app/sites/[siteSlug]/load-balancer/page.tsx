import {
  Activity,
  ArrowLeftRight,
  Gauge,
  Scale,
} from "lucide-react";
import { redirect } from "next/navigation";

import { LoadBalancerDashboard } from "@/components/load-balancer-dashboard";
import { MetricCard } from "@/components/ui/metric-card";
import { getCurrentSession } from "@/lib/auth";
import { ensureSiteConfig } from "@/lib/site-context";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import { getLoadBalancerStatus } from "@/lib/load-balancer/observer";
import { getLoadBalancerSettings } from "@/lib/load-balancer/settings";
import { withSiteConfig } from "@/lib/proxmox";

export const dynamic = "force-dynamic";

export default async function LoadBalancerPage({
  params,
}: {
  params: Promise<{ siteSlug: string }>;
}) {
  const { siteSlug } = await params;
  await ensureSiteConfig(siteSlug);

  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  if (session.user.role !== "admin") {
    redirect("/");
  }

  const siteConfig = await resolveSiteConfigBySlug(siteSlug);
  const [settings, status] = await Promise.all([
    withSiteConfig(siteConfig, () => getLoadBalancerSettings()),
    Promise.resolve(getLoadBalancerStatus(siteConfig.siteId)),
  ]);

  const hottestNode = status.nodeScores.length > 0
    ? status.nodeScores.reduce((a, b) => a.compositeScore > b.compositeScore ? a : b)
    : null;

  const activeMigrations = status.pendingMigrations.filter((m) => !m.completed).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Scale className="w-3.5 h-3.5" />}
          label="Load Balancer"
          value={settings.enabled ? "Active" : "Disabled"}
          description={
            status.running
              ? `Observer running · ${status.tickCount} ticks`
              : "Observer not running"
          }
        />
        <MetricCard
          icon={<Gauge className="w-3.5 h-3.5" />}
          label="Cluster Avg Score"
          value={status.clusterAverageScore.toFixed(1)}
          description={`${status.nodeScores.length} nodes scored`}
        />
        <MetricCard
          icon={<Activity className="w-3.5 h-3.5" />}
          label="Hottest Node"
          value={hottestNode?.node ?? "—"}
          description={
            hottestNode
              ? `Score: ${hottestNode.compositeScore.toFixed(1)}`
              : "No data"
          }
        />
        <MetricCard
          icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
          label="Migrations"
          value={String(activeMigrations)}
          description={`${status.pendingMigrations.length} total (incl. completed)`}
        />
      </div>

      <LoadBalancerDashboard
        settings={settings}
        status={status}
        siteSlug={siteSlug}
      />
    </div>
  );
}
