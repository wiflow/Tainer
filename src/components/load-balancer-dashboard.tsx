"use client";

import { useActionState, useState } from "react";
import {
  CircleAlert,
  Save,
  Server,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";

import { applyLbPresetAction, updateLoadBalancerSettingsAction } from "@/app/lb-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { InfoLabel, InfoTip } from "@/components/ui/info-tip";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { PillTabs } from "@/components/ui/pill-tabs";
import { SectionPanel } from "@/components/ui/section-panel";
import { initialBasicActionState } from "@/lib/action-states";
import { detectLbPresetIndex, LB_PRESET_STOPS } from "@/lib/load-balancer/presets";
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

/** Column header with an optional ⓘ explaining what the column measures. */
function Th({
  align = "left",
  children,
  className,
  tip,
}: {
  align?: "left" | "right";
  children: string;
  className?: string;
  tip?: React.ReactNode;
}) {
  return (
    <th className={cn("pb-3", align === "right" ? "text-right" : "text-left", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5",
          align === "right" && "justify-end",
        )}
      >
        {children}
        {tip && (
          <InfoTip className="normal-case" label={children} side="top">
            {tip}
          </InfoTip>
        )}
      </span>
    </th>
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
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Server />
          </EmptyMedia>
          <EmptyTitle>No node scores yet</EmptyTitle>
          <EmptyDescription>
            Turn the load balancer on in Settings below and scores appear within a poll interval —
            it starts in Observe mode, so nothing moves until you say so.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const sorted = [...scores].sort((a, b) => a.compositeScore - b.compositeScore);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-white/5 text-left text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
            <Th className="pr-4">Node</Th>
            <Th align="right" className="pr-4">CPU %</Th>
            <Th
              align="right"
              className="pr-4"
              tip="Host memory in use. Weighted highest of the four signals by default — running out of memory is what actually kills workloads."
            >
              Memory %
            </Th>
            <Th align="right" className="pr-4">Disk %</Th>
            <Th
              align="right"
              className="pr-4"
              tip="Smoothed API response time for this node, so one slow request doesn't move the score. A rising figure usually means the node is struggling before its utilization shows it."
            >
              EWMA Latency
            </Th>
            <Th
              align="right"
              className="pr-4"
              tip="Extra points added on top of raw utilization when guests are visibly suffering: VMs losing CPU time to neighbours, containers hitting memory limits, or the kernel reporting stalled tasks (PSI)."
            >
              Penalties
            </Th>
            <Th
              align="right"
              className="pr-4"
              tip="Utilization and latency combined through your weights, plus penalties. Lower is healthier — new deployments are suggested onto the lowest-score nodes."
            >
              Score
            </Th>
            <Th
              tip="The circuit breaker. After repeated API failures a node is taken out of rotation (Circuit Open) and retried cautiously (Half-Open) before it's trusted again."
            >
              Status
            </Th>
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

/** Group heading, with the group's rationale behind an ⓘ rather than a paragraph. */
function GroupHeading({ children, tip }: { children: string; tip?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <h3 className="text-[13px] font-medium text-zinc-300">{children}</h3>
      {tip && (
        <InfoTip label={children} side="right">
          {tip}
        </InfoTip>
      )}
    </div>
  );
}

function ToggleRow({
  defaultChecked,
  name,
  subtitle,
  tip,
  title,
}: {
  defaultChecked: boolean;
  name: string;
  subtitle: string;
  tip: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-white/5 bg-[#111113] px-4 py-3">
      <div>
        <div className="flex items-center gap-1.5">
          <label className="text-[13px] font-medium text-zinc-200" htmlFor={name}>
            {title}
          </label>
          <InfoTip label={title} side="right">
            {tip}
          </InfoTip>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{subtitle}</p>
      </div>
      <input
        className="mt-1 h-4 w-4 rounded border-white/10 bg-zinc-900 text-sky-400"
        defaultChecked={defaultChecked}
        id={name}
        name={name}
        type="checkbox"
      />
    </div>
  );
}

function NumberField({
  defaultValue,
  label,
  max,
  min,
  name,
  step,
  tip,
  tipSide,
}: {
  defaultValue: number;
  label: string;
  max: string;
  min: string;
  name: string;
  step?: string;
  tip: React.ReactNode;
  tipSide?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <div>
      <InfoLabel htmlFor={name} tip={tip} tipSide={tipSide}>
        {label}
      </InfoLabel>
      <input
        className={fieldClassName}
        defaultValue={defaultValue}
        id={name}
        max={max}
        min={min}
        name={name}
        step={step}
        type="number"
      />
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
          <GroupHeading>Core</GroupHeading>
          <ToggleRow
            defaultChecked={settings.enabled}
            name="enabled"
            subtitle="Start the P2C observer and score nodes every poll interval."
            tip="Turns on scoring only. Nodes get a health score every poll and new deployments are steered towards the healthiest ones — nothing moves on its own until auto-migration is enabled too."
            title="Enable Load Balancer"
          />
          <ToggleRow
            defaultChecked={settings.migrationEnabled}
            name="migrationEnabled"
            subtitle="Migrate guests when a node is consistently overloaded."
            tip="Lets the balancer act on what it sees. A node has to stay over the threshold for several consecutive polls first — a brief spike resets the counter and nothing happens. Requires the load balancer to be enabled."
            title="Enable Auto-Migration"
          />
          <ToggleRow
            defaultChecked={settings.migrationDryRun}
            name="migrationDryRun"
            subtitle="Record what the balancer would do, without moving anything."
            tip="The trust-building mode, and the default. Every decision lands in the activity log as “recommended” but nothing is touched. Watch the recommendations for a few days; when they look right, turn this off and the same decisions execute for real."
            title="Dry-Run Mode"
          />
        </div>

        {/* Predictive balancing */}
        <div className="space-y-3">
          <GroupHeading tip="Instead of waiting for a node to overload, the balancer fits a trend line to its score history and can move a guest before the overload lands.">
            Predictive Balancing
          </GroupHeading>
          <ToggleRow
            defaultChecked={settings.predictiveEnabled}
            name="predictiveEnabled"
            subtitle="Move workloads before a node overloads, not after."
            tip="Acts when a node's score trend confidently projects it crossing the migration threshold inside the horizon. Low-confidence or flat trends never act. Requires auto-migration, and respects dry-run."
            title="Act on Forecasts"
          />
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              defaultValue={settings.predictiveHorizonMinutes}
              label="Forecast Horizon (minutes)"
              max="120"
              min="5"
              name="predictiveHorizonMinutes"
              tip="How far ahead a forecast may look. 30 minutes is a good balance: long enough to pre-empt a real climb, short enough that the trend still means something."
            />
            <NumberField
              defaultValue={settings.predictiveMinConfidencePercent}
              label="Min Confidence % (R²)"
              max="99"
              min="10"
              name="predictiveMinConfidencePercent"
              tip="How well the trend line has to fit the score history before the balancer will act on it. Higher means fewer, safer predictive moves; below roughly 70% you're acting on noise."
            />
          </div>
        </div>

        {/* Container safety */}
        <div className="space-y-3">
          <GroupHeading tip="Proxmox cannot live-migrate LXC containers — every automatic move is stop, transfer, start, with real downtime. Containers are therefore excluded from balancing unless you opt in. VMs always live-migrate with no downtime.">
            Container Migrations
          </GroupHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <InfoLabel
                htmlFor="containerMigrations"
                tip="Never keeps containers out of automatic balancing entirely. Windows-only allows moves inside the downtime windows you define. Always treats containers like VMs and accepts the restart whenever the balancer decides."
              >
                Allow Container Moves
              </InfoLabel>
              <select
                className={fieldClassName}
                defaultValue={settings.containerMigrations}
                id="containerMigrations"
                name="containerMigrations"
              >
                <option value="never">Never (recommended)</option>
                <option value="windows-only">Only inside downtime windows</option>
                <option value="always">Always (accept downtime)</option>
              </select>
            </div>
            <div>
              <InfoLabel
                htmlFor="containerMigrationWindows"
                tip="Daily windows in server time when a container restart is acceptable, comma-separated. A window may wrap midnight, e.g. 22:00-06:00, 12:00-13:00."
              >
                Downtime Windows
              </InfoLabel>
              <input
                className={fieldClassName}
                defaultValue={settings.containerMigrationWindows
                  .map((w) => `${w.start}-${w.end}`)
                  .join(", ")}
                id="containerMigrationWindows"
                name="containerMigrationWindows"
                placeholder="22:00-06:00"
                type="text"
              />
            </div>
          </div>
        </div>

        {/* Node management */}
        <div className="space-y-3">
          <GroupHeading>Node Management</GroupHeading>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <InfoLabel
                htmlFor="maintenanceNodes"
                tip="Nodes to drain. Guests are evacuated one at a time (containers restart) and nothing new is placed here — the safe way to empty a node before you take it down."
              >
                Maintenance Nodes (drain)
              </InfoLabel>
              <input
                className={fieldClassName}
                defaultValue={settings.maintenanceNodes.join(", ")}
                id="maintenanceNodes"
                name="maintenanceNodes"
                placeholder="pve2, pve3"
                type="text"
              />
            </div>
            <div>
              <InfoLabel
                htmlFor="excludedNodes"
                tip="Never used as a migration or placement target. Unlike maintenance mode, whatever already runs here stays put."
              >
                Excluded Nodes
              </InfoLabel>
              <input
                className={fieldClassName}
                defaultValue={settings.excludedNodes.join(", ")}
                id="excludedNodes"
                name="excludedNodes"
                placeholder="pve4"
                type="text"
              />
            </div>
            <div>
              <InfoLabel
                htmlFor="excludedVmids"
                tip={
                  <>
                    Guests that are never migrated automatically. You can also tag them in
                    Proxmox: <Tag>plb_ignore</Tag> (never move), <Tag>plb_manual</Tag> (no
                    automatic moves, but drains and plans still apply),{" "}
                    <Tag>plb_pin_&lt;node&gt;</Tag> (stay on one node),{" "}
                    <Tag>plb_affinity_&lt;group&gt;</Tag> (keep together) and{" "}
                    <Tag>plb_anti_affinity_&lt;group&gt;</Tag> (keep apart).
                  </>
                }
              >
                Excluded VMIDs
              </InfoLabel>
              <input
                className={fieldClassName}
                defaultValue={settings.excludedVmids.join(", ")}
                id="excludedVmids"
                name="excludedVmids"
                placeholder="101, 20005"
                type="text"
              />
            </div>
          </div>
        </div>

        {/* Weights */}
        <div className="space-y-3">
          <GroupHeading tip="How much each signal counts towards a node's score. Weights are auto-normalized to sum to 1.0, so only their ratio matters — higher weight, more influence.">
            Score Weights
          </GroupHeading>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <NumberField
              defaultValue={settings.weights.cpu}
              label="CPU"
              max="1"
              min="0"
              name="weightCpu"
              step="0.1"
              tip="How much host CPU utilization counts. Raise it for compute-bound clusters where CPU runs out before memory does."
            />
            <NumberField
              defaultValue={settings.weights.memory}
              label="Memory"
              max="1"
              min="0"
              name="weightMemory"
              step="0.1"
              tip="How much host memory usage counts. Highest by default, because a node that runs out of memory kills workloads rather than just slowing them down."
            />
            <NumberField
              defaultValue={settings.weights.latency}
              label="Latency"
              max="1"
              min="0"
              name="weightLatency"
              step="0.1"
              tip="How much the node's smoothed API response time counts. A useful early warning: a node often answers slowly before its utilization looks bad."
            />
            <NumberField
              defaultValue={settings.weights.disk}
              label="Disk"
              max="1"
              min="0"
              name="weightDisk"
              step="0.1"
              tip="How much local storage usage counts. Usually the smallest weight — full disks are a capacity problem, not a contention one."
            />
          </div>
        </div>

        {/* Polling */}
        <div className="space-y-3">
          <GroupHeading>Polling</GroupHeading>
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              defaultValue={settings.pollIntervalSeconds}
              label="Poll Interval (seconds)"
              max="300"
              min="5"
              name="pollIntervalSeconds"
              tip="How often every node is measured and rescored. Shorter reacts faster but puts more load on the Proxmox API; it also shortens the real time behind “consecutive polls”."
            />
            <NumberField
              defaultValue={settings.ewmaAlpha}
              label="EWMA Alpha"
              max="1"
              min="0.01"
              name="ewmaAlpha"
              step="0.01"
              tip="How much the newest latency sample counts when smoothing. Near 1 tracks the latest reading almost exactly; near 0 barely moves. Low values keep one slow request from swaying the score."
            />
          </div>
        </div>

        {/* Migration thresholds */}
        <div className="space-y-3">
          <GroupHeading tip="The gates a move has to clear. Together they decide how much imbalance is tolerated and how often the cluster is allowed to churn.">
            Migration Thresholds
          </GroupHeading>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <NumberField
              defaultValue={settings.migrationThresholdPercent}
              label="Threshold % Above Avg"
              max="200"
              min="10"
              name="migrationThresholdPercent"
              tip="How far above the cluster average a node's score must sit to count as overloaded. Lower chases smaller imbalances and produces more migrations."
            />
            <NumberField
              defaultValue={settings.migrationConsecutivePolls}
              label="Consecutive Polls"
              max="20"
              min="1"
              name="migrationConsecutivePolls"
              tip="How many polls in a row a node has to stay over the threshold before it becomes a candidate. This is what filters out spikes — a single good reading resets the counter."
            />
            <NumberField
              defaultValue={settings.migrationCooldownSeconds}
              label="Cooldown (seconds)"
              max="3600"
              min="30"
              name="migrationCooldownSeconds"
              tip="How long a node is left alone after a move, so the balancer can see the effect before deciding again. Short cooldowns are the usual cause of migration churn."
            />
            <NumberField
              defaultValue={settings.maxConcurrentMigrations}
              label="Max Concurrent Migrations"
              max="10"
              min="1"
              name="maxConcurrentMigrations"
              tip="Cluster-wide cap on migrations in flight at once, drains included. Migrations compete for the same network and storage, so more is not faster."
            />
            <NumberField
              defaultValue={settings.minTargetImprovementPercent}
              label="Min Improvement %"
              max="80"
              min="5"
              name="minTargetImprovementPercent"
              tip="The target must beat the source score by at least this much or the move is skipped. The cost-benefit floor that stops the balancer trading one busy node for another."
            />
          </div>
        </div>

        {/* Penalty config */}
        <div className="space-y-3">
          <GroupHeading tip="Points added to a node's score when its guests are visibly suffering. Utilization alone misses contention — a node at 60% CPU can still be stalling everything on it.">
            Penalties
          </GroupHeading>
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              defaultValue={settings.cpuStealPenalty}
              label="CPU Steal Penalty"
              max="200"
              min="0"
              name="cpuStealPenalty"
              tip="Points added when a VM is losing CPU time to noisy neighbours. Steal is the clearest sign a host is oversubscribed. 0 disables it."
            />
            <NumberField
              defaultValue={settings.cpuStealThresholdPercent}
              label="CPU Steal Threshold %"
              max="100"
              min="1"
              name="cpuStealThresholdPercent"
              tip="How much steal a guest has to see before the penalty applies. A few percent is normal on any shared host; sustained double digits is not."
            />
            <NumberField
              defaultValue={settings.failcntPenalty}
              label="Failcnt Penalty"
              max="200"
              min="0"
              name="failcntPenalty"
              tip="Points added when containers on the node are hitting their memory limits (the cgroup failure counter). 0 disables it."
            />
            <NumberField
              defaultValue={settings.latencyMaxMs}
              label="Latency Max (ms)"
              max="10000"
              min="50"
              name="latencyMaxMs"
              tip="The response time treated as “as bad as it gets” when normalising latency into the score. Anything slower scores the same — it just caps the scale."
            />
            <NumberField
              defaultValue={settings.psiPenalty}
              label="PSI Pressure Penalty"
              max="200"
              min="0"
              name="psiPenalty"
              tip="Points added per stalled resource (CPU, memory or IO) when the kernel reports tasks actually waiting. Catches contention that plain utilization hides. Requires Proxmox VE 9+; 0 disables it."
            />
            <NumberField
              defaultValue={settings.psiThresholdPercent}
              label="PSI Threshold % (avg10)"
              max="100"
              min="1"
              name="psiThresholdPercent"
              tip="How much stalling, on the kernel's 10-second average, counts as pressure. Around 10% is a reasonable floor; lower makes the penalty fire on brief contention."
            />
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

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-zinc-900/80 px-1 py-0.5 text-[11px] text-zinc-200">
      {children}
    </code>
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

      <SettingsTabs settings={settings} siteSlug={siteSlug} />
    </div>
  );
}

function SettingsTabs({
  settings,
  siteSlug,
}: {
  settings: LoadBalancerSettings;
  siteSlug: string;
}) {
  // Simple by default; land on Advanced only when the current settings
  // don't match any preset (someone already tuned the knobs by hand).
  const presetIndex = detectLbPresetIndex(settings);
  const [tab, setTab] = useState<"simple" | "advanced">("simple");

  return (
    <SectionPanel
      title="Settings"
      description={
        tab === "simple"
          ? "One dial: how eagerly the balancer moves guests. Everything else keeps sensible defaults."
          : "Configure scoring weights, polling intervals, migration thresholds, and penalties."
      }
      headerRight={
        <PillTabs
          items={[
            { active: tab === "simple", label: "Simple", onClick: () => setTab("simple") },
            { active: tab === "advanced", label: "Advanced", onClick: () => setTab("advanced") },
          ]}
        />
      }
    >
      {tab === "simple" ? (
        <SimpleSettingsForm presetIndex={presetIndex} settings={settings} siteSlug={siteSlug} />
      ) : (
        <SettingsForm settings={settings} siteSlug={siteSlug} />
      )}
    </SectionPanel>
  );
}

function SimpleSettingsForm({
  presetIndex,
  settings,
  siteSlug,
}: {
  presetIndex: number | null;
  settings: LoadBalancerSettings;
  siteSlug: string;
}) {
  const [state, action, isPending] = useActionState(applyLbPresetAction, initialBasicActionState);
  useActionFlashFeedback(state, {
    errorTitle: "Preset apply failed",
    successTitle: "Load balancer updated",
  });

  // Default to Balanced when the current settings are custom.
  const [level, setLevel] = useState(presetIndex ?? 2);
  const stop = LB_PRESET_STOPS[level];
  const isCustom = presetIndex === null;

  return (
    <form action={action} className="space-y-4 p-4">
      <input name="siteSlug" type="hidden" value={siteSlug} />
      <input name="preset" type="hidden" value={level} />

      <div className="flex items-center gap-2">
        <input
          className="h-4 w-4 border-white/10 bg-zinc-900 text-sky-400"
          defaultChecked={settings.enabled}
          id="simpleEnabled"
          name="enabled"
          type="checkbox"
        />
        <label className="text-[13px] font-medium text-zinc-200" htmlFor="simpleEnabled">
          Load balancer enabled
        </label>
        <InfoTip label="Load balancer enabled" side="right">
          Scores every node each poll and steers new deployments towards the healthiest one.
          Whether it also <em>moves</em> existing guests depends on the aggressiveness setting
          below.
        </InfoTip>
      </div>

      <div className="max-w-xl">
        <div className="flex items-baseline justify-between">
          <span className="flex items-center gap-1.5">
            <span className="text-[13px] font-medium text-zinc-200">Aggressiveness</span>
            <InfoTip label="Aggressiveness" side="right">
              One dial over the settings that decide how eagerly guests move: how much imbalance
              is tolerated, how long it must persist, and how long a node rests afterwards.
              Weights, penalties, container policy and exclusions are left exactly as they are.
            </InfoTip>
          </span>
          <span className="text-[12px] text-sky-300">{stop.label}</span>
        </div>
        <input
          className="mt-2 w-full accent-sky-400"
          max={LB_PRESET_STOPS.length - 1}
          min={0}
          onChange={(e) => setLevel(Number(e.target.value))}
          step={1}
          type="range"
          value={level}
        />
        <div className="mt-1 flex justify-between text-[10.5px] text-zinc-500">
          {LB_PRESET_STOPS.map((s, i) => (
            <button
              className={i === level ? "text-sky-300" : "hover:text-zinc-300"}
              key={s.key}
              onClick={() => setLevel(i)}
              type="button"
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-zinc-400">{stop.description}</p>
        {isCustom && (
          <p className="mt-1.5 text-[11px] text-amber-200/80">
            The current settings were hand-tuned in Advanced mode. Applying a preset replaces the
            migration thresholds and cooldowns, but keeps weights, penalties, container policy and
            exclusions as they are.
          </p>
        )}
      </div>

      <Button disabled={isPending} size="sm" type="submit">
        {isPending ? "Applying..." : `Apply ${stop.label}`}
      </Button>
    </form>
  );
}
