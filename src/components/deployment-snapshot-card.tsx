"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  Camera,
  Clock,
  History,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";

import {
  createSnapshotAction,
  deleteSnapshotAction,
  rollbackSnapshotAction,
} from "@/app/snapshot-actions";
import { useActionTaskFeedback, useTaskToasts } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { initialActionState } from "@/lib/action-states";
import type { LiveSnapshot } from "@/lib/proxmox";

function formatDate(iso: string | null) {
  if (!iso) return "Unknown";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatAge(iso: string | null) {
  if (!iso) return "";
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const hours = ms / 3_600_000;
    if (hours < 1) return "< 1h ago";
    if (hours < 24) return `${Math.round(hours)}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "";
  }
}

export function DeploymentSnapshotCard({
  deploymentId,
  isAdmin,
  siteSlug,
  snapshots,
}: {
  deploymentId: string;
  isAdmin: boolean;
  siteSlug: string;
  snapshots: LiveSnapshot[];
}) {
  const router = useRouter();
  const { activeTaskUpids } = useTaskToasts();
  const handledCompletionsRef = useRef(new Set<string>());
  const [showForm, setShowForm] = useState(false);

  // Create snapshot
  const [createState, createAction, isCreatePending] = useActionState(
    createSnapshotAction,
    initialActionState,
  );
  useActionTaskFeedback(createState, {
    errorTitle: "Snapshot creation failed",
    successTitle: "Snapshot creation started",
  });

  // Delete snapshot
  const [deleteState, deleteAction, isDeletePending] = useActionState(
    deleteSnapshotAction,
    initialActionState,
  );
  useActionTaskFeedback(deleteState, {
    errorTitle: "Snapshot deletion failed",
    successTitle: "Snapshot deletion started",
  });

  // Rollback snapshot
  const [rollbackState, rollbackAction, isRollbackPending] = useActionState(
    rollbackSnapshotAction,
    initialActionState,
  );
  useActionTaskFeedback(rollbackState, {
    errorTitle: "Snapshot rollback failed",
    successTitle: "Rollback started",
  });

  // Refresh on task completion
  const latestUpid = [createState, deleteState, rollbackState]
    .filter((s) => s.status === "success" && s.task?.upid)
    .map((s) => s.task!.upid)
    .at(-1) ?? null;

  const isTaskRunning = latestUpid ? activeTaskUpids.has(latestUpid) : false;

  useEffect(() => {
    if (!latestUpid || isTaskRunning) return;
    if (handledCompletionsRef.current.has(latestUpid)) return;
    handledCompletionsRef.current.add(latestUpid);
    router.refresh();
    const t = window.setTimeout(() => router.refresh(), 2000);
    return () => window.clearTimeout(t);
  }, [latestUpid, isTaskRunning, router]);

  const anyPending = isCreatePending || isDeletePending || isRollbackPending;

  return (
    <Card className="overflow-hidden rounded-2xl">
      <CardHeader className="border-b border-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-zinc-500" />
            <CardTitle>Snapshots</CardTitle>
            <Badge variant="neutral">{snapshots.length}</Badge>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowForm(!showForm)}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Create form */}
        {showForm && (
          <div className="border-b border-white/5 px-5 py-4">
            <Form action={createAction}>
              <input type="hidden" name="siteSlug" value={siteSlug} />
              <input type="hidden" name="deploymentId" value={deploymentId} />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">
                    Name
                  </label>
                  <Input
                    name="snapname"
                    placeholder="e.g. before-upgrade"
                    required
                    pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}"
                    title="1-40 alphanumeric characters, hyphens, or underscores"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">
                    Description (optional)
                  </label>
                  <Input
                    name="description"
                    placeholder="Optional note"
                  />
                </div>
                <Button type="submit" size="sm" disabled={isCreatePending}>
                  {isCreatePending ? "Creating…" : "Create snapshot"}
                </Button>
              </div>
            </Form>
          </div>
        )}

        {/* Snapshot list */}
        {snapshots.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <Camera className="mx-auto h-8 w-8 text-zinc-700" />
            <p className="mt-3 text-[13px] text-zinc-500">
              No snapshots yet. Create one to capture the current state.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {snapshots.map((snap) => (
              <div
                key={snap.name}
                className="flex items-center justify-between gap-4 px-5 py-3.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <History className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    <p className="truncate text-[13px] font-medium text-zinc-200">
                      {snap.name}
                    </p>
                    {snap.hasVmState && (
                      <Badge variant="info">RAM</Badge>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-zinc-500">
                    {snap.createdAt && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDate(snap.createdAt)}
                        {formatAge(snap.createdAt) && (
                          <span className="text-zinc-600">({formatAge(snap.createdAt)})</span>
                        )}
                      </span>
                    )}
                    {snap.description && (
                      <span className="truncate">{snap.description}</span>
                    )}
                  </div>
                </div>

                {isAdmin && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Form action={rollbackAction}>
                      <input type="hidden" name="siteSlug" value={siteSlug} />
                      <input type="hidden" name="deploymentId" value={deploymentId} />
                      <input type="hidden" name="snapname" value={snap.name} />
                      <Button
                        type="submit"
                        size="sm"
                        variant="ghost"
                        disabled={anyPending}
                        title={`Rollback to "${snap.name}"`}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    </Form>
                    <Form action={deleteAction}>
                      <input type="hidden" name="siteSlug" value={siteSlug} />
                      <input type="hidden" name="deploymentId" value={deploymentId} />
                      <input type="hidden" name="snapname" value={snap.name} />
                      <Button
                        type="submit"
                        size="sm"
                        variant="ghost"
                        disabled={anyPending}
                        className="text-zinc-500 hover:text-rose-400"
                        title={`Delete "${snap.name}"`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </Form>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
