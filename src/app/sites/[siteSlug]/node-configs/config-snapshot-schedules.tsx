"use client";

import { CalendarClock, Pause, Play, Plus, Trash2, Zap } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import {
  createConfigSnapshotPolicyAction,
  deleteConfigSnapshotPolicyAction,
  runConfigSnapshotPolicyNowAction,
  toggleConfigSnapshotPolicyAction,
} from "@/app/node-config-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import {
  CONFIG_SNAPSHOT_INTERVAL_OPTIONS,
  formatConfigIntervalLabel,
  type ConfigSnapshotPolicyView as ConfigSnapshotPolicy,
} from "@/lib/config-snapshot-shared";

function extractSiteSlug(pathname: string): string {
  const match = pathname.match(/^\/sites\/([^/]+)/);
  return match?.[1] ?? "";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatRelativeFromNow(iso: string | null): string {
  if (!iso) return "—";
  const now = Date.now();
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return "—";
  const diffMs = target - now;
  const future = diffMs >= 0;
  const abs = Math.abs(diffMs);
  const m = Math.round(abs / 60_000);
  if (m < 1) return future ? "in <1m" : "<1m ago";
  if (m < 60) return future ? `in ${m}m` : `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return future ? `in ${h}h` : `${h}h ago`;
  const d = Math.round(h / 24);
  return future ? `in ${d}d` : `${d}d ago`;
}

const fieldClassName =
  "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

function ScheduleRow({
  policy,
  siteSlug,
}: {
  policy: ConfigSnapshotPolicy;
  siteSlug: string;
}) {
  const [toggleState, toggleAction, isToggling] = useActionState(
    toggleConfigSnapshotPolicyAction,
    initialBasicActionState,
  );
  const [runState, runAction, isRunning] = useActionState(
    runConfigSnapshotPolicyNowAction,
    initialBasicActionState,
  );
  const [deleteState, deleteAction, isDeleting] = useActionState(
    deleteConfigSnapshotPolicyAction,
    initialBasicActionState,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const deleteFormRef = useRef<HTMLFormElement>(null);

  useActionFlashFeedback(toggleState, {
    errorTitle: "Toggle failed",
    successTitle: policy.enabled ? "Schedule paused" : "Schedule resumed",
  });
  useActionFlashFeedback(runState, {
    errorTitle: "Run failed",
    successTitle: "Snapshot triggered",
  });
  useActionFlashFeedback(deleteState, {
    errorTitle: "Delete failed",
    successTitle: "Schedule deleted",
  });

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-white/5 px-5 py-3 last:border-b-0 hover:bg-[#111113] transition-colors">
      <div className="flex-1 min-w-[200px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-zinc-200">{policy.name}</span>
          <Badge variant={policy.enabled ? "success" : "neutral"}>
            {policy.enabled ? "active" : "paused"}
          </Badge>
          <Badge variant="neutral">{policy.nodeName}</Badge>
          <Badge variant="info">{formatConfigIntervalLabel(policy.intervalMinutes)}</Badge>
          <Badge variant="neutral">
            keep {policy.retentionCount === 0 ? "all" : policy.retentionCount}
          </Badge>
        </div>
        {policy.description && (
          <p className="mt-0.5 text-[11px] text-zinc-500">{policy.description}</p>
        )}
        <p className="mt-0.5 text-[11px] text-zinc-600">
          Last run: {formatDate(policy.lastRunAt)}
          {policy.enabled && policy.nextRunAt && (
            <>
              {" · "}
              Next: {formatRelativeFromNow(policy.nextRunAt)}
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Form action={runAction}>
          <input name="siteSlug" type="hidden" value={siteSlug} />
          <input name="policyId" type="hidden" value={policy.id} />
          <button
            className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-emerald-400 transition-colors"
            disabled={isRunning}
            title="Run now"
            type="submit"
          >
            <Zap className="h-3.5 w-3.5" />
          </button>
        </Form>
        <Form action={toggleAction}>
          <input name="siteSlug" type="hidden" value={siteSlug} />
          <input name="policyId" type="hidden" value={policy.id} />
          {!policy.enabled && <input name="enabled" type="hidden" value="on" />}
          <button
            className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-sky-400 transition-colors"
            disabled={isToggling}
            title={policy.enabled ? "Pause schedule" : "Resume schedule"}
            type="submit"
          >
            {policy.enabled ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </button>
        </Form>
        <Form action={deleteAction} ref={deleteFormRef}>
          <input name="siteSlug" type="hidden" value={siteSlug} />
          <input name="policyId" type="hidden" value={policy.id} />
          <button
            className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-red-400 transition-colors"
            disabled={isDeleting}
            onClick={() => setConfirmOpen(true)}
            title="Delete schedule"
            type="button"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </Form>

        <ConfirmDialog
          consequences={[
            "Snapshots already taken by this schedule are kept.",
            "No further snapshots will be taken automatically for this node.",
          ]}
          description={`Delete the snapshot schedule "${policy.name}"?`}
          onConfirm={() => {
            setConfirmOpen(false);
            deleteFormRef.current?.requestSubmit();
          }}
          onOpenChange={setConfirmOpen}
          open={confirmOpen}
          pending={isDeleting}
          title="Delete snapshot schedule"
        />
      </div>
    </div>
  );
}

export function ConfigSnapshotSchedules({
  nodeNames,
  policies,
}: {
  nodeNames: string[];
  policies: ConfigSnapshotPolicy[];
}) {
  const pathname = usePathname();
  const siteSlug = extractSiteSlug(pathname);

  const [showCreate, setShowCreate] = useState(policies.length === 0);
  const [createState, createAction, isCreating] = useActionState(
    createConfigSnapshotPolicyAction,
    initialBasicActionState,
  );
  useActionFlashFeedback(createState, {
    errorTitle: "Schedule failed",
    successTitle: "Schedule created",
  });

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-sky-400" />
              Scheduled snapshots
            </CardTitle>
            <CardDescription>
              Capture node configuration on a recurring interval. Each policy keeps a
              rolling window of its own snapshots so manual snapshots are never affected.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="neutral">
              {policies.length} schedule{policies.length === 1 ? "" : "s"}
            </Badge>
            {!showCreate && (
              <Button onClick={() => setShowCreate(true)} size="sm" variant="secondary">
                <Plus className="h-3.5 w-3.5" />
                New schedule
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {showCreate && (
        <CardContent className="border-b border-white/5 p-5">
          <Form action={createAction} className="grid gap-3 md:grid-cols-2">
            <input name="siteSlug" type="hidden" value={siteSlug} />
            <input name="enabled" type="hidden" value="on" />
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-400">Schedule name</span>
              <input
                className={fieldClassName}
                name="name"
                placeholder="e.g. Daily — pve-01"
                required
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-400">Node</span>
              <select className={fieldClassName} name="nodeName" required>
                <option value="">Select node...</option>
                {nodeNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-400">Interval</span>
              <select className={fieldClassName} defaultValue={1440} name="intervalMinutes">
                {CONFIG_SNAPSHOT_INTERVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-400">
                Retention (max snapshots from this schedule)
              </span>
              <input
                className={fieldClassName}
                defaultValue={14}
                min={0}
                name="retentionCount"
                type="number"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-[12px] font-medium text-zinc-400">
                Description (optional)
              </span>
              <input
                className={fieldClassName}
                name="description"
                placeholder="e.g. Pre-maintenance daily archive"
              />
            </label>
            <div className="md:col-span-2 flex items-center justify-end gap-2">
              <Button onClick={() => setShowCreate(false)} type="button" variant="ghost">
                Cancel
              </Button>
              <Button disabled={isCreating} type="submit">
                <Plus className="h-3.5 w-3.5" />
                {isCreating ? "Creating..." : "Create schedule"}
              </Button>
            </div>
          </Form>
        </CardContent>
      )}

      <CardContent className="p-0">
        {policies.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CalendarClock className="h-7 w-7 text-zinc-600" />
            <p className="text-[13px] text-zinc-500">
              No schedules yet. Create one above to capture snapshots automatically.
            </p>
          </div>
        ) : (
          policies.map((p) => (
            <ScheduleRow key={p.id} policy={p} siteSlug={siteSlug} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
