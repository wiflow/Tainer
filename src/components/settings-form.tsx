"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";

import {
  updateBackupDefaultsAction,
  updateDockerLibraryAction,
  updateRootfsDefaultsAction,
} from "@/app/settings-actions";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { SectionPanel } from "@/components/ui/section-panel";
import { Form } from "@/components/ui/form";
import { initialActionState } from "@/lib/action-states";
import type { RootfsTarget } from "@/lib/proxmox";
import type { ProxmoxBackupStoragePool } from "@/lib/proxmox";
import { useSiteBasePath } from "@/lib/use-site-path";
import { formatBytes } from "@/lib/utils";

function usageLabel(target: RootfsTarget) {
  if (target.usageRatio == null) {
    return "Usage unavailable";
  }

  return `${Math.round(target.usageRatio * 100)}% used`;
}

export function SettingsForm({
  defaultRootfsStorage,
  rootfsTargets,
  updatedAt,
}: {
  defaultRootfsStorage: string;
  rootfsTargets: RootfsTarget[];
  updatedAt: string | null;
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    updateRootfsDefaultsAction,
    initialActionState,
  );

  useActionTaskFeedback(state, {
    errorTitle: "Settings update failed",
    successTitle: "Settings saved",
  });

  const inputClassName =
    "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
      <SectionPanel
        title="Provisioning defaults"
        description="Choose which Proxmox storage pool should be preselected for new LXC rootfs volumes."
      >
        <Form action={formAction} className="space-y-5">
          <input name="siteSlug" type="hidden" value={siteSlug} />
          <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <span className="text-[13px] font-medium text-zinc-200">Default rootfs storage</span>
            <select
              className={inputClassName}
              defaultValue={defaultRootfsStorage}
              name="defaultRootfsStorage"
            >
              {rootfsTargets.map((target) => (
                <option key={`${target.node}::${target.storage}`} value={target.storage}>
                  {target.shared
                    ? `${target.storage} (${target.type})`
                    : `${target.storage} on ${target.node}`}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center justify-between rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[12px] text-zinc-500">
            <span>Last updated</span>
            <span>
              {updatedAt ? new Date(updatedAt).toLocaleString() : "Using environment default"}
            </span>
          </div>

          <div className="flex gap-2 border-t border-white/5 pt-4">
            <Button disabled={isPending || rootfsTargets.length === 0} type="submit">
              <Save className="h-3.5 w-3.5" />
              {isPending ? "Saving..." : "Save defaults"}
            </Button>
          </div>
        </Form>
      </SectionPanel>

      <SectionPanel
        title="Available rootfs pools"
        description="Live storage pools on Proxmox that currently support `rootdir` content for LXC rootfs volumes."
        noPadding
      >
        <div className="divide-y divide-white/5">
          {rootfsTargets.length === 0 ? (
            <div className="px-4 py-3 text-[13px] text-zinc-500">
              No rootfs-capable storage pools are visible to the current token.
            </div>
          ) : (
            rootfsTargets.map((target) => (
              <div key={`${target.node}::${target.storage}`} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-semibold text-zinc-100">{target.storage}</p>
                    <p className="mt-1 text-[12px] text-zinc-500">
                      {target.node} · {target.type} · {usageLabel(target)}
                    </p>
                  </div>
                  <div className="text-right text-[12px] text-zinc-500">
                    <p>{formatBytes(target.usedBytes ?? 0)} used</p>
                    <p>{formatBytes(target.availableBytes ?? 0)} free</p>
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-zinc-400"
                    style={{
                      width: `${Math.max(6, Math.round((target.usageRatio ?? 0) * 100))}%`,
                    }}
                  />
                </div>
                <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  {formatBytes(target.totalBytes ?? 0)} total
                </p>
              </div>
            ))
          )}
        </div>
      </SectionPanel>
    </div>
  );
}

export function DockerLibraryForm({
  dockerLibraryPath,
  envFallback,
  updatedAt,
}: {
  dockerLibraryPath: string;
  envFallback: string;
  updatedAt: string | null;
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    updateDockerLibraryAction,
    initialActionState,
  );

  useActionTaskFeedback(state, {
    errorTitle: "Docker library update failed",
    successTitle: "Docker library saved",
  });

  const inputClassName =
    "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

  const effective = dockerLibraryPath || envFallback;

  return (
    <SectionPanel
      title="Docker image library"
      description="Where pulled Docker Hub images are stored to be used as LXC templates. Must be a writable path inside the container."
    >
      <Form action={formAction} className="space-y-5">
        <input name="siteSlug" type="hidden" value={siteSlug} />
        <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
          <span className="text-[13px] font-medium text-zinc-200">Library path</span>
          <input
            className={inputClassName}
            defaultValue={dockerLibraryPath}
            name="dockerLibraryPath"
            placeholder="/app/data/docker-library"
            spellCheck={false}
          />
          <p className="mt-2 text-[11px] text-zinc-500">
            Tip: <code className="text-zinc-300">/app/data/docker-library</code> lives on the
            already-mounted data volume, so it works with no redeploy — the directory is created on
            the first pull. Leave blank to fall back to the{" "}
            <code className="text-zinc-300">DOCKER_LIBRARY_PATH</code> environment variable.
          </p>
        </label>

        <div className="flex items-center justify-between rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[12px] text-zinc-500">
          <span>Effective path</span>
          <span className="text-zinc-300">{effective || "Not configured"}</span>
        </div>

        <div className="flex items-center justify-between rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[12px] text-zinc-500">
          <span>Last updated</span>
          <span>{updatedAt ? new Date(updatedAt).toLocaleString() : "Using environment default"}</span>
        </div>

        <div className="flex gap-2 border-t border-white/5 pt-4">
          <Button disabled={isPending} type="submit">
            <Save className="h-3.5 w-3.5" />
            {isPending ? "Saving..." : "Save library path"}
          </Button>
        </div>
      </Form>
    </SectionPanel>
  );
}

export function BackupSettingsForm({
  backupPools,
  defaultBackupSlaHours,
  defaultBackupStorage,
  updatedAt,
}: {
  backupPools: ProxmoxBackupStoragePool[];
  defaultBackupSlaHours: number;
  defaultBackupStorage: string;
  updatedAt: string | null;
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    updateBackupDefaultsAction,
    initialActionState,
  );

  useActionTaskFeedback(state, {
    errorTitle: "Backup settings update failed",
    successTitle: "Backup settings saved",
  });

  const inputClassName =
    "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

  const healthyPools = backupPools.filter((p) => p.issues.length === 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
      <SectionPanel
        title="Backup defaults"
        description="Configure the default backup storage target and SLA window used for backup coverage checks."
      >
        <Form action={formAction} className="space-y-5">
          <input name="siteSlug" type="hidden" value={siteSlug} />
          <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <span className="text-[13px] font-medium text-zinc-200">Default backup storage</span>
            <select
              className={inputClassName}
              defaultValue={defaultBackupStorage}
              name="defaultBackupStorage"
            >
              <option value="">None selected</option>
              {healthyPools.map((pool) => (
                <option key={`${pool.node}::${pool.storage}`} value={pool.storage}>
                  {pool.shared
                    ? `${pool.storage} (${pool.type})`
                    : `${pool.storage} on ${pool.node}`}
                </option>
              ))}
            </select>
            <p className="mt-2 text-[11px] text-zinc-500">
              The backup storage must already be configured in Proxmox as a backup-capable target (e.g. CIFS/SMB share with &quot;backup&quot; content type).
            </p>
          </label>

          <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <span className="text-[13px] font-medium text-zinc-200">Backup SLA (hours)</span>
            <input
              className={inputClassName}
              defaultValue={defaultBackupSlaHours}
              min="1"
              name="defaultBackupSlaHours"
              type="number"
            />
            <p className="mt-2 text-[11px] text-zinc-500">
              Deployments without a successful backup within this window are flagged as at risk.
            </p>
          </label>

          <div className="flex items-center justify-between rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[12px] text-zinc-500">
            <span>Last updated</span>
            <span>
              {updatedAt ? new Date(updatedAt).toLocaleString() : "Not configured"}
            </span>
          </div>

          <div className="flex gap-2 border-t border-white/5 pt-4">
            <Button disabled={isPending} type="submit">
              <Save className="h-3.5 w-3.5" />
              {isPending ? "Saving..." : "Save backup defaults"}
            </Button>
          </div>
        </Form>
      </SectionPanel>

      <SectionPanel
        title="Backup storage pools"
        description='Proxmox storage pools with "backup" content type. Veeam protects the SMB share downstream.'
        noPadding
      >
        <div className="divide-y divide-white/5">
          {backupPools.length === 0 ? (
            <div className="px-4 py-3 text-[13px] text-zinc-500">
              No backup-capable storage pools are visible. Configure a CIFS/SMB storage with &quot;backup&quot; content in Proxmox.
            </div>
          ) : (
            backupPools.map((pool) => (
              <div key={`${pool.node}::${pool.storage}`} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-semibold text-zinc-100">{pool.storage}</p>
                    <p className="mt-1 text-[12px] text-zinc-500">
                      {pool.node} · {pool.type}{pool.shared ? " · shared" : ""}
                    </p>
                    {pool.issues.length > 0 && (
                      <p className="mt-1 text-[11px] text-amber-400">
                        {pool.issues.join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-[12px] text-zinc-500">
                    <p>{formatBytes(pool.usedBytes ?? 0)} used</p>
                    <p>{formatBytes(pool.availableBytes ?? 0)} free</p>
                  </div>
                </div>
                {pool.totalBytes != null && pool.totalBytes > 0 && (
                  <>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-zinc-400"
                        style={{
                          width: `${Math.max(6, Math.round((pool.usageRatio ?? 0) * 100))}%`,
                        }}
                      />
                    </div>
                    <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                      {formatBytes(pool.totalBytes)} total
                    </p>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </SectionPanel>
    </div>
  );
}
