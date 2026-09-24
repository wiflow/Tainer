import { Router, Server, Wifi, Network, HelpCircle } from "lucide-react";

import type { LldpDevice, LldpTopology } from "@/lib/lldp-types";

type Props = {
  topology: LldpTopology;
  siteSlug: string;
};

export function NetworkTopologyGraph({ topology, siteSlug }: Props) {
  if (topology.agents.length === 0 && topology.devices.length === 0) {
    return <EmptyState />;
  }

  const VIEW_W = 1000;
  const TOP_Y = 110;
  const BOTTOM_Y = 380;
  const TOP_NODE_W = 220;
  const TOP_NODE_H = 90;
  const BOTTOM_NODE_W = 160;
  const BOTTOM_NODE_H = 70;

  const upstream = topology.devices;
  const agents = topology.agents;

  const upstreamX = computePositions(upstream.length, VIEW_W);
  const agentX = computePositions(agents.length, VIEW_W);

  const devicePos = new Map<string, { x: number; y: number }>();
  upstream.forEach((d, i) => {
    devicePos.set(d.chassisId, { x: upstreamX[i], y: TOP_Y + TOP_NODE_H / 2 });
  });
  const agentPos = new Map<string, { x: number; y: number }>();
  agents.forEach((a, i) => {
    agentPos.set(a, { x: agentX[i], y: BOTTOM_Y + BOTTOM_NODE_H / 2 });
  });

  const now = Date.now();

  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-zinc-950/60">
      <svg
        viewBox={`0 0 ${VIEW_W} ${BOTTOM_Y + BOTTOM_NODE_H + 40}`}
        className="block w-full h-auto"
        role="img"
        aria-label="Network topology"
      >
        <defs>
          <radialGradient id="lldp-node-glow" cx="50%" cy="0%" r="80%">
            <stop offset="0%" stopColor="rgba(56,189,248,0.18)" />
            <stop offset="100%" stopColor="rgba(56,189,248,0)" />
          </radialGradient>
        </defs>

        {/* Edges first, so node rectangles paint over their endpoints. */}
        {topology.edges.map((edge, idx) => {
          const from = devicePos.get(edge.chassisId);
          const to = agentPos.get(edge.agentHost);
          if (!from || !to) return null;
          const stale = isStale(edge.lastSeenAt, now);
          const midY = (from.y + to.y) / 2;
          const path = `M ${from.x} ${from.y + TOP_NODE_H / 2}
            C ${from.x} ${midY},
              ${to.x} ${midY},
              ${to.x} ${to.y - BOTTOM_NODE_H / 2}`;
          return (
            <g key={`${edge.agentHost}-${edge.chassisId}-${edge.portId}-${idx}`}>
              <path
                d={path}
                fill="none"
                stroke={stale ? "rgba(244,114,182,0.35)" : "rgba(56,189,248,0.55)"}
                strokeWidth={stale ? 1.5 : 2}
                strokeDasharray={stale ? "5 4" : undefined}
              />
              {edge.vlanId != null ? (
                <text
                  x={(from.x + to.x) / 2}
                  y={midY - 6}
                  textAnchor="middle"
                  className="fill-zinc-500"
                  fontSize="10"
                >
                  vlan {edge.vlanId}
                </text>
              ) : null}
            </g>
          );
        })}

        {upstream.map((d, i) => (
          <DeviceNode
            key={d.chassisId}
            device={d}
            x={upstreamX[i]}
            y={TOP_Y}
            width={TOP_NODE_W}
            height={TOP_NODE_H}
            href={`/sites/${siteSlug}/network/devices/${encodeURIComponent(d.chassisId)}`}
            stale={isStale(d.lastSeenAt, now)}
          />
        ))}

        {agents.map((host, i) => (
          <AgentNode
            key={host}
            host={host}
            x={agentX[i]}
            y={BOTTOM_Y}
            width={BOTTOM_NODE_W}
            height={BOTTOM_NODE_H}
          />
        ))}
      </svg>

      <Legend stale={hasAnyStale(topology, now)} />
    </div>
  );
}

function DeviceNode({
  device,
  x,
  y,
  width,
  height,
  href,
  stale,
}: {
  device: LldpDevice;
  x: number;
  y: number;
  width: number;
  height: number;
  href: string;
  stale: boolean;
}) {
  const Icon = pickIconForDevice(device);
  const title = device.systemName ?? `Unknown (${device.chassisId})`;
  const subtitle = device.managementAddress ?? device.chassisId;

  return (
    <a href={href} className="cursor-pointer">
      <g>
        <rect
          x={x - width / 2}
          y={y}
          width={width}
          height={height}
          rx={10}
          fill="url(#lldp-node-glow)"
          stroke={stale ? "rgba(244,114,182,0.4)" : "rgba(56,189,248,0.45)"}
          strokeWidth={1.5}
        />
        <rect
          x={x - width / 2}
          y={y}
          width={width}
          height={height}
          rx={10}
          fill="rgba(24,24,27,0.85)"
        />
        <foreignObject x={x - width / 2 + 10} y={y + 8} width={width - 20} height={height - 16}>
          <div className="flex h-full items-center gap-2.5 text-zinc-200">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/5">
              <Icon className="h-4 w-4 text-sky-300" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium leading-tight">{title}</div>
              <div className="truncate text-[10px] text-zinc-500 font-mono">{subtitle}</div>
              {device.capabilities.length > 0 ? (
                <div className="mt-0.5 truncate text-[10px] text-zinc-600 uppercase tracking-wide">
                  {device.capabilities.slice(0, 3).join(" · ")}
                </div>
              ) : null}
            </div>
          </div>
        </foreignObject>
      </g>
    </a>
  );
}

function AgentNode({
  host,
  x,
  y,
  width,
  height,
}: {
  host: string;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return (
    <g>
      <rect
        x={x - width / 2}
        y={y}
        width={width}
        height={height}
        rx={10}
        fill="rgba(24,24,27,0.85)"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1.5}
      />
      <foreignObject x={x - width / 2 + 10} y={y + 6} width={width - 20} height={height - 12}>
        <div className="flex h-full items-center gap-2.5 text-zinc-200">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/10">
            <Server className="h-4 w-4 text-emerald-300" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium leading-tight">{host}</div>
            <div className="truncate text-[10px] text-zinc-500">Proxmox node</div>
          </div>
        </div>
      </foreignObject>
    </g>
  );
}

function Legend({ stale }: { stale: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-white/5 px-4 py-2 text-[10.5px] text-zinc-500">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-px w-5 bg-sky-400/60" />
        active link
      </span>
      {stale ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-px w-5 border-t border-dashed border-rose-400/60" />
          stale (no push in &gt; 5 min)
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1.5 text-zinc-600">
        edges label shows VLAN where advertised
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-zinc-950/40 px-6 py-16 text-center">
      <Network className="mx-auto h-7 w-7 text-zinc-500" />
      <div className="mt-3 text-[13px] text-zinc-200">No LLDP data yet.</div>
      <div className="mt-1 text-[11px] text-zinc-500">
        Open the Integrations tab to issue a token and install the agent on a Proxmox node.
      </div>
    </div>
  );
}

function computePositions(count: number, width: number): number[] {
  if (count === 0) return [];
  if (count === 1) return [width / 2];
  const margin = 100;
  const usable = width - 2 * margin;
  const step = usable / (count - 1);
  return Array.from({ length: count }, (_, i) => margin + step * i);
}

function pickIconForDevice(d: LldpDevice) {
  const caps = d.capabilities;
  if (caps.length === 0) return HelpCircle;
  if (caps.includes("router")) return Router;
  if (caps.includes("wlan-access-point") || caps.includes("wlan")) return Wifi;
  if (caps.includes("bridge")) return Network;
  return HelpCircle;
}

function isStale(at: string, nowMs: number): boolean {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return false;
  return nowMs - t > 5 * 60_000;
}

function hasAnyStale(topology: LldpTopology, nowMs: number): boolean {
  return topology.edges.some((e) => isStale(e.lastSeenAt, nowMs));
}
