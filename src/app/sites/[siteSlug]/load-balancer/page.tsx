import {
  Activity,
  ArrowLeftRight,
  Gauge,
  History,
  Scale,
} from "lucide-react";
import { redirect } from "next/navigation";

import { LoadBalancerDashboard } from "@/components/load-balancer-dashboard";
import { LoadBalancerEventViewer } from "@/components/load-balancer-event-viewer";
import { MetricCard } from "@/components/ui/metric-card";
import { getCurrentSession } from "@/lib/auth";
import { ensureSiteConfig } from "@/lib/site-context";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import { listLbEvents } from "@/lib/load-balancer/event-log";
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
  const [settings, status, events] = await Promise.all([
    withSiteConfig(siteConfig, () => getLoadBalancerSettings()),
    Promise.resolve(getLoadBalancerStatus(siteConfig.siteId)),
    // listLbEvents reads the per-site JSON store; cap at 1000 for the UI
    // so the page payload stays small. The file holds up to 10,000.
    withSiteConfig(siteConfig, () => listLbEvents(1000)),
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

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-sky-400" />
          <h2 className="text-[14px] font-medium text-white">Activity log</h2>
          <span className="text-[11px] text-zinc-500">
            ({events.length} of last 10,000 events)
          </span>
        </div>
        <p className="text-[12px] text-zinc-500">
          Persistent history of every migration the load balancer has triggered, plus
          failures and tick errors. Survives Tainer restarts.
        </p>
        <LoadBalancerEventViewer entries={events} />
      </div>
    </div>
  );
}
