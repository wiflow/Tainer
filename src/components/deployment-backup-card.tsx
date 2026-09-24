"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  AlertTriangle,
  Calendar,
  Play,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { triggerBackupAction } from "@/app/backup-actions";
import { BackupRestoreButton } from "@/components/backup-restore-button";
import { useActionTaskFeedback, useTaskToasts } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialActionState } from "@/lib/action-states";
import type { ProxmoxDeploymentBackupInfo } from "@/lib/proxmox";
import { useSiteBasePath } from "@/lib/use-site-path";
import { formatBytes } from "@/lib/utils";

function ProtectionIcon({ status }: { status: string }) {
  if (status === "protected") {
    return <ShieldCheck className="h-4 w-4 text-emerald-400" />;
  }

  if (status === "warning") {
    return <ShieldAlert className="h-4 w-4 text-amber-400" />;
  }

  if (status === "unprotected") {
    return <ShieldX className="h-4 w-4 text-rose-400" />;
  }

  return <Shield className="h-4 w-4 text-zinc-500" />;
}

function protectionBadge(status: string) {
  if (status === "protected") {
    return <Badge variant="success">Protected</Badge>;
  }

  if (status === "warning") {
    return <Badge variant="review">Warning</Badge>;
  }

  return <Badge variant="destructive">Unprotected</Badge>;
}

function formatDate(iso: string | null) {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatAge(hours: number | null) {
  if (hours == null) return "No backups";
  if (hours < 1) return "< 1 hour ago";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${Math.round(hours % 24)}h ago`;
}

export function DeploymentBackupCard({
  backupInfo,
  defaultBackupStorage,
  deploymentId,
  deploymentType,
  isAdmin,
  restoreTargetNode,
  restoreTargetStorage,
  vmid,
}: {
  backupInfo: ProxmoxDeploymentBackupInfo | null;
  defaultBackupStorage: string;
  deploymentId: string;
  deploymentType: "lxc" | "qemu";
  isAdmin: boolean;
  restoreTargetNode: string;
  restoreTargetStorage: string;
  vmid: number;
}) {
  const router = useRouter();
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const { activeTaskUpids } = useTaskToasts();
  const handledCompletionsRef = useRef(new Set<string>());
  const [state, formAction, isPending] = useActionState(
    triggerBackupAction,
    initialActionState,
  );

  useActionTaskFeedback(state, {
    errorTitle: "Backup failed to start",
    successTitle: "Backup started",
  });

  const currentUpid =
    state.status === "success"
      ? state.task?.upid ?? null
      : null;
  const isTaskRunning = currentUpid ? activeTaskUpids.has(currentUpid) : false;

  useEffect(() => {
    if (!currentUpid || isPending || isTaskRunning) {
      return;
    }

    if (handledCompletionsRef.current.has(currentUpid)) {
      return;
    }

    handledCompletionsRef.current.add(currentUpid);

    router.refresh();

    const shortDelayRefresh = window.setTimeout(() => {
      router.refresh();
    }, 1500);

    const longerDelayRefresh = window.setTimeout(() => {
      router.refresh();
    }, 5000);

    return () => {
      window.clearTimeout(shortDelayRefresh);
      window.clearTimeout(longerDelayRefresh);
    };
  }, [currentUpid, isPending, isTaskRunning, router]);

  if (!backupInfo) {
    return (
      <Card className="overflow-hidden rounded-2xl">
        <CardHeader className="border-b border-white/5">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-zinc-500" />
            <div>
              <CardTitle>Backups</CardTitle>
              <CardDescription>
                No backup storage available.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5">
          <p className="text-[13px] text-zinc-500">
            Configure a CIFS/SMB backup storage in Proxmox to enable native backups.
            Veeam protects the SMB share downstream.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { coverage, archives } = backupInfo;
  const workloadLabel = deploymentType === "qemu" ? "VM" : "CT";

  return (
    <Card className="overflow-hidden rounded-2xl">
      <CardHeader className="border-b border-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ProtectionIcon status={coverage.protectionStatus} />
            <div>
              <CardTitle>Backups</CardTitle>
            </div>
          </div>
          {protectionBadge(coverage.protectionStatus)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/5 bg-black/40 p-3">
            <p className="text-[11px] text-zinc-500">Last backup</p>
            <p className="mt-1 text-[13px] font-medium text-zinc-100">
              {formatAge(coverage.lastBackupAge)}
            </p>
          </div>
          <div className="rounded-xl border border-white/5 bg-black/40 p-3">
            <p className="text-[11px] text-zinc-500">Archives</p>
            <p className="mt-1 text-[13px] font-medium text-zinc-100">
              {coverage.totalArchives}
            </p>
          </div>
          <div className="rounded-xl border border-white/5 bg-black/40 p-3">
            <p className="text-[11px] text-zinc-500">Protection</p>
            <p className="mt-1 text-[13px] font-medium text-zinc-100">
              {coverage.protectionStatus === "protected"
                ? "Protected"
                : coverage.protectionStatus === "warning"
                  ? "At risk"
                  : "Unprotected"}
            </p>
          </div>
        </div>

        {coverage.protectionReasons.length > 0 && (
          <div className="rounded-lg border border-white/5 bg-black/20 p-3">
            <p className="mb-2 text-[12px] font-medium text-zinc-400">Protection notes</p>
            <div className="space-y-1.5">
              {coverage.protectionReasons.map((reason, index) => (
                <div key={index} className="flex items-start gap-2">
                  <AlertTriangle
                    className={`mt-0.5 h-3 w-3 shrink-0 ${
                      reason.level === "error" ? "text-rose-400" : "text-amber-400"
                    }`}
                  />
                  <p className="text-[12px] text-zinc-400">{reason.message}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {isAdmin && (
          <div className="rounded-lg border border-white/5 bg-black/20 p-3">
            <p className="text-[12px] text-zinc-400">
              {restoreTargetStorage
                ? `Restore any archive below as a new ${workloadLabel} or replace the current one on ${restoreTargetNode} using ${restoreTargetStorage}.`
                : "Set a default rootfs storage to enable restores from this page."}
            </p>
          </div>
        )}

        {archives.length > 0 && (
          <div>
            <p className="mb-2 text-[12px] font-medium text-zinc-400">
              Recent backup archives
            </p>
            <div className="divide-y divide-zinc-800/60 rounded-lg border border-white/5">
              {archives.slice(0, 8).map((archive, index) => (
                <div
                  key={archive.volid}
                  className={`flex items-center justify-between px-4 py-2 ${index % 2 === 1 ? "bg-[#111113]" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-zinc-500" />
                    <span className="text-[12px] text-zinc-300">
                      {formatDate(archive.ctimeIso)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-zinc-500">
                      {archive.storage} · {formatBytes(archive.sizeBytes)}
                    </span>
                    {isAdmin && restoreTargetStorage && (
                      <BackupRestoreButton
                        archive={archive}
                        currentVmid={vmid}
                        label="Restore"
                        node={restoreTargetNode}
                        storage={restoreTargetStorage}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {isAdmin && (
          <Form action={formAction}>
            <input name="siteSlug" type="hidden" value={siteSlug} />
            <input name="deploymentId" type="hidden" value={deploymentId} />
            {defaultBackupStorage && (
              <input name="storage" type="hidden" value={defaultBackupStorage} />
            )}
            <Button disabled={isPending || isTaskRunning} size="sm" type="submit" variant="secondary">
              <Play className="h-3.5 w-3.5" />
              {isPending ? "Starting..." : isTaskRunning ? "Backing up..." : "Backup now"}
            </Button>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}
