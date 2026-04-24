import { AlertTriangle, CheckCircle2, HardDrive } from "lucide-react";

import type { ProxmoxBackupStoragePool } from "@/lib/proxmox";
import { formatBytes } from "@/lib/utils";

export function BackupStorageCards({
  pools,
}: {
  pools: ProxmoxBackupStoragePool[];
}) {
  if (pools.length === 0) {
    return (
      <div className="px-5 py-4 text-[13px] text-zinc-500">
        No backup-capable storage pools found. Configure a CIFS/SMB storage with &quot;backup&quot; content in Proxmox.
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {pools.map((pool) => {
        const healthy = pool.issues.length === 0;

        return (
          <div
            key={`${pool.node}::${pool.storage}`}
            className="rounded-2xl border border-white/5 bg-[#111113] p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-zinc-500" />
                <div>
                  <p className="text-[13px] font-semibold text-zinc-100">{pool.storage}</p>
                  <p className="mt-0.5 text-[12px] text-zinc-500">
                    {pool.type}{pool.shared ? " · shared" : ""} · {pool.node}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {healthy ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                )}
                {pool.usageRatio != null && (
                  <p className="text-[13px] font-semibold tabular-nums text-zinc-100">
                    {Math.round(pool.usageRatio * 100)}%
                  </p>
                )}
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
                <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
                  <span>{formatBytes(pool.usedBytes ?? 0)} used</span>
                  <span>{formatBytes(pool.totalBytes)} total</span>
                </div>
              </>
            )}
            {pool.issues.length > 0 && (
              <div className="mt-2 space-y-1">
                {pool.issues.map((issue) => (
                  <p key={issue} className="text-[11px] text-amber-400">
                    {issue}
                  </p>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
