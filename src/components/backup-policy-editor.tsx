"use client";

import { useActionState, useEffect, useState } from "react";
import { Copy, Save, Trash2, X } from "lucide-react";

import {
  createBackupPolicyAction,
  deleteBackupPolicyAction,
  duplicateBackupPolicyAction,
  updateBackupPolicyAction,
} from "@/app/backup-policy-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type { BackupPolicy } from "@/lib/backup-policies";
import type { ContainerTag } from "@/lib/container-groups";
import type { ProxmoxBackupStoragePool } from "@/lib/proxmox";
import { getTagPillClass, getTagSelectedPillClass } from "@/lib/tag-utils";
import { useSiteBasePath } from "@/lib/use-site-path";

const INTERVAL_OPTIONS = [
  { label: "Every 6 hours", value: 360 },
  { label: "Every 12 hours", value: 720 },
  { label: "Every 24 hours", value: 1440 },
  { label: "Every 48 hours", value: 2880 },
  { label: "Weekly", value: 10080 },
] as const;

const COMPRESSION_OPTIONS = [
  { label: "zstd (recommended)", value: "zstd" },
  { label: "gzip", value: "gzip" },
  { label: "lzo", value: "lzo" },
  { label: "None", value: "none" },
] as const;

const MODE_OPTIONS = [
  { label: "Snapshot (no downtime)", value: "snapshot" },
  { label: "Suspend (brief pause)", value: "suspend" },
  { label: "Stop (full stop)", value: "stop" },
] as const;

const fieldClassName =
  "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

export function BackupPolicyEditor({
  availableTags,
  healthyPools,
  onClose,
  policy,
}: {
  availableTags: ContainerTag[];
  healthyPools: ProxmoxBackupStoragePool[];
  onClose?: () => void;
  policy?: BackupPolicy;
}) {
  const isNew = !policy;
  const action = isNew ? createBackupPolicyAction : updateBackupPolicyAction;

  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(action, initialBasicActionState);
  const [deleteState, deleteAction, isDeleting] = useActionState(
    deleteBackupPolicyAction,
    initialBasicActionState,
  );
  const [dupState, dupAction, isDuplicating] = useActionState(
    duplicateBackupPolicyAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(state, {
    errorTitle: isNew ? "Create policy failed" : "Update policy failed",
    successTitle: isNew ? "Policy created" : "Policy saved",
  });
  useActionFlashFeedback(deleteState, {
    errorTitle: "Delete failed",
    successTitle: "Policy deleted",
  });
  useActionFlashFeedback(dupState, {
    errorTitle: "Duplicate failed",
    successTitle: "Policy duplicated",
  });

  const [scope, setScope] = useState<"all" | "tagged">(policy?.scope ?? "all");
  const [selectedTags, setSelectedTags] = useState<string[]>(policy?.tagSlugs ?? []);

  function handleTagToggle(slug: string) {
    setSelectedTags((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );
  }

  // Close on successful create/delete
  const lastStatus = state.status;
  const lastDeleteStatus = deleteState.status;
  useEffect(() => {
    if ((isNew && lastStatus === "success" && onClose) ||
        (lastDeleteStatus === "success" && onClose)) {
      const timer = setTimeout(() => onClose(), 100);
      return () => clearTimeout(timer);
    }
  }, [isNew, lastStatus, lastDeleteStatus, onClose]);

  // Deduplicate storage pools by name
  const uniquePools = Array.from(
    new Map(healthyPools.map((p) => [p.storage, p])).values(),
  );

  return (
    <Card className="border-sky-900/40">
      <CardHeader className="border-b border-white/5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[15px]">
            {isNew ? "Create backup policy" : `Edit: ${policy.name}`}
          </CardTitle>
          {onClose && (
            <button
              className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              onClick={onClose}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-5">
        <Form action={formAction} className="space-y-5">
          <input name="siteSlug" type="hidden" value={siteSlug} />
          {!isNew && <input name="policyId" type="hidden" value={policy.id} />}

          {/* Basics */}
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-400">Policy name</span>
              <input
                className={fieldClassName}
                defaultValue={policy?.name ?? ""}
                name="name"
                placeholder="e.g. Production daily backups"
                required
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-400">Description</span>
              <input
                className={fieldClassName}
                defaultValue={policy?.description ?? ""}
                name="description"
                placeholder="Optional description"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              className="h-4 w-4 rounded border-white/10 bg-zinc-900 text-sky-400"
              defaultChecked={policy?.enabled ?? true}
              name="enabled"
              type="checkbox"
            />
            <span className="text-[13px] font-medium text-zinc-200">Enabled</span>
          </label>

          {/* Schedule & storage */}
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Schedule</span>
              <select
                className={fieldClassName}
                defaultValue={policy?.intervalMinutes ?? 1440}
                name="intervalMinutes"
              >
                {INTERVAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11px] text-zinc-500">
                How often this policy creates backups.
              </p>
            </label>

            <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Target storage</span>
              <select
                className={fieldClassName}
                defaultValue={policy?.storage ?? ""}
                name="storage"
                required
              >
                <option value="">Select storage pool...</option>
                {uniquePools.map((pool) => (
                  <option key={pool.storage} value={pool.storage}>
                    {pool.storage} ({pool.type})
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11px] text-zinc-500">
                Backup-capable storage pool for vzdump archives.
              </p>
            </label>
          </div>

          {/* Backup settings */}
          <div className="grid gap-4 lg:grid-cols-3">
            <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Compression</span>
              <select
                className={fieldClassName}
                defaultValue={policy?.compression ?? "zstd"}
                name="compression"
              >
                {COMPRESSION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Mode</span>
              <select
                className={fieldClassName}
                defaultValue={policy?.mode ?? "snapshot"}
                name="mode"
              >
                {MODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Retention (keep last)</span>
              <input
                className={fieldClassName}
                defaultValue={policy?.retentionCount ?? 0}
                min="0"
                name="retentionCount"
                type="number"
              />
              <p className="mt-1.5 text-[11px] text-zinc-500">
                0 = unlimited (no pruning).
              </p>
            </label>
          </div>

          {/* Off-site offload */}
          <div className="rounded-xl border border-white/5 bg-zinc-900/20 p-4 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                className="h-4 w-4 border-white/10 bg-zinc-900 text-sky-400"
                defaultChecked={policy?.offloadEnabled ?? false}
                name="offloadEnabled"
                type="checkbox"
              />
              <span className="text-[13px] font-medium text-zinc-200">
                Copy finished backups to the Storage Box
              </span>
            </label>
            <p className="text-[11px] text-zinc-500">
              After each successful backup the archive is copied off-site over rsync. Requires a
              connected Hetzner Storage Box on this site; without one the copy is skipped.
            </p>
            <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">
                Off-site retention (keep last)
              </span>
              <input
                className={fieldClassName}
                defaultValue={policy?.offloadRetentionCount ?? 0}
                min="0"
                name="offloadRetentionCount"
                type="number"
              />
              <p className="mt-1.5 text-[11px] text-zinc-500">
                Remote copies kept per guest. 0 = keep all.
              </p>
            </label>
          </div>

          {/* Scope */}
          <div className="rounded-xl border border-white/5 bg-zinc-900/20 p-4 space-y-3">
            <div>
              <p className="text-[13px] font-medium text-zinc-200">Scope</p>
              <p className="mt-1 text-[11px] text-zinc-500">
                Choose which workloads this policy backs up.
              </p>
            </div>

            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  checked={scope === "all"}
                  className="h-4 w-4 border-white/10 bg-zinc-900 text-sky-400"
                  name="scope"
                  onChange={() => setScope("all")}
                  type="radio"
                  value="all"
                />
                <span className="text-[13px] text-zinc-200">All workloads</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  checked={scope === "tagged"}
                  className="h-4 w-4 border-white/10 bg-zinc-900 text-sky-400"
                  name="scope"
                  onChange={() => setScope("tagged")}
                  type="radio"
                  value="tagged"
                />
                <span className="text-[13px] text-zinc-200">By tag</span>
              </label>
            </div>

            {scope === "tagged" && (
              <div>
                <input name="tagSlugs" type="hidden" value={selectedTags.join(",")} />
                {availableTags.length === 0 ? (
                  <p className="text-[12px] text-zinc-500">
                    No tags defined yet. Create tags in the Tags page first.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {availableTags.map((tag) => (
                      <button
                        className={`rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                          selectedTags.includes(tag.slug)
                            ? getTagSelectedPillClass(tag.color)
                            : getTagPillClass(tag.color)
                        }`}
                        key={tag.slug}
                        onClick={() => handleTagToggle(tag.slug)}
                        type="button"
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-4">
            <Button disabled={isPending} type="submit">
              <Save className="h-3.5 w-3.5" />
              {isPending ? "Saving..." : isNew ? "Create policy" : "Save policy"}
            </Button>

            {!isNew && (
              <>
                <Form action={dupAction}>
                  <input name="siteSlug" type="hidden" value={siteSlug} />
                  <input name="policyId" type="hidden" value={policy.id} />
                  <Button disabled={isDuplicating} type="submit" variant="secondary">
                    <Copy className="h-3.5 w-3.5" />
                    {isDuplicating ? "Duplicating..." : "Duplicate"}
                  </Button>
                </Form>

                <Form
                  action={deleteAction}
                  onSubmit={(e) => {
                    if (!confirm("Delete this backup policy? This cannot be undone.")) {
                      e.preventDefault();
                    }
                  }}
                >
                  <input name="siteSlug" type="hidden" value={siteSlug} />
                  <input name="policyId" type="hidden" value={policy.id} />
                  <Button disabled={isDeleting} type="submit" variant="secondary">
                    <Trash2 className="h-3.5 w-3.5" />
                    {isDeleting ? "Deleting..." : "Delete"}
                  </Button>
                </Form>
              </>
            )}

            {onClose && (
              <Button onClick={onClose} type="button" variant="secondary">
                Cancel
              </Button>
            )}
          </div>
        </Form>
      </CardContent>
    </Card>
  );
}
