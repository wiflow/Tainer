"use client";

import { useActionState, useMemo, useState } from "react";
import {
  ArchiveRestore,
  Cloud,
  CloudUpload,
  HardDriveDownload,
  KeyRound,
  Link2,
  Link2Off,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";

import {
  connectStorageBoxAction,
  disconnectStorageBoxAction,
  registerCifsStorageAction,
  retrieveArchiveAction,
  testStorageBoxAction,
  unregisterCifsStorageAction,
} from "@/app/storage-box-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { initialActionState } from "@/lib/action-states";
import type { OffloadLogEntry, StorageBoxSummary } from "@/lib/storage-box";

function formatTime(iso: string | null) {
  if (!iso) return "never";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function StorageBoxCard({
  dirStorages,
  nodes,
  offloadLog,
  showRetrieve = true,
  siteSlug,
  summary,
}: {
  dirStorages: string[];
  nodes: string[];
  offloadLog: OffloadLogEntry[];
  showRetrieve?: boolean;
  siteSlug: string;
  summary: StorageBoxSummary;
}) {
  const [connectState, connectAction, isConnecting] = useActionState(
    connectStorageBoxAction,
    initialActionState,
  );
  useActionFlashFeedback(connectState, {
    errorTitle: "Storage Box connection failed",
    successTitle: "Storage Box connected",
  });

  const [testState, testAction, isTesting] = useActionState(
    testStorageBoxAction,
    initialActionState,
  );
  useActionFlashFeedback(testState, {
    errorTitle: "Connection test failed",
    successTitle: "Storage Box reachable",
  });

  const [disconnectState, disconnectAction, isDisconnecting] = useActionState(
    disconnectStorageBoxAction,
    initialActionState,
  );
  useActionFlashFeedback(disconnectState, {
    errorTitle: "Disconnect failed",
    successTitle: "Storage Box disconnected",
  });

  const [registerState, registerAction, isRegistering] = useActionState(
    registerCifsStorageAction,
    initialActionState,
  );
  useActionFlashFeedback(registerState, {
    errorTitle: "CIFS registration failed",
    successTitle: "Proxmox storage registered",
  });

  const [unregisterState, unregisterAction, isUnregistering] = useActionState(
    unregisterCifsStorageAction,
    initialActionState,
  );
  useActionFlashFeedback(unregisterState, {
    errorTitle: "Removal failed",
    successTitle: "Proxmox storage removed",
  });

  const [retrieveState, retrieveAction, isRetrieving] = useActionState(
    retrieveArchiveAction,
    initialActionState,
  );
  useActionFlashFeedback(retrieveState, {
    errorTitle: "Retrieve failed",
    successTitle: "Archive retrieved",
  });

  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const retrievableArchives = useMemo(() => {
    const seen = new Set<string>();
    return offloadLog.filter((entry) => {
      if (entry.kind !== "offload" || entry.status !== "success" || !entry.archive) return false;
      if (seen.has(entry.archive)) return false;
      seen.add(entry.archive);
      return true;
    });
  }, [offloadLog]);

  const [selectedArchive, setSelectedArchive] = useState("");
  const selectedEntry = retrievableArchives.find((e) => e.archive === selectedArchive) ?? null;

  if (!summary.configured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[15px]">
            <Cloud className="h-4 w-4" />
            Off-site backup — Hetzner Storage Box
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[12.5px] text-zinc-400 mb-4">
            Connect a Hetzner Storage Box to copy finished backups off-site. Tainer verifies the
            credentials, installs a dedicated SSH transfer key, and can also register the box as
            native Proxmox storage. Sub-account credentials work and are recommended.
          </p>
          <form action={connectAction} className="grid gap-3 sm:grid-cols-2">
            <input name="siteSlug" type="hidden" value={siteSlug} />
            <div>
              <label className="text-[12px] font-medium text-zinc-300">Host</label>
              <Input
                className="mt-1"
                name="host"
                placeholder="u123456.your-storagebox.de"
                required
              />
            </div>
            <div>
              <label className="text-[12px] font-medium text-zinc-300">Username</label>
              <Input className="mt-1" name="username" placeholder="u123456 or u123456-sub1" required />
            </div>
            <div>
              <label className="text-[12px] font-medium text-zinc-300">Password</label>
              <Input autoComplete="off" className="mt-1" name="password" required type="password" />
            </div>
            <div>
              <label className="text-[12px] font-medium text-zinc-300">Base directory</label>
              <Input className="mt-1" defaultValue="tainer-offsite" name="basePath" />
            </div>
            <div>
              <label className="text-[12px] font-medium text-zinc-300">
                Bandwidth limit (KiB/s, 0 = unlimited)
              </label>
              <Input className="mt-1" defaultValue="0" min="0" name="bandwidthLimitKbps" type="number" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer sm:col-span-2">
              <input
                className="h-4 w-4 border-white/10 bg-zinc-900 text-sky-400"
                name="encryptEnabled"
                type="checkbox"
              />
              <span className="text-[12.5px] text-zinc-200">
                Encrypt archives before upload (AES-256)
              </span>
              <span className="text-[11px] text-zinc-500">
                — Hetzner never sees plaintext; failed transfers restart from zero instead of resuming.
              </span>
            </label>
            <div className="sm:col-span-2">
              <Button disabled={isConnecting} size="sm" type="submit">
                {isConnecting ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Link2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Connect Storage Box
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-[15px]">
          <Cloud className="h-4 w-4" />
          Off-site backup — {summary.host}
          {summary.keyInstalled ? (
            <Badge variant="success">
              <KeyRound className="mr-1 h-3 w-3" />
              key auth
            </Badge>
          ) : (
            <Badge variant="warning">password auth</Badge>
          )}
          {summary.encryptEnabled && <Badge variant="info">encrypted</Badge>}
          {summary.lastTestOk === false && <Badge variant="destructive">unreachable</Badge>}
          {summary.currentTransfer ? (
            <Badge variant="review">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              transferring {summary.currentTransfer}
            </Badge>
          ) : summary.queueDepth > 0 ? (
            <Badge variant="review">{summary.queueDepth} queued</Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500">User</span>
            <span className="text-zinc-200">{summary.username}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500">Base directory</span>
            <span className="text-zinc-200">{summary.basePath}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500">Last check</span>
            <span className="text-zinc-200">{formatTime(summary.lastTestedAt)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500">Status</span>
            <span className={summary.lastTestOk === false ? "text-rose-300" : "text-zinc-200"}>
              {summary.lastTestMessage || "—"}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500">Bandwidth limit</span>
            <span className="text-zinc-200 tabular-nums">
              {summary.bandwidthLimitKbps > 0 ? `${summary.bandwidthLimitKbps} KiB/s` : "unlimited"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form action={testAction}>
            <input name="siteSlug" type="hidden" value={siteSlug} />
            <Button disabled={isTesting} size="sm" type="submit" variant="outline">
              {isTesting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Test connection
            </Button>
          </form>

          {confirmDisconnect ? (
            <form action={disconnectAction} className="flex items-center gap-2">
              <input name="siteSlug" type="hidden" value={siteSlug} />
              <span className="text-[12px] text-zinc-400">Disconnect? Remote data stays.</span>
              <Button disabled={isDisconnecting} size="sm" type="submit" variant="destructive">
                {isDisconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm"}
              </Button>
              <Button
                onClick={() => setConfirmDisconnect(false)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            </form>
          ) : (
            <Button
              onClick={() => setConfirmDisconnect(true)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Link2Off className="mr-1.5 h-3.5 w-3.5" />
              Disconnect
            </Button>
          )}
        </div>

        <div className="rounded-lg border border-zinc-800 p-3">
          <p className="text-[12.5px] font-medium text-zinc-200 flex items-center gap-1.5">
            <HardDriveDownload className="h-3.5 w-3.5" />
            Native Proxmox storage (CIFS)
          </p>
          {summary.cifsStorageId ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="text-[12px] text-zinc-400">
                Mounted cluster-wide as <span className="text-zinc-200">{summary.cifsStorageId}</span> —
                backup policies can target it directly.
              </p>
              <form action={unregisterAction}>
                <input name="siteSlug" type="hidden" value={siteSlug} />
                <Button disabled={isUnregistering} size="sm" type="submit" variant="ghost">
                  {isUnregistering ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Remove
                </Button>
              </form>
            </div>
          ) : (
            <form action={registerAction} className="mt-2 flex flex-wrap items-end gap-2">
              <input name="siteSlug" type="hidden" value={siteSlug} />
              <div>
                <label className="text-[11px] text-zinc-500">Storage id</label>
                <Input className="mt-0.5 h-8 w-36" defaultValue="storagebox" name="storageId" />
              </div>
              <div>
                <label className="text-[11px] text-zinc-500">Share</label>
                <Input className="mt-0.5 h-8 w-28" defaultValue="backup" name="share" />
              </div>
              <Button disabled={isRegistering} size="sm" type="submit" variant="outline">
                {isRegistering ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="mr-1.5 h-3.5 w-3.5" />
                )}
                Register storage
              </Button>
              <p className="w-full text-[11px] text-zinc-500">
                Mounts the box on every node so vzdump can write to it directly. Writes then run
                over the WAN — the offload toggle on each policy is the local-first alternative.
              </p>
            </form>
          )}
        </div>

        {showRetrieve && retrievableArchives.length > 0 && (
          <div className="rounded-lg border border-zinc-800 p-3">
            <p className="text-[12.5px] font-medium text-zinc-200 flex items-center gap-1.5">
              <ArchiveRestore className="h-3.5 w-3.5" />
              Retrieve an offloaded archive
            </p>
            <form action={retrieveAction} className="mt-2 flex flex-wrap items-end gap-2">
              <input name="siteSlug" type="hidden" value={siteSlug} />
              <input name="vmid" type="hidden" value={selectedEntry?.vmid ?? ""} />
              <div>
                <label className="text-[11px] text-zinc-500">Archive</label>
                <select
                  className="mt-0.5 block h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-[12px] text-zinc-200"
                  name="archiveName"
                  onChange={(e) => setSelectedArchive(e.target.value)}
                  required
                  value={selectedArchive}
                >
                  <option value="">Select archive…</option>
                  {retrievableArchives.map((entry) => (
                    <option key={entry.id} value={entry.archive}>
                      {entry.archive}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-zinc-500">Node</label>
                <select
                  className="mt-0.5 block h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-[12px] text-zinc-200"
                  name="node"
                  required
                >
                  {nodes.map((node) => (
                    <option key={node} value={node}>
                      {node}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-zinc-500">Target storage</label>
                <select
                  className="mt-0.5 block h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-[12px] text-zinc-200"
                  name="targetStorage"
                  required
                >
                  {dirStorages.map((storage) => (
                    <option key={storage} value={storage}>
                      {storage}
                    </option>
                  ))}
                </select>
              </div>
              <Button disabled={isRetrieving || !selectedEntry} size="sm" type="submit" variant="outline">
                {isRetrieving ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" />
                )}
                Retrieve
              </Button>
            </form>
          </div>
        )}

        {offloadLog.length > 0 && (
          <div>
            <p className="text-[12.5px] font-medium text-zinc-200 mb-1.5">Off-site activity</p>
            <ul className="space-y-1">
              {offloadLog.slice(0, 8).map((entry) => (
                <li className="flex items-center gap-2 text-[12px]" key={entry.id}>
                  <Badge variant={entry.status === "success" ? "success" : "destructive"}>
                    {entry.kind}
                  </Badge>
                  <span className="truncate text-zinc-300">{entry.archive || `VMID ${entry.vmid ?? "?"}`}</span>
                  <span className="truncate text-zinc-500">{entry.message}</span>
                  <span className="ml-auto shrink-0 text-zinc-600">{formatTime(entry.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
