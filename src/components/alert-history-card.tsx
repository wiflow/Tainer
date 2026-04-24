"use client";

import { useActionState } from "react";
import { ArrowUpRight, Trash2, UserCircle } from "lucide-react";

import { clearAlertHistoryAction } from "@/app/alert-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type { NotificationEntry } from "@/lib/notification-log";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatDuration(totalMinutes: number | null) {
  if (totalMinutes == null) return "N/A";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function categoryLabel(category: string) {
  if (category === "deployment-offline") return "Workload offline";
  if (category === "deployment-high-cpu") return "High CPU";
  if (category === "deployment-high-memory") return "High memory";
  if (category === "deployment-high-disk") return "High disk";
  if (category === "storage-unhealthy") return "Storage unhealthy";
  if (category === "storage-low-space") return "Storage low space";
  if (category === "backup-stale") return "Backup stale";
  return "System";
}

function severityBadgeVariant(severity: string) {
  if (severity === "error") return "destructive" as const;
  if (severity === "info") return "info" as const;
  return "warning" as const;
}

function stateBadgeVariant(state: string) {
  if (state === "resolved") return "success" as const;
  if (state === "test") return "info" as const;
  if (state === "cleared") return "neutral" as const;
  return "review" as const;
}

function stateLabel(state: string) {
  if (state === "resolved") return "Recovered";
  if (state === "test") return "Test";
  if (state === "cleared") return "Cleared";
  return "Active";
}

export function AlertHistoryCard({
  notifications,
  siteSlug,
}: {
  notifications: NotificationEntry[];
  siteSlug: string;
}) {
  const [clearState, clearAction, isClearing] = useActionState(
    clearAlertHistoryAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(clearState, {
    errorTitle: "Clear failed",
    successTitle: "Alert history cleared",
  });

  const historySummary = {
    active: notifications.filter((e) => e.state === "firing").length,
    cleared: notifications.filter((e) => e.state === "cleared").length,
    recovered: notifications.filter((e) => e.state === "resolved").length,
    test: notifications.filter((e) => e.state === "test").length,
    total: notifications.length,
  };

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Alert history</CardTitle>
            <CardDescription>
              A clear event timeline of active alerts, recoveries, clears, and test deliveries.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{historySummary.total} events</Badge>
            <Badge variant="review">{historySummary.active} active</Badge>
            <Badge variant="success">{historySummary.recovered} recovered</Badge>
            {historySummary.cleared > 0 && (
              <Badge variant="neutral">{historySummary.cleared} cleared</Badge>
            )}
            <Badge variant="info">{historySummary.test} tests</Badge>
            {notifications.length > 0 && (
              <Form action={clearAction}>
                <input name="siteSlug" type="hidden" value={siteSlug} />
                <Button
                  disabled={isClearing}
                  size="sm"
                  type="submit"
                  variant="secondary"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {isClearing ? "Clearing..." : "Clear history"}
                </Button>
              </Form>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {notifications.length === 0 ? (
          <div className="px-5 py-4 text-[13px] text-zinc-500">
            No alerts have been recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {notifications.map((notification) => (
              <div key={notification.id} className="px-5 py-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-semibold text-zinc-100">
                        {notification.title}
                      </p>
                      <Badge variant={stateBadgeVariant(notification.state)}>
                        {stateLabel(notification.state)}
                      </Badge>
                      <Badge variant={severityBadgeVariant(notification.severity)}>
                        {notification.severity}
                      </Badge>
                      <Badge variant="neutral">{categoryLabel(notification.category)}</Badge>
                      {notification.policyName && (
                        <Badge variant="info">{notification.policyName}</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-[12px] text-zinc-400">{notification.subject}</p>
                    <p className="mt-2 whitespace-pre-line text-[12px] leading-relaxed text-zinc-400">
                      {notification.message}
                    </p>
                    {(notification.policyName || notification.clearedBy) && (
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                        {notification.policyName && (
                          <span className="inline-flex items-center gap-1">
                            Policy: <span className="font-medium text-zinc-400">{notification.policyName}</span>
                          </span>
                        )}
                        {notification.clearedBy && (
                          <span className="inline-flex items-center gap-1">
                            <UserCircle className="h-3.5 w-3.5" />
                            Cleared by {notification.clearedBy}
                          </span>
                        )}
                      </div>
                    )}
                    {notification.detailsUrl && (
                      <a
                        className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-sky-400 transition-colors hover:text-sky-300"
                        href={notification.detailsUrl}
                      >
                        {notification.detailsLabel ?? "Open in Tainer"}
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>

                  <div className="shrink-0 space-y-1 text-[11px] text-zinc-600 xl:min-w-[17rem] xl:text-right">
                    <p>{formatDate(notification.firedAt)}</p>
                    <p>Duration {formatDuration(notification.durationMinutes)}</p>
                    <p className="font-mono text-[10px] text-zinc-700">
                      {notification.alertKey}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
