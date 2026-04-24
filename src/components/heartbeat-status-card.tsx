"use client";

import { useActionState } from "react";
import { AlertTriangle, CheckCircle2, ServerCrash, Trash2, XCircle } from "lucide-react";

import { clearHeartbeatAlertsAction } from "@/app/heartbeat-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type { AlertRuntimeEntry } from "@/lib/alert-runtime-state";

function formatDuration(firstObservedAt: string): string {
  const ms = Date.now() - new Date(firstObservedAt).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "error") return <XCircle className="h-4 w-4 text-red-400" />;
  if (severity === "warning") return <AlertTriangle className="h-4 w-4 text-amber-400" />;
  return <CheckCircle2 className="h-4 w-4 text-blue-400" />;
}

function severityBadgeVariant(severity: string) {
  if (severity === "error") return "destructive" as const;
  return "warning" as const;
}

export function HeartbeatStatusCard({
  alerts,
}: {
  alerts: AlertRuntimeEntry[];
}) {
  const [clearState, clearAction, isClearing] = useActionState(
    clearHeartbeatAlertsAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(clearState, {
    errorTitle: "Clear failed",
    successTitle: "Heartbeat alerts cleared",
  });

  if (alerts.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 px-5 py-8">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          <p className="text-[13px] text-zinc-400">
            All sites are healthy. No active heartbeat alerts.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Active Heartbeat Alerts</CardTitle>
            <CardDescription>
              {alerts.length} active {alerts.length === 1 ? "alert" : "alerts"} across your sites.
            </CardDescription>
          </div>
          <Form action={clearAction}>
            <Button
              disabled={isClearing}
              size="sm"
              type="submit"
              variant="secondary"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {isClearing ? "Clearing..." : "Clear all"}
            </Button>
          </Form>
        </div>
      </CardHeader>
      <CardContent className="p-5">
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div
              className="flex items-start gap-3 rounded-lg border border-white/5 bg-[#111113] px-4 py-3"
              key={alert.key}
            >
              <SeverityIcon severity={alert.severity} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13px] font-medium text-zinc-100">{alert.title}</p>
                  <Badge variant={severityBadgeVariant(alert.severity)}>
                    {alert.severity}
                  </Badge>
                </div>
                <p className="mt-0.5 text-[12px] text-zinc-500">{alert.lastMessage}</p>
                <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-zinc-600">
                  <span>Duration: {formatDuration(alert.firstObservedAt)}</span>
                  <span>Notifications: {alert.notificationCount}</span>
                  {alert.lastNotifiedAt && (
                    <span>Last notified: {new Date(alert.lastNotifiedAt).toLocaleString()}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
