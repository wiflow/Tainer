"use client";

import { useActionState, useState } from "react";
import {
  Camera,
  FileJson2,
  GitCompare,
  Trash2,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { deleteConfigSnapshotAction, takeConfigSnapshotAction } from "@/app/node-config-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type { NodeConfigSnapshot } from "@/lib/node-config-backup";

function extractSiteSlug(pathname: string): string {
  const match = pathname.match(/^\/sites\/([^/]+)/);
  return match?.[1] ?? "";
}

const fieldClassName =
  "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function SnapshotRow({
  isSelected,
  onSelect,
  siteSlug,
  snapshot,
}: {
  isSelected: boolean;
  onSelect: (id: string) => void;
  siteSlug: string;
  snapshot: NodeConfigSnapshot;
}) {
  const [deleteState, deleteAction, isDeleting] = useActionState(
    deleteConfigSnapshotAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(deleteState, {
    errorTitle: "Delete failed",
    successTitle: "Snapshot deleted",
  });

  return (
    <div className="flex items-center gap-3 border-b border-white/5/40 px-5 py-3 last:border-b-0 hover:bg-[#111113] transition-colors">
      <input
        checked={isSelected}
        className="h-4 w-4 rounded border-white/10 bg-zinc-900 text-sky-400"
        onChange={() => onSelect(snapshot.id)}
        type="checkbox"
      />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-zinc-200">{snapshot.label}</span>
          <Badge variant="neutral">{snapshot.nodeName}</Badge>
        </div>
        <p className="mt-0.5 text-[11px] text-zinc-600">
          {formatDate(snapshot.createdAt)} by {snapshot.createdBy}
        </p>
      </div>
      <Form
        action={deleteAction}
        onSubmit={(e) => {
          if (!confirm("Delete this config snapshot?")) {
            e.preventDefault();
          }
        }}
      >
        <input name="siteSlug" type="hidden" value={siteSlug} />
        <input name="snapshotId" type="hidden" value={snapshot.id} />
        <button
          className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          disabled={isDeleting}
          title="Delete snapshot"
          type="submit"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </Form>
    </div>
  );
}

export function NodeConfigSnapshots({
  nodeNames,
  snapshots,
}: {
  nodeNames: string[];
  snapshots: NodeConfigSnapshot[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const siteSlug = extractSiteSlug(pathname);

  const [takeState, takeAction, isTaking] = useActionState(
    takeConfigSnapshotAction,
    initialBasicActionState,
  );
  useActionFlashFeedback(takeState, {
    errorTitle: "Snapshot failed",
    successTitle: "Config snapshot saved",
  });

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  function handleSelect(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id]; // Keep last 2
      return [...prev, id];
    });
  }

  function handleCompare() {
    if (selectedIds.length !== 2) return;
    const url = `${pathname}?compare_a=${selectedIds[0]}&compare_b=${selectedIds[1]}`;
    router.push(url);
  }

  return (
    <>
      {/* Take snapshot form */}
      <Card>
        <CardHeader className="border-b border-white/5">
          <CardTitle>Take configuration snapshot</CardTitle>
          <CardDescription>
            Save the current node configuration for future comparison.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5">
          <Form action={takeAction} className="flex flex-wrap items-end gap-3">
            <input name="siteSlug" type="hidden" value={siteSlug} />
            <label className="block flex-1 min-w-[180px]">
              <span className="text-[12px] font-medium text-zinc-400">Node</span>
              <select className={fieldClassName} name="node" required>
                <option value="">Select node...</option>
                {nodeNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className="block flex-1 min-w-[200px]">
              <span className="text-[12px] font-medium text-zinc-400">Label (optional)</span>
              <input
                className={fieldClassName}
                name="label"
                placeholder="e.g. Before maintenance window"
              />
            </label>
            <Button className="mt-1.5" disabled={isTaking} type="submit">
              <Camera className="h-3.5 w-3.5" />
              {isTaking ? "Saving..." : "Take snapshot"}
            </Button>
          </Form>
        </CardContent>
      </Card>

      {/* Snapshot list */}
      <Card>
        <CardHeader className="border-b border-white/5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Saved snapshots</CardTitle>
              <CardDescription>
                Select two snapshots to compare configuration drift.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="neutral">{snapshots.length} snapshot{snapshots.length !== 1 ? "s" : ""}</Badge>
              {selectedIds.length === 2 && (
                <Button onClick={handleCompare} size="sm" variant="secondary">
                  <GitCompare className="h-3.5 w-3.5" />
                  Compare selected
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {snapshots.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-12 text-center">
              <FileJson2 className="h-8 w-8 text-zinc-600" />
              <p className="text-[13px] text-zinc-500">
                No config snapshots yet. Take your first snapshot above.
              </p>
            </div>
          ) : (
            snapshots.map((snap) => (
              <SnapshotRow
                isSelected={selectedIds.includes(snap.id)}
                key={snap.id}
                onSelect={handleSelect}
                siteSlug={siteSlug}
                snapshot={snap}
              />
            ))
          )}
        </CardContent>
      </Card>
    </>
  );
}
