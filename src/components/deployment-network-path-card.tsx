import Link from "next/link";
import { ArrowRight, Cable, HelpCircle, Network, Server } from "lucide-react";

import type { DeploymentNetworkPath } from "@/lib/lldp-deployment-path";

type Props = {
  siteSlug: string;
  path: DeploymentNetworkPath;
};

export function DeploymentNetworkPathCard({ siteSlug, path }: Props) {
  if (path.entries.length === 0) {
    return null;
  }

  return (
    <section className="rounded-xl border border-white/[0.06] bg-zinc-950/40">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/[0.04] px-4 py-3">
        <div className="flex items-center gap-2">
          <Cable className="h-3.5 w-3.5 text-zinc-400" />
          <h2 className="text-[13px] font-medium text-zinc-100">Network path</h2>
        </div>
        <div className="text-[10.5px] text-zinc-500">
          {path.agentHost ? (
            <>
              Source: <span className="font-mono text-zinc-400">{path.agentHost}</span>
              {path.freshestSnapshotAt ? (
                <span className="ml-2">
                  · {formatAge(Date.now() - Date.parse(path.freshestSnapshotAt))}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-zinc-600">No LLDP agent on this node yet.</span>
          )}
        </div>
      </header>

      <div className="divide-y divide-white/[0.04]">
        {path.entries.map((entry) => (
          <div key={entry.netKey} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-zinc-300">
              <span className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10.5px] text-zinc-200">
                {entry.netKey}
              </span>
              {entry.vlanTag != null ? (
                <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10.5px] text-sky-200">
                  vlan {entry.vlanTag}
                </span>
              ) : null}
              <ArrowRight className="h-3 w-3 text-zinc-600" />
              {entry.bridge ? (
                <span className="inline-flex items-center gap-1 text-zinc-200">
                  <Network className="h-3 w-3 text-zinc-500" />
                  <span className="font-mono">{entry.bridge}</span>
                </span>
              ) : (
                <span className="text-zinc-500">no bridge</span>
              )}
            </div>

            {entry.uplinks.length === 0 && entry.bridge ? (
              <p className="mt-2 ml-2 border-l border-white/5 pl-3 text-[11.5px] text-zinc-500">
                Bridge has no upstream NIC (host-only).
              </p>
            ) : null}

            <ul className="mt-2 ml-2 space-y-1.5 border-l border-white/5 pl-3">
              {entry.uplinks.map((hop) => (
                <li key={hop.uplinkInterface} className="flex flex-wrap items-center gap-2 text-[11.5px]">
                  <Server className="h-3 w-3 text-zinc-600" />
                  <span className="font-mono text-zinc-300">{hop.uplinkInterface}</span>
                  <ArrowRight className="h-3 w-3 text-zinc-700" />
                  {hop.remote ? (
                    <Link
                      className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-zinc-100 hover:bg-white/[0.04]"
                      href={`/sites/${siteSlug}/network/devices/${encodeURIComponent(hop.remote.chassisId)}`}
                    >
                      <Network className="h-3 w-3 text-sky-300" />
                      <span className="font-medium">
                        {hop.remote.systemName ?? hop.remote.chassisId}
                      </span>
                      <span className="font-mono text-zinc-400">· {hop.remote.portId}</span>
                      {hop.remote.vlanId != null ? (
                        <span className="rounded bg-sky-500/10 px-1 py-0.5 text-[10px] text-sky-200">
                          vlan {hop.remote.vlanId}
                        </span>
                      ) : null}
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-zinc-500">
                      <HelpCircle className="h-3 w-3 text-zinc-600" />
                      no LLDP neighbour observed
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}
