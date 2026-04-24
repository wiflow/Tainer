"use client";

import { useActionState, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  HardDrive,
  Pause,
  PenLine,
  Play,
  PlayCircle,
  Plus,
  Tag,
} from "lucide-react";

import { runBackupPolicyNowAction, toggleBackupPolicyAction } from "@/app/backup-policy-actions";
import { BackupPolicyEditor } from "@/components/backup-policy-editor";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type { BackupPolicy } from "@/lib/backup-policies";
import type { ContainerTag } from "@/lib/container-groups";
import type { ProxmoxBackupStoragePool } from "@/lib/proxmox";
import { getTagPillClass } from "@/lib/tag-utils";
import { useSiteBasePath } from "@/lib/use-site-path";

function formatDate(iso: string | null) {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatIntervalLabel(minutes: number): string {
  if (minutes <= 360) return "Every 6h";
  if (minutes <= 720) return "Every 12h";
  if (minutes <= 1440) return "Every 24h";
  if (minutes <= 2880) return "Every 48h";
  if (minutes <= 10080) return "Weekly";
  return `Every ${Math.round(minutes / 1440)}d`;
}

function formatNextRun(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "due now";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `in ${hrs}h`;
  const days = Math.round(hrs / 24);
  return `in ${days}d`;
}

function PolicyCard({
  availableTags,
  cloudBackupEnabled,
  healthyPools,
  policy,
}: {
  availableTags: ContainerTag[];
  cloudBackupEnabled?: boolean;
  healthyPools: ProxmoxBackupStoragePool[];
  policy: BackupPolicy;
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [toggleState, toggleAction, isToggling] = useActionState(
    toggleBackupPolicyAction,
    initialBasicActionState,
  );
  const [runNowState, runNowAction, isRunningNow] = useActionState(
    runBackupPolicyNowAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(toggleState, {
    errorTitle: "Toggle failed",
    successTitle: policy.enabled ? "Policy disabled" : "Policy enabled",
  });
  useActionFlashFeedback(runNowState, {
    errorTitle: "Run failed",
    successTitle: "Backup run started",
  });

  if (editing) {
    return (
      <BackupPolicyEditor
        availableTags={availableTags}
        cloudBackupEnabled={cloudBackupEnabled}
        healthyPools={healthyPools}
        onClose={() => setEditing(false)}
        policy={policy}
      />
    );
  }

  return (
    <div className="rounded-xl border border-white/5 bg-zinc-900/20">
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="flex items-center gap-1.5 text-left"
                onClick={() => setExpanded(!expanded)}
                type="button"
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                )}
                <span className="text-[14px] font-semibold text-zinc-100">
                  {policy.name}
                </span>
              </button>
              <Badge variant={policy.enabled ? "success" : "neutral"}>
                {policy.enabled ? "Active" : "Disabled"}
              </Badge>
              <Badge variant="info">{formatIntervalLabel(policy.intervalMinutes)}</Badge>
              {policy.scope === "tagged" && (
                <Badge variant="warning">
                  <Tag className="mr-1 h-3 w-3" />
                  {policy.tagSlugs.length} tag{policy.tagSlugs.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            {policy.description && (
              <p className="mt-1 text-[12px] text-zinc-500">{policy.description}</p>
            )}
            {policy.enabled && policy.nextRunAt && (
              <p className="mt-1 text-[11px] text-zinc-600">
                Next run {formatNextRun(policy.nextRunAt)}
                {policy.lastRunAt && <> · Last: {formatDate(policy.lastRunAt)}</>}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Form action={runNowAction}>
              <input name="siteSlug" type="hidden" value={siteSlug} />
              <input name="policyId" type="hidden" value={policy.id} />
              <button
                className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
                disabled={isRunningNow}
                title="Run now"
                type="submit"
              >
                <PlayCircle className="h-3.5 w-3.5" />
              </button>
            </Form>
            <Form action={toggleAction}>
              <input name="siteSlug" type="hidden" value={siteSlug} />
              <input name="policyId" type="hidden" value={policy.id} />
              <input
                name="enabled"
                type="hidden"
                value={policy.enabled ? "false" : "true"}
              />
              <button
                className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
                disabled={isToggling}
                title={policy.enabled ? "Disable policy" : "Enable policy"}
                type="submit"
              >
                {policy.enabled ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
              </button>
            </Form>
            <button
              className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
              onClick={() => setEditing(true)}
              title="Edit policy"
              type="button"
            >
              <PenLine className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 space-y-3 border-t border-white/5/60 pt-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-600">Storage</p>
                <p className="mt-1 text-[13px] text-zinc-300">
                  {policy.storage || "Not set"}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-600">Compression</p>
                <p className="mt-1 text-[13px] text-zinc-300">
                  {policy.compression}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-600">Mode</p>
                <p className="mt-1 text-[13px] text-zinc-300">
                  {policy.mode}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-600">Retention</p>
                <p className="mt-1 text-[13px] text-zinc-300">
                  {policy.retentionCount > 0 ? `Keep last ${policy.retentionCount}` : "Unlimited"}
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-600">Scope</p>
                {policy.scope === "all" ? (
                  <p className="mt-1 text-[13px] text-zinc-300">All workloads</p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {policy.tagSlugs.length === 0 ? (
                      <span className="text-[13px] text-zinc-500">none</span>
                    ) : (
                      policy.tagSlugs.map((slug) => {
                        const tag = availableTags.find((t) => t.slug === slug);
                        return (
                          <span
                            key={slug}
                            className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                              tag ? getTagPillClass(tag.color) : "border-white/5 bg-[#111113] text-zinc-400"
                            }`}
                          >
                            {tag?.name ?? slug}
                          </span>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-600">Last run</p>
                <p className="mt-1 text-[13px] text-zinc-300">
                  {formatDate(policy.lastRunAt)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-600">Next run</p>
                <p className="mt-1 text-[13px] text-zinc-300">
                  {formatDate(policy.nextRunAt)}
                </p>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button onClick={() => setEditing(true)} size="sm" variant="secondary">
                <PenLine className="h-3.5 w-3.5" />
                Edit policy
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function BackupPoliciesList({
  availableTags,
  cloudBackupEnabled,
  healthyPools,
  policies,
}: {
  availableTags: ContainerTag[];
  cloudBackupEnabled?: boolean;
  healthyPools: ProxmoxBackupStoragePool[];
  policies: BackupPolicy[];
}) {
  const [creating, setCreating] = useState(false);

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Backup policies</CardTitle>
            <CardDescription>
              Automated backup schedules with retention management. Each policy runs independently via the built-in scheduler.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="neutral">
              {policies.length} polic{policies.length === 1 ? "y" : "ies"}
            </Badge>
            <Badge variant="success">
              {policies.filter((p) => p.enabled).length} active
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-5">
        {policies.length === 0 && !creating && (
          <div className="rounded-xl border border-dashed border-white/10 bg-zinc-900/20 px-6 py-8 text-center">
            <HardDrive className="mx-auto h-8 w-8 text-zinc-600" />
            <p className="mt-3 text-[14px] font-medium text-zinc-300">No backup policies yet</p>
            <p className="mt-1 text-[12px] text-zinc-500">
              Create your first policy to automate vzdump backups with retention management.
            </p>
          </div>
        )}

        {policies.map((policy) => (
          <PolicyCard
            availableTags={availableTags}
            cloudBackupEnabled={cloudBackupEnabled}
            healthyPools={healthyPools}
            key={policy.id}
            policy={policy}
          />
        ))}

        {creating ? (
          <BackupPolicyEditor
            availableTags={availableTags}
            cloudBackupEnabled={cloudBackupEnabled}
            healthyPools={healthyPools}
            onClose={() => setCreating(false)}
          />
        ) : (
          <Button
            className="w-full justify-center"
            onClick={() => setCreating(true)}
            variant="secondary"
          >
            <Plus className="h-3.5 w-3.5" />
            Create backup policy
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
