"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BackupRunRecord, BackupRunStatus } from "@/lib/backup-run-log";

function formatDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatDuration(startedAt: string, completedAt: string | null) {
  if (!completedAt) return "Running...";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function statusBadgeVariant(status: BackupRunStatus) {
  switch (status) {
    case "success":
      return "success" as const;
    case "error":
      return "destructive" as const;
    case "partial":
      return "review" as const;
    case "running":
      return "info" as const;
    default:
      return "neutral" as const;
  }
}

function RunRow({ run }: { run: BackupRunRecord }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-white/5/40 last:border-b-0">
      <button
        className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-[#111113] transition-colors"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-zinc-200">{run.policyName}</span>
            <Badge variant={statusBadgeVariant(run.status)}>{run.status}</Badge>
            <Badge variant="neutral">{run.trigger}</Badge>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[12px] text-zinc-400">{formatDate(run.startedAt)}</p>
          <p className="text-[11px] text-zinc-600">
            {formatDuration(run.startedAt, run.completedAt)}
          </p>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/5/40 bg-zinc-950/30 px-5 py-3 space-y-2">
          <div className="flex flex-wrap gap-4 text-[12px] text-zinc-400">
            <span>Workloads: {run.totalWorkloads}</span>
            <span>Success: {run.successCount}</span>
            <span>Errors: {run.errorCount}</span>
            {run.prunedCount > 0 && <span>Pruned: {run.prunedCount}</span>}
            {run.triggeredBy && <span>By: {run.triggeredBy}</span>}
          </div>

          {run.workloads.length > 0 && (
            <div className="mt-2 space-y-1">
              {run.workloads.map((w, i) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-md border border-white/5/40 bg-zinc-900/20 px-3 py-2 text-[12px]"
                  key={`${w.vmid}-${i}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant={
                        w.status === "success"
                          ? "success"
                          : w.status === "error"
                            ? "destructive"
                            : "neutral"
                      }
                    >
                      {w.status}
                    </Badge>
                    <span className="text-zinc-300 truncate">
                      {w.name} ({w.type.toUpperCase()} {w.vmid})
                    </span>
                  </div>
                  <div className="shrink-0 text-zinc-500">
                    {w.durationSeconds != null && `${w.durationSeconds}s`}
                    {w.prunedArchives.length > 0 && (
                      <span className="ml-2 text-amber-500">
                        {w.prunedArchives.length} pruned
                      </span>
                    )}
                  </div>
                  {w.errorMessage && (
                    <p className="w-full mt-1 text-[11px] text-red-400">{w.errorMessage}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function BackupRunHistoryCard({ runs }: { runs: BackupRunRecord[] }) {
  if (runs.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <CardTitle>Backup run history</CardTitle>
        <CardDescription>
          Recent backup policy executions with per-workload results.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {runs.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
      </CardContent>
    </Card>
  );
}
