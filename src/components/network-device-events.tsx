import { ArrowDown, ArrowUp, History } from "lucide-react";

import type { LldpEvent } from "@/lib/lldp-events";
import { cn } from "@/lib/utils";

type Props = {
  events: LldpEvent[];
};

export function NetworkDeviceEvents({ events }: Props) {
  if (events.length === 0) {
    return (
      <section className="rounded-xl border border-white/[0.06] bg-zinc-950/40">
        <header className="border-b border-white/[0.04] px-4 py-2.5">
          <h3 className="text-[12.5px] font-medium text-zinc-100">Link history</h3>
        </header>
        <p className="px-4 py-6 text-center text-[11.5px] text-zinc-500">
          No link transitions observed yet. Events appear here when a port
          appears or disappears between two consecutive LLDP snapshots.
        </p>
      </section>
    );
  }

  const now = Date.now();

  return (
    <section className="rounded-xl border border-white/[0.06] bg-zinc-950/40">
      <header className="flex items-center justify-between border-b border-white/[0.04] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <History className="h-3.5 w-3.5 text-zinc-400" />
          <h3 className="text-[12.5px] font-medium text-zinc-100">Link history</h3>
        </div>
        <span className="text-[10.5px] text-zinc-500">
          {events.length} event{events.length === 1 ? "" : "s"} · last 200
        </span>
      </header>
      <ol className="divide-y divide-white/[0.04] text-[11.5px]">
        {events.map((e) => {
          const ageMs = now - Date.parse(e.observedAt);
          const isUp = e.kind === "link-up";
          return (
            <li key={e.id} className="flex items-center gap-3 px-4 py-2">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                  isUp ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300",
                )}
                aria-hidden
              >
                {isUp ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
              </span>
              <span
                className={cn(
                  "shrink-0 font-medium",
                  isUp ? "text-emerald-200" : "text-rose-200",
                )}
              >
                {isUp ? "link up" : "link down"}
              </span>
              <span className="font-mono text-zinc-300">{e.portId}</span>
              <span className="text-zinc-600">·</span>
              <span className="font-mono text-zinc-400">
                {e.agentHost}:{e.localInterface}
              </span>
              <span className="ml-auto text-zinc-500">{formatAge(ageMs)}</span>
            </li>
          );
        })}
      </ol>
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
