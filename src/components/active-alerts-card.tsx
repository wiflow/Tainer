"use client";

import { useActionState } from "react";
import { AlertTriangle, ArrowUpRight, Trash2, X } from "lucide-react";

import {
  clearAllActiveAlertsAction,
  clearSingleAlertAction,
} from "@/app/alert-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type { AlertRuntimeEntry } from "@/lib/alert-runtime-state";

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

function DismissButton({ alertKey, siteSlug }: { alertKey: string; siteSlug: string }) {
  const [state, formAction, isPending] = useActionState(
    clearSingleAlertAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(state, {
    errorTitle: "Clear failed",
    successTitle: "Alert cleared",
  });

  return (
    <Form action={formAction}>
      <input name="siteSlug" type="hidden" value={siteSlug} />
      <input name="alertKey" type="hidden" value={alertKey} />
      <button
        className="rounded-md p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
        disabled={isPending}
        title="Dismiss this alert"
        type="submit"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </Form>
  );
}

export function ActiveAlertsCard({
  alerts,
  siteSlug,
}: {
  alerts: AlertRuntimeEntry[];
  siteSlug: string;
}) {
  const [clearAllState, clearAllAction, isClearingAll] = useActionState(
    clearAllActiveAlertsAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(clearAllState, {
    errorTitle: "Clear failed",
    successTitle: "Active alerts cleared",
  });

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Active alerts</CardTitle>
            <CardDescription>
              Conditions currently breaching your alert policy thresholds.
            </CardDescription>
          </div>
          {alerts.length > 0 && (
            <Form action={clearAllAction}>
              <input name="siteSlug" type="hidden" value={siteSlug} />
              <Button
                disabled={isClearingAll}
                size="sm"
                type="submit"
                variant="secondary"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isClearingAll ? "Clearing..." : "Clear all"}
              </Button>
            </Form>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {alerts.length === 0 ? (
          <div className="px-5 py-4 text-[13px] text-zinc-500">
            No active alerts right now.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {alerts.map((alert) => (
              <div key={alert.key} className="px-5 py-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <AlertTriangle
                        className={`h-3.5 w-3.5 ${
                          alert.severity === "error"
                            ? "text-rose-400"
                            : alert.severity === "info"
                              ? "text-sky-400"
                              : "text-amber-400"
                        }`}
                      />
                      <p className="text-[13px] font-semibold text-zinc-100">
                        {alert.title}
                      </p>
                      <Badge variant={severityBadgeVariant(alert.severity)}>
                        {alert.severity}
                      </Badge>
                      <Badge variant="neutral">{categoryLabel(alert.category)}</Badge>
                      {alert.policyName && (
                        <Badge variant="info">{alert.policyName}</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-[12px] text-zinc-400">{alert.subject}</p>
                    <p className="mt-2 whitespace-pre-line text-[12px] leading-relaxed text-zinc-400">
                      {alert.lastMessage}
                    </p>
                    {alert.detailsUrl && (
                      <a
                        className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-sky-400 transition-colors hover:text-sky-300"
                        href={alert.detailsUrl}
                      >
                        {alert.detailsLabel ?? "Open in Tainer"}
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="shrink-0 space-y-1 text-[11px] text-zinc-600 xl:text-right">
                      <p>Started {formatDate(alert.firstObservedAt)}</p>
                      <p>
                        Active for {formatDuration(
                          Math.max(
                            0,
                            Math.round(
                              (
                                new Date(alert.lastObservedAt).getTime() -
                                new Date(alert.firstObservedAt).getTime()
                              ) / 60_000,
                            ),
                          ),
                        )}
                      </p>
                      {alert.lastNotifiedAt && (
                        <p>Last notified {formatDate(alert.lastNotifiedAt)}</p>
                      )}
                    </div>
                    <DismissButton alertKey={alert.key} siteSlug={siteSlug} />
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
