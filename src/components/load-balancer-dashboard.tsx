"use client";

import { useActionState } from "react";
import {
  CircleAlert,
  Save,
  Server,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";

import { updateLoadBalancerSettingsAction } from "@/app/lb-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { SectionPanel } from "@/components/ui/section-panel";
import { initialBasicActionState } from "@/lib/action-states";
import type { LoadBalancerSettings, LoadBalancerStatus, NodeScore } from "@/lib/load-balancer/types";
import { cn } from "@/lib/utils";

const fieldClassName =
  "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

function scoreColor(score: number, avg: number): string {
  if (avg === 0) return "text-zinc-400";
  const ratio = score / avg;
  if (ratio <= 0.8) return "text-emerald-400";
  if (ratio <= 1.2) return "text-zinc-200";
  if (ratio <= 1.5) return "text-amber-400";
  return "text-rose-400";
}

function circuitBreakerBadge(state: "closed" | "open" | "half-open") {
  if (state === "closed") {
    return (
      <Badge variant="success" className="text-[10px]">
        <ShieldCheck className="w-3 h-3 mr-1" />
        Healthy
      </Badge>
    );
  }
  if (state === "open") {
    return (
      <Badge variant="destructive" className="text-[10px]">
        <ShieldOff className="w-3 h-3 mr-1" />
        Circuit Open
      </Badge>
    );
  }
  return (
    <Badge variant="warning" className="text-[10px]">
      <CircleAlert className="w-3 h-3 mr-1" />
      Half-Open
    </Badge>
  );
}

function NodeScoreTable({
  scores,
  avg,
  circuitBreakers,
}: {
  scores: NodeScore[];
  avg: number;
  circuitBreakers: LoadBalancerStatus["circuitBreakers"];
}) {
  if (scores.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-[13px] text-zinc-500">
        No node scores available. Enable the load balancer to start collecting data.
      </div>
    );
  }

  const sorted = [...scores].sort((a, b) => a.compositeScore - b.compositeScore);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-white/5 text-left text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
            <th className="pb-3 pr-4">Node</th>
            <th className="pb-3 pr-4 text-right">CPU %</th>
            <th className="pb-3 pr-4 text-right">Memory %</th>
            <th className="pb-3 pr-4 text-right">Disk %</th>
            <th className="pb-3 pr-4 text-right">EWMA Latency</th>
            <th className="pb-3 pr-4 text-right">Penalties</th>
            <th className="pb-3 pr-4 text-right">Score</th>
            <th className="pb-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => {
            const cb = circuitBreakers.find((c) => c.node === s.node);
            return (
              <tr
                key={s.node}
                className="border-b border-white/5 last:border-0"
              >
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2">
                    <Server className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="font-medium text-zinc-200">{s.node}</span>
                  </div>
                </td>
                <td className="py-3 pr-4 text-right text-zinc-300">
                  {s.cpuPercent.toFixed(1)}%
                </td>
                <td className="py-3 pr-4 text-right text-zinc-300">
                  {s.memoryPercent.toFixed(1)}%
                </td>
                <td className="py-3 pr-4 text-right text-zinc-300">
                  {s.diskPercent.toFixed(1)}%
                </td>
                <td className="py-3 pr-4 text-right text-zinc-300">
                  {s.ewmaLatencyMs.toFixed(0)}ms
                </td>
                <td className="py-3 pr-4 text-right">
                  {s.penaltyTotal > 0 ? (
                    <span className="text-rose-400">+{s.penaltyTotal}</span>
                  ) : (
                    <span className="text-zinc-500">0</span>
                  )}
                </td>
                <td className={cn("py-3 pr-4 text-right font-semibold", scoreColor(s.compositeScore, avg))}>
                  {s.compositeScore.toFixed(1)}
                </td>
                <td className="py-3">
                  {cb ? circuitBreakerBadge(cb.state) : circuitBreakerBadge("closed")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SettingsForm({
  settings,
  siteSlug,
}: {
  settings: LoadBalancerSettings;
  siteSlug: string;
}) {
  const [state, action, isPending] = useActionState(
    updateLoadBalancerSettingsAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(state, {
    errorTitle: "Settings update failed",
    successTitle: "Load balancer settings saved",
  });

  return (
    <Form action={action}>
      <input type="hidden" name="siteSlug" value={siteSlug} />

      <div className="space-y-6">
        {/* Core toggles */}
        <div className="space-y-3">
          <h3 className="text-[13px] font-medium text-zinc-300">Core</h3>
          <label className="flex items-start justify-between gap-4 rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <div>
              <p className="text-[13px] font-medium text-zinc-200">Enable Load Balancer</p>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                Start the P2C observer and score nodes every poll interval.
              </p>
            </div>
            <input
              className="mt-1 h-4 w-4 rounded border-white/10 bg-zinc-900 text-sky-400"
              defaultChecked={settings.enabled}
              name="enabled"
              type="checkbox"
            />
          </label>
          <label className="flex items-start justify-between gap-4 rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <div>
              <p className="text-[13px] font-medium text-zinc-200">Enable Auto-Migration</p>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                Automatically migrate VMs/CTs when a node is consistently overloaded. Requires LB to be enabled.
              </p>
            </div>
            <input
              className="mt-1 h-4 w-4 rounded border-white/10 bg-zinc-900 text-sky-400"
              defaultChecked={settings.migrationEnabled}
              name="migrationEnabled"
              type="checkbox"
            />
          </label>
        </div>

        {/* Weights */}
        <div className="space-y-3">
          <h3 className="text-[13px] font-medium text-zinc-300">Score Weights</h3>
          <p className="text-[11px] text-zinc-500">
            Weights are auto-normalized to sum to 1.0. Higher weight = more influence on score.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[11px] font-medium text-zinc-400">CPU</label>
              <input
                className={fieldClassName}
                defaultValue={settings.weights.cpu}
                name="weightCpu"
                type="number"
                min="0"
                max="1"
                step="0.1"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-zinc-400">Memory</label>
              <input
                className={fieldClassName}
                defaultValue={settings.weights.memory}
                name="weightMemory"
                type="number"
                min="0"
                max="1"
                step="0.1"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-zinc-400">Latency</label>
              <input
                className={fieldClassName}
                defaultValue={settings.weights.latency}
                name="weightLatency"
                type="number"
                min="0"
                max="1"
                step="0.1"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-zinc-400">Disk</label>
              <input
                className={fieldClassName}
                defaultValue={settings.weights.disk}
                name="weightDisk"
                type="number"
                min="0"
                max="1"
                step="0.1"
              />
            </div>
          </div>
        </div>

        {/* Polling */}
        <div className="space-y-3">
          <h3 className="text-[13px] font-medium text-zinc-300">Polling</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-zinc-400">Poll Interval (seconds)</label>
              <input
                className={fieldClassName}
                defaultValue={settings.pollIntervalSeconds}
                name="pollIntervalSeconds"
                type="number"
                min="5"
                max="300"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-zinc-400">EWMA Alpha</label>
              <input
                className={fieldClassName}
                defaultValue={settings.ewmaAlpha}
                name="ewmaAlpha"
                type="number"
                min="0.01"
                max="1"
                step="0.01"
              />
            </div>
          </div>
        </div>

        {/* Migration thresholds */}
        <div className="space-y-3">
          <h3 className="text-[13px] font-medium text-zinc-300">Migration Thresholds</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-medium text-zinc-400">Threshold % Above Avg</label>
              <input
                className={fieldClassName}
                defaultValue={settings.migrationThresholdPercent}
                name="migrationThresholdPercent"
                type="number"
                min="10"
                max="200"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-zinc-400">Consecutive Polls</label>
              <input
                className={fieldClassName}
                defaultValue={settings.migrationConsecutivePolls}
                name="migrationConsecutivePolls"
                type="number"
                min="1"
                max="20"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-zinc-400">Cooldown (seconds)</label>
              <input
                className={fieldClassName}
                defaultValue={settings.migrationCooldownSeconds}
                name="migrationCooldownSeconds"
                type="number"
                min="30"
                max="3600"
              />
            </div>
          </div>
        </div>

        {/* Penalty config */}
        <div className="space-y-3">
          <h3 className="text-[13px] font-medium text-zinc-300">Penalties</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-zinc-400">CPU Steal Penalty</label>
              <input
                className={fieldClassName}
                defaultValue={settings.cpuStealPenalty}
                name="cpuStealPenalty"
                type="number"
                min="0"
                max="200"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-zinc-400">CPU Steal Threshold %</label>
              <input
                className={fieldClassName}
                defaultValue={settings.cpuStealThresholdPercent}
                name="cpuStealThresholdPercent"
                type="number"
                min="1"
                max="100"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-zinc-400">Failcnt Penalty</label>
              <input
                className={fieldClassName}
                defaultValue={settings.failcntPenalty}
                name="failcntPenalty"
                type="number"
                min="0"
                max="200"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-zinc-400">Latency Max (ms)</label>
              <input
                className={fieldClassName}
                defaultValue={settings.latencyMaxMs}
                name="latencyMaxMs"
                type="number"
                min="50"
                max="10000"
              />
            </div>
          </div>
        </div>

        <Button
          type="submit"
          disabled={isPending}
          className="gap-2"
        >
          <Save className="w-3.5 h-3.5" />
          {isPending ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </Form>
  );
}

export function LoadBalancerDashboard({
  settings,
  status,
  siteSlug,
}: {
  settings: LoadBalancerSettings;
  status: LoadBalancerStatus;
  siteSlug: string;
}) {
  return (
    <div className="space-y-4">
      <SectionPanel
        title="Node Scores"
        description="Real-time composite scores for all cluster nodes. Lower score = better candidate for new deployments."
      >
        <NodeScoreTable
          scores={status.nodeScores}
          avg={status.clusterAverageScore}
          circuitBreakers={status.circuitBreakers}
        />
      </SectionPanel>

      {/* Migration Log section removed — superseded by the Activity Log
          (load-balancer-event-viewer) which records every migration,
          failure, and tick error persistently across restarts. */}

      <SectionPanel
        title="Settings"
        description="Configure scoring weights, polling intervals, migration thresholds, and penalties."
      >
        <SettingsForm settings={settings} siteSlug={siteSlug} />
      </SectionPanel>
    </div>
  );
}
