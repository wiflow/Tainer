"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";

import { deleteBackupAction } from "@/app/backup-actions";
import { BackupRestoreButton } from "@/components/backup-restore-button";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { initialActionState } from "@/lib/action-states";
import type { ProxmoxBackupArchive } from "@/lib/proxmox";
import { useSiteBasePath } from "@/lib/use-site-path";
import { formatBytes } from "@/lib/utils";

function formatDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function DeleteButton({
  archive,
}: {
  archive: ProxmoxBackupArchive;
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    deleteBackupAction,
    initialActionState,
  );

  useActionTaskFeedback(state, {
    errorTitle: "Delete failed",
    successTitle: "Backup deleted",
  });

  return (
    <Form action={formAction}>
      <input name="siteSlug" type="hidden" value={siteSlug} />
      <input name="volid" type="hidden" value={archive.volid} />
      <input name="node" type="hidden" value={archive.node} />
      <input name="storage" type="hidden" value={archive.storage} />
      <Button disabled={isPending} size="sm" type="submit" variant="ghost">
        <Trash2 className="h-3 w-3" />
      </Button>
    </Form>
  );
}

export function BackupListTable({
  archives,
  defaultNode,
  defaultStorage,
  isAdmin,
}: {
  archives: ProxmoxBackupArchive[];
  defaultNode: string;
  defaultStorage: string;
  isAdmin: boolean;
}) {
  if (archives.length === 0) {
    return (
      <div className="px-5 py-4 text-[13px] text-zinc-500">
        No backup archives found.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-[#111113]">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-white/5 bg-black/40">
            <th className="px-4 py-3 font-medium text-zinc-400 w-10">VMID</th>
            <th className="px-4 py-3 font-medium text-zinc-400">Date</th>
            <th className="px-4 py-3 font-medium text-zinc-400">Storage</th>
            <th className="px-4 py-3 font-medium text-zinc-400">Size</th>
            <th className="px-4 py-3 font-medium text-zinc-400">Format</th>
            <th className="px-4 py-3 font-medium text-zinc-400">Notes</th>
            {isAdmin && <th className="px-4 py-3 font-medium text-zinc-400 text-right w-10">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {archives.map((archive) => (
            <tr key={archive.volid} className="hover:bg-white/5 transition-colors group">
              <td className="px-4 py-3">
                <Badge variant="neutral">{archive.vmid}</Badge>
              </td>
              <td className="px-4 py-3 text-zinc-400">
                {formatDate(archive.ctimeIso)}
              </td>
              <td className="px-4 py-3 text-zinc-400">{archive.storage}</td>
              <td className="px-4 py-3 text-zinc-400">{formatBytes(archive.sizeBytes)}</td>
              <td className="px-4 py-3 text-zinc-400">{archive.format}</td>
              <td className="max-w-[200px] truncate px-4 py-3 text-zinc-500">
                {archive.notes || "—"}
              </td>
              {isAdmin && (
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1 relative">
                    <BackupRestoreButton
                      archive={archive}
                      label="Restore"
                      node={defaultNode || archive.node}
                      storage={defaultStorage}
                    />
                    <DeleteButton archive={archive} />
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
