import "server-only";

import { getActiveHeartbeatAlerts } from "@/lib/heartbeat-engine";
import { getActiveAlertRuntimeEntries } from "@/lib/alert-runtime-state";
import type { AlertRuntimeEntry } from "@/lib/alert-runtime-state";
import { registerTool } from "@/lib/copilot/registry";
import { runInSite, siteSlugSchema } from "@/lib/copilot/tools/helpers";

function leanAlert(a: AlertRuntimeEntry) {
  return {
    title: a.title,
    severity: a.severity,
    category: a.category,
    subject: a.subject,
    message: a.lastMessage,
    firstObservedAt: a.firstObservedAt,
    lastObservedAt: a.lastObservedAt,
    policy: a.policyName,
  };
}

registerTool({
  name: "get_alerts",
  category: "Diagnostics",
  klass: "read",
  description:
    "List the currently-active alerts for a site (resource thresholds, guest down, storage pressure, etc. — whatever the site's alert policies watch). Use for 'any alerts firing?', 'what's alerting on prod?'. These are the live, unresolved alerts.",
  input_schema: siteSlugSchema(),
  describe: (args) => `List active alerts for site ${String(args.siteSlug)}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const alerts = await getActiveAlertRuntimeEntries();
      return alerts.map(leanAlert);
    });
  },
});

registerTool({
  name: "get_heartbeat_status",
  category: "Diagnostics",
  klass: "read",
  description:
    "List active cluster-connectivity (heartbeat) alerts — sites or endpoints Tainer currently can't reach. Global, not per-site. Use for 'is everything reachable?', 'any sites down?'. An empty result means all monitored endpoints are responding.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  describe: () => "Check cluster heartbeat status",
  execute: async () => {
    const alerts = await getActiveHeartbeatAlerts();
    return {
      allHealthy: alerts.length === 0,
      activeCount: alerts.length,
      alerts: alerts.map(leanAlert),
    };
  },
});
