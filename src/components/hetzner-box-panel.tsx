"use client";

import { useActionState } from "react";
import {
  Camera,
  Globe,
  KeyRound,
  Loader2,
  Network,
  Plug,
  Trash2,
  Unplug,
} from "lucide-react";

import {
  clearHetznerTokenAction,
  createHetznerSnapshotAction,
  deleteHetznerSnapshotAction,
  setHetznerTokenAction,
  toggleHetznerServiceAction,
} from "@/app/storage-box-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { initialActionState } from "@/lib/action-states";
import type { HetznerSnapshot, HetznerStorageBox } from "@/lib/hetzner-storage-api";
import { formatBytes } from "@/lib/utils";

const SERVICES: { key: string; label: string }[] = [
  { key: "ssh_enabled", label: "SSH / SFTP / rsync" },
  { key: "samba_enabled", label: "Samba / CIFS" },
  { key: "webdav_enabled", label: "WebDAV" },
  { key: "reachable_externally", label: "External reachability" },
];

export function HetznerBoxPanel({
  box,
  error,
  hetznerConnected,
  siteSlug,
  snapshots,
}: {
  box: HetznerStorageBox | null;
  error: string | null;
  hetznerConnected: boolean;
  siteSlug: string;
  snapshots: HetznerSnapshot[];
}) {
  const [tokenState, tokenAction, isSavingToken] = useActionState(
    setHetznerTokenAction,
    initialActionState,
  );
  useActionFlashFeedback(tokenState, {
    errorTitle: "Hetzner API connection failed",
    successTitle: "Hetzner API connected",
  });

  const [clearState, clearAction, isClearing] = useActionState(
    clearHetznerTokenAction,
    initialActionState,
  );
  useActionFlashFeedback(clearState, {
    errorTitle: "Removal failed",
    successTitle: "Hetzner API disconnected",
  });

  const [toggleState, toggleAction, isToggling] = useActionState(
    toggleHetznerServiceAction,
    initialActionState,
  );
  useActionFlashFeedback(toggleState, {
    errorTitle: "Service update failed",
    successTitle: "Service updated",
  });

  const [snapCreateState, snapCreateAction, isSnapCreating] = useActionState(
    createHetznerSnapshotAction,
    initialActionState,
  );
  useActionFlashFeedback(snapCreateState, {
    errorTitle: "Snapshot failed",
    successTitle: "Snapshot started",
  });

  const [snapDeleteState, snapDeleteAction, isSnapDeleting] = useActionState(
    deleteHetznerSnapshotAction,
    initialActionState,
  );
  useActionFlashFeedback(snapDeleteState, {
    errorTitle: "Snapshot deletion failed",
    successTitle: "Snapshot deleted",
  });

  if (!hetznerConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[15px]">
            <Plug className="h-4 w-4" />
            Hetzner Console API
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[12.5px] text-zinc-400 mb-3">
            Add a Hetzner Console API token to manage the box itself from here: service toggles
            (Samba, WebDAV, external access), box-level snapshots, and live usage. Create the
            token in the Hetzner Console under the project that owns the Storage Box.
          </p>
          <form action={tokenAction} className="flex flex-wrap items-end gap-2">
            <input name="siteSlug" type="hidden" value={siteSlug} />
            <div className="min-w-64 flex-1">
              <label className="text-[11px] text-zinc-500">API token</label>
              <Input autoComplete="off" className="mt-0.5" name="token" required type="password" />
            </div>
            <Button disabled={isSavingToken} size="sm" type="submit">
              {isSavingToken ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <KeyRound className="mr-1.5 h-3.5 w-3.5" />
              )}
              Connect API
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-[15px]">
          <Globe className="h-4 w-4" />
          Box management
          {box ? (
            <Badge variant={box.status === "active" ? "success" : "warning"}>{box.status}</Badge>
          ) : (
            <Badge variant="destructive">API error</Badge>
          )}
          <form action={clearAction} className="ml-auto">
            <input name="siteSlug" type="hidden" value={siteSlug} />
            <Button disabled={isClearing} size="sm" type="submit" variant="ghost">
              {isClearing ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Unplug className="mr-1.5 h-3.5 w-3.5" />
              )}
              Disconnect API
            </Button>
          </form>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {!box && (
          <p className="text-[12.5px] text-rose-300">
            {error || "Could not load the Storage Box from the Hetzner API."}
          </p>
        )}

        {box && (
          <>
            <div className="grid gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">Box</span>
                <span className="text-zinc-200">
                  {box.name} ({box.storageBoxType})
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">Location</span>
                <span className="text-zinc-200">{box.location || "—"}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">Used</span>
                <span className="text-zinc-200 tabular-nums">
                  {box.usedSize != null ? formatBytes(box.usedSize) : "—"}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">Snapshot usage</span>
                <span className="text-zinc-200 tabular-nums">
                  {box.usedBySnapshots != null ? formatBytes(box.usedBySnapshots) : "—"}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-medium text-zinc-200">
                <Network className="h-3.5 w-3.5" />
                Services
              </p>
              <div className="flex flex-wrap gap-2">
                {SERVICES.map((service) => {
                  const enabled = Boolean(
                    box.accessSettings[service.key as keyof typeof box.accessSettings],
                  );
                  return (
                    <form action={toggleAction} key={service.key}>
                      <input name="siteSlug" type="hidden" value={siteSlug} />
                      <input name="service" type="hidden" value={service.key} />
                      <input name="enabled" type="hidden" value={enabled ? "false" : "true"} />
                      <Button
                        disabled={isToggling}
                        size="sm"
                        type="submit"
                        variant={enabled ? "secondary" : "outline"}
                      >
                        <span
                          className={`mr-1.5 inline-block h-2 w-2 rounded-full ${enabled ? "bg-emerald-400" : "bg-zinc-600"}`}
                        />
                        {service.label}
                      </Button>
                    </form>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-zinc-500">
                Click to toggle. SSH cannot be disabled from here — offload transfers depend on it.
              </p>
            </div>

            <div className="rounded-lg border border-zinc-800 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-zinc-200">
                  <Camera className="h-3.5 w-3.5" />
                  Box snapshots
                </p>
                <form action={snapCreateAction} className="ml-auto flex items-center gap-2">
                  <input name="siteSlug" type="hidden" value={siteSlug} />
                  <Input
                    className="h-8 w-44"
                    name="description"
                    placeholder="Description (optional)"
                  />
                  <Button disabled={isSnapCreating} size="sm" type="submit" variant="outline">
                    {isSnapCreating ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Camera className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Snapshot now
                  </Button>
                </form>
              </div>
              {snapshots.length === 0 ? (
                <p className="text-[12px] text-zinc-500">
                  No snapshots yet. Snapshots capture the whole box server-side — cheap insurance
                  against accidental deletion of offloaded archives.
                </p>
              ) : (
                <ul className="space-y-1">
                  {snapshots.map((snapshot) => (
                    <li className="flex items-center gap-2 text-[12px]" key={snapshot.id}>
                      <span className="text-zinc-300">{snapshot.name || `#${snapshot.id}`}</span>
                      {snapshot.description && (
                        <span className="truncate text-zinc-500">{snapshot.description}</span>
                      )}
                      <span className="ml-auto shrink-0 tabular-nums text-zinc-500">
                        {snapshot.size != null ? formatBytes(snapshot.size) : ""}
                      </span>
                      <span className="shrink-0 text-zinc-600">
                        {snapshot.createdAt ? new Date(snapshot.createdAt).toLocaleString() : ""}
                      </span>
                      <form action={snapDeleteAction}>
                        <input name="siteSlug" type="hidden" value={siteSlug} />
                        <input name="snapshotId" type="hidden" value={snapshot.id} />
                        <Button
                          disabled={isSnapDeleting}
                          size="sm"
                          type="submit"
                          variant="ghost"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
