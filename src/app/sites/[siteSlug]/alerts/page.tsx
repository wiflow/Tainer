import {
  Bell,
  ServerCrash,
  Shield,
} from "lucide-react";
import { redirect } from "next/navigation";

import { ActiveAlertsCard } from "@/components/active-alerts-card";
import { AlertHistoryCard } from "@/components/alert-history-card";
import { AlertPoliciesList } from "@/components/alert-policies-list";
import { AlertsSettingsPanel } from "@/components/alerts-settings-panel";
import { SchedulerStatusCard } from "@/components/scheduler-status-card";
import { MetricCard } from "@/components/ui/metric-card";
import { listAlertPolicies } from "@/lib/alert-policies";
import { getAlertSchedulerStatus } from "@/lib/alert-scheduler-status";
import { getAlertSettings } from "@/lib/alert-settings";
import { getActiveAlertRuntimeEntries } from "@/lib/alert-runtime-state";
import { getCurrentSession } from "@/lib/auth";
import { listContainerTags } from "@/lib/container-groups";
import { getRecentNotifications } from "@/lib/notification-log";
import { requireSitePageAccess } from "@/lib/page-guard";
import { ensureSiteConfig } from "@/lib/site-context";

export const dynamic = "force-dynamic";

export default async function AlertsPage({
  params,
}: {
  params: Promise<{ siteSlug: string }>;
}) {
  const { siteSlug } = await params;
  await requireSitePageAccess(siteSlug);
  await ensureSiteConfig(siteSlug);

  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  if (session.user.role !== "admin") {
    redirect("/");
  }

  const [alertSettings, notifications, activeAlerts, policies, tags] = await Promise.all([
    getAlertSettings(),
    getRecentNotifications(100),
    getActiveAlertRuntimeEntries(),
    listAlertPolicies(),
    listContainerTags(),
  ]);

  const schedulerStatus = getAlertSchedulerStatus();

  const enabledPolicies = policies.filter((p) => p.enabled).length;
  const totalRules = policies.reduce(
    (sum, p) => sum + p.rules.filter((r) => r.enabled).length,
    0,
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Bell className="w-3.5 h-3.5" />}
          label="Engine"
          value={alertSettings.enabled ? "Enabled" : "Disabled"}
          description={`${enabledPolicies} active polic${enabledPolicies === 1 ? "y" : "ies"}`}
        />
        <MetricCard
          icon={<Shield className="w-3.5 h-3.5" />}
          label="Rules"
          value={String(totalRules)}
          description={`active across ${policies.length} polic${policies.length === 1 ? "y" : "ies"}`}
        />
        <MetricCard
          icon={<ServerCrash className="w-3.5 h-3.5" />}
          label="Active alerts"
          value={String(activeAlerts.length)}
        />
        <SchedulerStatusCard
          alertsEnabled={alertSettings.enabled}
          status={schedulerStatus}
        />
      </div>

      <AlertsSettingsPanel settings={alertSettings} siteSlug={siteSlug} />

      <AlertPoliciesList availableTags={tags} policies={policies} />

      <ActiveAlertsCard alerts={activeAlerts} siteSlug={siteSlug} />

      <AlertHistoryCard notifications={notifications} siteSlug={siteSlug} />
    </div>
  );
}
