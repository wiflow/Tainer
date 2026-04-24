import { Activity, CheckCircle2, XCircle } from "lucide-react";

import type { SchedulerStatus } from "@/lib/alert-scheduler-status";

function formatRelative(iso: string | null) {
  if (!iso) return null;
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "just now";
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  } catch {
    return null;
  }
}

export function SchedulerStatusCard({
  alertsEnabled,
  status,
}: {
  alertsEnabled: boolean;
  status: SchedulerStatus;
}) {
  const isHealthy = status.running && alertsEnabled;
  const lastCheck = formatRelative(status.lastCheckAt);

  return (
    <div className="rounded-xl border border-white/5 bg-[#111113] p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[13px] font-medium text-zinc-400">
          <Activity className="w-3.5 h-3.5" />
          Scheduler
        </h3>
      </div>
        {isHealthy ? (
          <>
            <div className="mt-2 flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              <p className="text-lg font-semibold tracking-tight text-emerald-400">Running</p>
            </div>
            <p className="mt-1 text-[12px] text-zinc-500">
              {lastCheck ? `Last check ${lastCheck}` : "Waiting for first check"}
            </p>
          </>
        ) : !status.running ? (
          <>
            <div className="mt-2 flex items-center gap-2">
              <XCircle className="h-4 w-4 text-zinc-600" />
              <p className="text-lg font-semibold tracking-tight text-zinc-500">Stopped</p>
            </div>
            <p className="mt-1 text-[12px] text-zinc-500">
              Starts automatically on next deploy
            </p>
          </>
        ) : (
          <>
            <div className="mt-2 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-amber-500" />
              <p className="text-lg font-semibold tracking-tight text-amber-400">Idle</p>
            </div>
            <p className="mt-1 text-[12px] text-zinc-500">
              Enable alerts to start checking
            </p>
          </>
        )}
        {status.lastError && (
          <p className="mt-1 truncate text-[11px] text-rose-400/80" title={status.lastError}>
            {status.lastError}
          </p>
        )}
    </div>
  );
}
