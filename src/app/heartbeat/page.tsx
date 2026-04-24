import { redirect } from "next/navigation";
import { Activity, HeartPulse, ServerCrash } from "lucide-react";

import { HeartbeatSettingsPanel } from "@/components/heartbeat-settings-panel";
import { HeartbeatStatusCard } from "@/components/heartbeat-status-card";
import { MetricCard } from "@/components/ui/metric-card";
import { getCurrentSession, hasPermission } from "@/lib/auth";
import { getActiveHeartbeatAlerts } from "@/lib/heartbeat-engine";
import { getHeartbeatSettings } from "@/lib/heartbeat-settings";
import { getSchedulerStatus } from "@/lib/alert-scheduler";
import { listEnabledSites } from "@/lib/site-store";

export const dynamic = "force-dynamic";

export default async function HeartbeatPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  if (!hasPermission(session, "manage-settings")) {
    redirect("/");
  }

  const [settings, activeAlerts, schedulerStatus, sites] = await Promise.all([
    getHeartbeatSettings(),
    getActiveHeartbeatAlerts(),
    getSchedulerStatus(),
    listEnabledSites(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2">
          <HeartPulse className="h-5 w-5 text-zinc-400" />
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Heartbeat Monitor</h1>
        </div>
        <p className="mt-1 text-[13px] text-zinc-500">
          Monitor site connectivity, staleness, and cluster-level health across all Proxmox sites.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          icon={<HeartPulse className="w-3.5 h-3.5" />}
          label="Status"
          value={settings.enabled ? "Enabled" : "Disabled"}
          description={settings.enabled ? `Checking every ${settings.checkIntervalSeconds}s` : "Not monitoring"}
        />
        <MetricCard
          icon={<Activity className="w-3.5 h-3.5" />}
          label="Sites"
          value={String(sites.length)}
          description="enabled sites being monitored"
        />
        <MetricCard
          icon={<ServerCrash className="w-3.5 h-3.5" />}
          label="Active alerts"
          value={String(activeAlerts.length)}
          description={schedulerStatus.heartbeatLastResult ? `Last: ${schedulerStatus.heartbeatLastResult}` : undefined}
        />
      </div>

      <HeartbeatStatusCard alerts={activeAlerts} />

      <HeartbeatSettingsPanel settings={settings} />
    </div>
  );
}
