"use client";

import { useActionState, useState } from "react";
import { Copy, Replace, RotateCcw, X } from "lucide-react";

import { restoreBackupAction } from "@/app/backup-actions";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { initialActionState } from "@/lib/action-states";
import type { ProxmoxBackupArchive } from "@/lib/proxmox";
import { useSiteBasePath } from "@/lib/use-site-path";

type BackupRestoreButtonProps = {
  archive: Pick<ProxmoxBackupArchive, "volid">;
  className?: string;
  currentVmid?: number;
  label?: string;
  node: string;
  size?: ButtonProps["size"];
  storage: string;
  variant?: ButtonProps["variant"];
};

export function BackupRestoreButton({
  archive,
  className,
  currentVmid,
  label = "Restore",
  node,
  size = "sm",
  storage,
  variant = "ghost",
}: BackupRestoreButtonProps) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    restoreBackupAction,
    initialActionState,
  );
  const [choosing, setChoosing] = useState(false);

  useActionTaskFeedback(state, {
    errorTitle: "Restore failed",
    successTitle: "Restore started",
  });

  const isDisabled = isPending || !node || !storage;

  // No deployment context — simple single-action button (e.g. global backups page).
  if (currentVmid == null) {
    return (
      <Form action={formAction}>
        <input name="siteSlug" type="hidden" value={siteSlug} />
        <input name="volid" type="hidden" value={archive.volid} />
        <input name="node" type="hidden" value={node} />
        <input name="storage" type="hidden" value={storage} />
        <Button
          className={className}
          disabled={isDisabled}
          size={size}
          title={storage ? undefined : "Target restore storage is unavailable"}
          type="submit"
          variant={variant}
        >
          <RotateCcw className="h-3 w-3" />
          {isPending ? "Restoring..." : label}
        </Button>
      </Form>
    );
  }

  // Deployment context — show a choice between new container and replace.
  if (!choosing) {
    return (
      <Button
        className={className}
        disabled={isDisabled}
        onClick={() => setChoosing(true)}
        size={size}
        type="button"
        variant={variant}
      >
        <RotateCcw className="h-3 w-3" />
        {label}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Form action={(fd) => { setChoosing(false); formAction(fd); }}>
        <input name="siteSlug" type="hidden" value={siteSlug} />
        <input name="volid" type="hidden" value={archive.volid} />
        <input name="node" type="hidden" value={node} />
        <input name="storage" type="hidden" value={storage} />
        <Button disabled={isDisabled} size="sm" type="submit" variant="ghost">
          <Copy className="h-3 w-3" />
          New
        </Button>
      </Form>
      <Form action={(fd) => { setChoosing(false); formAction(fd); }}>
        <input name="siteSlug" type="hidden" value={siteSlug} />
        <input name="volid" type="hidden" value={archive.volid} />
        <input name="node" type="hidden" value={node} />
        <input name="storage" type="hidden" value={storage} />
        <input name="targetVmid" type="hidden" value={String(currentVmid)} />
        <input name="replace" type="hidden" value="1" />
        <Button disabled={isDisabled} size="sm" type="submit" variant="danger">
          <Replace className="h-3 w-3" />
          Replace
        </Button>
      </Form>
      <button
        className="p-1 text-zinc-500 transition-colors hover:text-zinc-300"
        onClick={() => setChoosing(false)}
        type="button"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
