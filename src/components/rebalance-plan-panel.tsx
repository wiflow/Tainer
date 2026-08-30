"use client";

import { useActionState } from "react";
import { ArrowRight, Calculator, Check, Play, Trash2, X } from "lucide-react";

import {
  applyRebalancePlanAction,
  cancelRebalancePlanAction,
  computeRebalancePlanAction,
} from "@/app/lb-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { InfoLabel, InfoTip } from "@/components/ui/info-tip";
import { SectionPanel } from "@/components/ui/section-panel";
import { initialBasicActionState } from "@/lib/action-states";
import type { RebalancePlan, RebalancePlanMove } from "@/lib/load-balancer/plan-store";

const fieldClassName =
  "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

function moveStatusBadge(move: RebalancePlanMove) {
  switch (move.status) {
    case "queued":
      return <Badge variant="neutral" className="text-[10px]">Queued</Badge>;
    case "migrating":
      return <Badge variant="info" className="text-[10px]">Migrating…</Badge>;
    case "done":
      return (
        <Badge variant="success" className="text-[10px]">
          <Check className="mr-1 h-3 w-3" />
          Done
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive" className="text-[10px]">Failed</Badge>;
    case "skipped":
      return <Badge variant="warning" className="text-[10px]">Skipped</Badge>;
  }
}

function formatMem(bytes: number): string {
  if (bytes <= 0) return "—";
  const gib = bytes / 1024 ** 3;
  return gib >= 1 ? `${gib.toFixed(1)} GiB` : `${(bytes / 1024 ** 2).toFixed(0)} MiB`;
}

function MovesTable({ plan }: { plan: RebalancePlan }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-white/5 text-left text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
            <th className="pb-2 pr-4">Guest</th>
            <th className="pb-2 pr-4">Type</th>
            <th className="pb-2 pr-4">Move</th>
            <th className="pb-2 pr-4 text-right">Memory</th>
            <th className="pb-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {plan.moves.map((move) => (
            <tr key={move.vmid} className="border-b border-white/5 last:border-0">
              <td className="py-2.5 pr-4">
                <span className="font-medium text-zinc-200">{move.name}</span>
                <span className="ml-2 font-mono text-[11px] text-zinc-500">{move.vmid}</span>
              </td>
              <td className="py-2.5 pr-4">
                <Badge variant={move.type === "lxc" ? "warning" : "neutral"} className="text-[10px]">
                  {move.type === "lxc" ? "CT (restart)" : "VM (live)"}
                </Badge>
              </td>
              <td className="py-2.5 pr-4">
                <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-zinc-300">
                  {move.sourceNode}
                  <ArrowRight className="h-3 w-3 text-zinc-500" />
                  {move.targetNode}
                </span>
              </td>
              <td className="py-2.5 pr-4 text-right text-zinc-300">{formatMem(move.memBytes)}</td>
              <td className="py-2.5">
                {moveStatusBadge(move)}
                {move.error ? (
                  <span className="ml-2 text-[11px] text-zinc-500">{move.error}</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComputeForm({ siteSlug }: { siteSlug: string }) {
  const [state, action, isPending] = useActionState(
    computeRebalancePlanAction,
    initialBasicActionState,
  );
  useActionFlashFeedback(state, {
    errorTitle: "Plan computation failed",
    successTitle: "Rebalance plan",
  });

  return (
    <Form action={action}>
      <input type="hidden" name="siteSlug" value={siteSlug} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-32">
          <InfoLabel
            htmlFor="maxMoves"
            tip="Upper bound on how many migrations the plan may contain. The optimizer stops as soon as extra moves stop meaningfully improving balance, so this is a ceiling, not a target."
          >
            Max Moves
          </InfoLabel>
          <input
            className={fieldClassName}
            defaultValue={5}
            id="maxMoves"
            name="maxMoves"
            type="number"
            min="1"
            max="20"
          />
        </div>
        <div className="flex items-center gap-2 pb-2.5">
          <input
            className="h-4 w-4 rounded border-white/10 bg-zinc-900 text-sky-400"
            id="includeContainers"
            name="includeContainers"
            type="checkbox"
          />
          <label className="text-[12px] text-zinc-400" htmlFor="includeContainers">
            Include containers
          </label>
          <InfoTip label="Include containers" side="right">
            Lets the plan move LXC containers as well as VMs. Proxmox cannot live-migrate a
            container, so each one is stopped, transferred and started again — real downtime for
            whatever runs inside it.
          </InfoTip>
        </div>
        <Button type="submit" disabled={isPending} className="gap-2">
          <Calculator className="h-3.5 w-3.5" />
          {isPending ? "Computing…" : "Compute Plan"}
        </Button>
      </div>
    </Form>
  );
}

function ApplyButton({ siteSlug, planId }: { siteSlug: string; planId: string }) {
  const [state, action, isPending] = useActionState(
    applyRebalancePlanAction,
    initialBasicActionState,
  );
  useActionFlashFeedback(state, {
    errorTitle: "Failed to apply plan",
    successTitle: "Rebalance plan",
  });
  return (
    <Form action={action}>
      <input type="hidden" name="siteSlug" value={siteSlug} />
      <input type="hidden" name="planId" value={planId} />
      <Button type="submit" disabled={isPending} className="gap-2">
        <Play className="h-3.5 w-3.5" />
        {isPending ? "Applying…" : "Apply Plan"}
      </Button>
    </Form>
  );
}

function CancelButton({
  siteSlug,
  planId,
  label,
}: {
  siteSlug: string;
  planId: string;
  label: string;
}) {
  const [state, action, isPending] = useActionState(
    cancelRebalancePlanAction,
    initialBasicActionState,
  );
  useActionFlashFeedback(state, {
    errorTitle: "Failed to remove plan",
    successTitle: "Rebalance plan",
  });
  return (
    <Form action={action}>
      <input type="hidden" name="siteSlug" value={siteSlug} />
      <input type="hidden" name="planId" value={planId} />
      <Button type="submit" disabled={isPending} variant="ghost" className="gap-2">
        {label === "Cancel Plan" ? <X className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
        {isPending ? "Working…" : label}
      </Button>
    </Form>
  );
}

export function RebalancePlanPanel({
  plan,
  siteSlug,
}: {
  plan: RebalancePlan | null;
  siteSlug: string;
}) {
  return (
    <SectionPanel
      title="Rebalance Plan"
      description="Compute an optimal multi-move plan for the whole cluster, review every move, then apply. Each move is re-validated against live state before it fires."
    >
      <div className="space-y-4">
        {!plan || plan.status === "cancelled" ? (
          <ComputeForm siteSlug={siteSlug} />
        ) : null}

        {plan ? (
          <div className="space-y-3 rounded-md border border-white/5 bg-[#111113] p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge
                variant={
                  plan.status === "active"
                    ? "info"
                    : plan.status === "completed"
                      ? "success"
                      : plan.status === "cancelled"
                        ? "warning"
                        : "neutral"
                }
                className="text-[10px] uppercase"
              >
                {plan.status}
              </Badge>
              <span className="flex items-center gap-1.5 text-[12px] text-zinc-400">
                Projected imbalance{" "}
                <span className="font-mono text-zinc-200">{plan.imbalanceBefore.toFixed(3)}</span>
                {" → "}
                <span className="font-mono text-emerald-400">{plan.imbalanceAfter.toFixed(3)}</span>
                <InfoTip label="Projected imbalance" side="bottom">
                  How unevenly load sits across the cluster, as the coefficient of variation of
                  the node scores — lower is more even. The second figure is where the plan
                  expects to land once every move has been applied.
                </InfoTip>
              </span>
              <span className="text-[11px] text-zinc-500">
                by {plan.createdBy} · {new Date(plan.createdAt).toLocaleString()}
              </span>
            </div>

            <MovesTable plan={plan} />

            <div className="flex gap-2">
              {plan.status === "draft" ? (
                <>
                  <ApplyButton siteSlug={siteSlug} planId={plan.id} />
                  <CancelButton siteSlug={siteSlug} planId={plan.id} label="Discard" />
                </>
              ) : plan.status === "active" ? (
                <CancelButton siteSlug={siteSlug} planId={plan.id} label="Cancel Plan" />
              ) : (
                <CancelButton siteSlug={siteSlug} planId={plan.id} label="Dismiss" />
              )}
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-zinc-500">
            No plan yet. Compute one to see which moves would even out the cluster — nothing
            migrates until you apply it.
          </p>
        )}
      </div>
    </SectionPanel>
  );
}
