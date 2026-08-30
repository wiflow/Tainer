import Link from "next/link";
import { ChevronRight, Router, Server, Wifi, Network, HelpCircle } from "lucide-react";

import type { LldpDevice } from "@/lib/lldp-types";

type Props = {
  devices: LldpDevice[];
  siteSlug: string;
};

export function NetworkDevicesTable({ devices, siteSlug }: Props) {
  if (devices.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 bg-zinc-950/40 px-6 py-12 text-center text-[12px] text-zinc-500">
        No devices discovered yet. Once an agent posts a snapshot, neighbours will appear here.
      </div>
    );
  }

  const now = Date.now();

  return (
    <div className="overflow-hidden overflow-x-auto rounded-xl border border-white/[0.06] bg-zinc-950/40">
      <table className="w-full text-left text-[12.5px]">
        <thead className="bg-white/[0.02] text-[10.5px] uppercase tracking-[0.14em] text-zinc-500">
          <tr>
            <th className="px-4 py-2.5 font-medium">Device</th>
            <th className="px-4 py-2.5 font-medium">Type</th>
            <th className="px-4 py-2.5 font-medium">Management</th>
            <th className="px-4 py-2.5 font-medium">Ports observed</th>
            <th className="px-4 py-2.5 font-medium">Last seen</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {devices.map((d) => {
            const Icon = pickIcon(d);
            const portCount = Object.keys(d.ports).length;
            const ageMs = now - Date.parse(d.lastSeenAt);
            const stale = Number.isFinite(ageMs) && ageMs > 5 * 60_000;
            return (
              <tr
                key={d.chassisId}
                className="group transition-colors hover:bg-white/[0.03]"
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/5">
                      <Icon className="h-3.5 w-3.5 text-sky-300" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-zinc-100">
                        {d.systemName ?? <span className="text-zinc-500">unknown</span>}
                      </div>
                      <div className="truncate font-mono text-[10.5px] text-zinc-500">
                        {d.chassisId}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-zinc-400">
                  {d.capabilities.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {d.capabilities.map((c) => (
                        <span
                          key={c}
                          className="rounded bg-white/5 px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-zinc-300"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 font-mono text-[11.5px] text-zinc-400">
                  {d.managementAddress ?? <span className="text-zinc-600">—</span>}
                </td>
                <td className="px-4 py-2.5 text-zinc-300">{portCount}</td>
                <td className="px-4 py-2.5 text-zinc-400">
                  <span className={stale ? "text-rose-400/80" : ""}>{formatAge(ageMs)}</span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    aria-label={`View ${d.systemName ?? d.chassisId}`}
                    className="inline-flex items-center text-zinc-500 group-hover:text-zinc-300"
                    href={`/sites/${siteSlug}/network/devices/${encodeURIComponent(d.chassisId)}`}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function pickIcon(d: LldpDevice) {
  const caps = d.capabilities;
  if (caps.includes("router")) return Router;
  if (caps.includes("wlan-access-point") || caps.includes("wlan")) return Wifi;
  if (caps.includes("bridge")) return Network;
  if (caps.includes("station") || caps.includes("host")) return Server;
  return HelpCircle;
}

function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}
