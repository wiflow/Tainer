"use client";

import { useMemo, useState } from "react";
import { ArrowDownToLine, Cable, Tag, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { LldpDevicePort } from "@/lib/lldp-types";

type Props = {
  ports: LldpDevicePort[];
  /** Operator-supplied port count, overrides the inference from the highest
   *  observed port number. */
  portCountOverride?: number | null;
};

type SlotInfo = {
  slot: number;
  port: LldpDevicePort | null;
  isSfp: boolean;
};

const STALE_THRESHOLD_MS = 5 * 60_000;
const FRESH_THRESHOLD_MS = 90_000;
const COMMON_PORT_COUNTS = [8, 16, 24, 28, 32, 48, 52];

export function NetworkSwitchPanel({ ports, portCountOverride }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { slots, specialPorts, inferredCount, isOverridden } = useMemo(
    () => buildLayout(ports, portCountOverride ?? null),
    [ports, portCountOverride],
  );
  const selectedPort = ports.find((p) => p.portId === selectedId) ?? null;

  if (ports.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-white/10 bg-zinc-950/40 px-4 py-6 text-center text-[12px] text-zinc-500">
        No ports observed yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <FrontPanel
        slots={slots}
        inferredCount={inferredCount}
        isOverridden={isOverridden}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      {specialPorts.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-zinc-500">
            Other ports
          </div>
          <div className="flex flex-wrap gap-2">
            {specialPorts.map((p) => (
              <SpecialPortChip
                key={p.portId}
                port={p}
                selected={selectedId === p.portId}
                onClick={() => setSelectedId(p.portId === selectedId ? null : p.portId)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {selectedPort ? (
        <PortDetailPanel port={selectedPort} onClose={() => setSelectedId(null)} />
      ) : null}

      <Legend />
    </div>
  );
}

function FrontPanel({
  slots,
  inferredCount,
  isOverridden,
  selectedId,
  onSelect,
}: {
  slots: SlotInfo[];
  inferredCount: number;
  isOverridden: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const sfpSlots = slots.filter((s) => s.isSfp);
  const rjSlots = slots.filter((s) => !s.isSfp);

  return (
    <div className="rounded-xl border border-white/[0.08] bg-gradient-to-b from-zinc-900 to-zinc-950 p-4 shadow-inner">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[10.5px] uppercase tracking-[0.14em] text-zinc-600">
          <span>
            {inferredCount}-port ({isOverridden ? "manual" : "inferred"})
          </span>
          <span>front panel</span>
        </div>
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <PortRowGrouped slots={rjSlots} selectedId={selectedId} onSelect={onSelect} />
          {sfpSlots.length > 0 ? (
            <div className="ml-2 flex gap-1 border-l border-white/5 pl-3">
              {sfpSlots.map((s) => (
                <PortChip
                  key={`sfp-${s.slot}`}
                  slot={s}
                  selectedId={selectedId}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Renders RJ45-style ports in column pairs (UniFi convention: two rows of N/2). */
function PortRowGrouped({
  slots,
  selectedId,
  onSelect,
}: {
  slots: SlotInfo[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  // UniFi-style: groups of 4 pairs, separated by small gaps.
  const groups: SlotInfo[][] = [];
  for (let i = 0; i < slots.length; i += 8) {
    groups.push(slots.slice(i, i + 8));
  }

  return (
    <div className="flex items-end gap-2">
      {groups.map((group, gi) => (
        <div key={gi} className="grid grid-flow-col grid-rows-2 gap-1">
          {group.map((s) => (
            <PortChip
              key={s.slot}
              slot={s}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function PortChip({
  slot,
  selectedId,
  onSelect,
}: {
  slot: SlotInfo;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { port, isSfp } = slot;
  const stale = port ? isStale(port.lastSeenAt) : false;
  const fresh = port ? isFresh(port.lastSeenAt) : false;
  const selected = port && selectedId === port.portId;
  const hasPort = Boolean(port);

  const title = port
    ? `Port ${slot.slot}: ${port.portDescription ?? port.portId}${
        port.vlanId != null ? ` (VLAN ${port.vlanId})` : ""
      }`
    : `Port ${slot.slot}: no LLDP data`;

  return (
    <button
      aria-label={title}
      title={title}
      onClick={() =>
        port ? onSelect(port.portId === selectedId ? null : port.portId) : undefined
      }
      disabled={!hasPort}
      type="button"
      className={cn(
        "group flex flex-col items-center gap-0.5",
        hasPort ? "cursor-pointer" : "cursor-default",
      )}
    >
      <span
        className={cn(
          "relative block rounded-[3px] border transition-all",
          isSfp ? "h-8 w-5" : "h-6 w-6",
          hasPort
            ? stale
              ? "border-rose-400/40 bg-rose-500/15"
              : "border-sky-400/50 bg-sky-500/30"
            : "border-white/[0.06] bg-[repeating-linear-gradient(45deg,transparent,transparent_2px,rgba(255,255,255,0.04)_2px,rgba(255,255,255,0.04)_4px)]",
          selected ? "ring-2 ring-sky-400 ring-offset-2 ring-offset-zinc-900" : "",
        )}
      >
        {hasPort && !stale ? (
          <span
            className={cn(
              "absolute inset-0 rounded-[3px] bg-[radial-gradient(circle_at_50%_25%,rgba(125,211,252,0.45),transparent_70%)]",
              fresh ? "animate-lldp-port-pulse" : "",
            )}
          />
        ) : null}
      </span>
      <span
        className={cn(
          "text-[9px] font-medium tabular-nums",
          hasPort ? "text-zinc-300" : "text-zinc-600",
          selected ? "text-sky-300" : "",
        )}
      >
        {slot.slot}
      </span>
    </button>
  );
}

function SpecialPortChip({
  port,
  selected,
  onClick,
}: {
  port: LldpDevicePort;
  selected: boolean;
  onClick: () => void;
}) {
  const stale = isStale(port.lastSeenAt);
  return (
    <button
      type="button"
      onClick={onClick}
      title={port.portId}
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-mono transition-colors",
        stale
          ? "border-rose-400/30 bg-rose-500/10 text-rose-200"
          : "border-sky-400/30 bg-sky-500/10 text-sky-100",
        selected ? "ring-2 ring-sky-400" : "",
      )}
    >
      <Cable className="h-3 w-3 opacity-70" />
      {port.portId}
    </button>
  );
}

function PortDetailPanel({
  port,
  onClose,
}: {
  port: LldpDevicePort;
  onClose: () => void;
}) {
  const ageMs = Date.now() - Date.parse(port.lastSeenAt);
  const stale = isStale(port.lastSeenAt);

  return (
    <section className="rounded-xl border border-sky-500/20 bg-sky-500/[0.04]">
      <header className="flex items-center justify-between border-b border-sky-500/15 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Cable className="h-3.5 w-3.5 text-sky-300" />
          <h3 className="text-[12.5px] font-medium text-sky-100">
            {port.portId}
          </h3>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium",
              stale ? "bg-rose-500/15 text-rose-200" : "bg-emerald-500/15 text-emerald-200",
            )}
          >
            {stale ? "stale" : "active"}
          </span>
        </div>
        <button
          aria-label="Close port detail"
          className="text-sky-300/60 hover:text-sky-200"
          onClick={onClose}
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      <dl className="grid grid-cols-1 gap-3 px-4 py-3 text-[12px] sm:grid-cols-2">
        {port.portDescription ? (
          <div className="sm:col-span-2">
            <dt className="text-[10.5px] uppercase tracking-[0.14em] text-sky-300/60">
              Port description
            </dt>
            <dd className="mt-0.5 text-zinc-200">{port.portDescription}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-[10.5px] uppercase tracking-[0.14em] text-sky-300/60">
            VLAN
          </dt>
          <dd className="mt-0.5 text-zinc-200">
            {port.vlanId != null ? (
              <span className="inline-flex items-center gap-1">
                <Tag className="h-3 w-3 text-sky-300" />
                {port.vlanId}
              </span>
            ) : (
              <span className="text-zinc-500">not advertised</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[10.5px] uppercase tracking-[0.14em] text-sky-300/60">
            Last seen
          </dt>
          <dd className={cn("mt-0.5", stale ? "text-rose-300" : "text-zinc-200")}>
            {formatAge(ageMs)}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[10.5px] uppercase tracking-[0.14em] text-sky-300/60">
            Connected to (this site)
          </dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-2">
            <ArrowDownToLine className="h-3 w-3 text-zinc-500" />
            <span className="font-mono text-zinc-200">{port.connectedTo.agentHost}</span>
            <span className="text-zinc-500">·</span>
            <span className="font-mono text-zinc-300">{port.connectedTo.localInterface}</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10.5px] text-zinc-500">
      <LegendItem swatch="active" label="LLDP neighbour active" />
      <LegendItem swatch="stale" label="stale (no push > 5 min)" />
      <LegendItem swatch="empty" label="no LLDP data (port may be empty or remote doesn't speak LLDP)" />
    </div>
  );
}

function LegendItem({ swatch, label }: { swatch: "active" | "stale" | "empty"; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "inline-block h-3 w-3 rounded-[2px] border",
          swatch === "active"
            ? "border-sky-400/50 bg-sky-500/30"
            : swatch === "stale"
              ? "border-rose-400/40 bg-rose-500/15"
              : "border-white/[0.08] bg-[repeating-linear-gradient(45deg,transparent,transparent_2px,rgba(255,255,255,0.04)_2px,rgba(255,255,255,0.04)_4px)]",
        )}
      />
      {label}
    </span>
  );
}

function isStale(at: string): boolean {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t > STALE_THRESHOLD_MS;
}

function isFresh(at: string): boolean {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= FRESH_THRESHOLD_MS;
}

function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

/**
 * Build the visual layout: assign each known port to a numbered slot, infer
 * the total port count, and split anything that doesn't fit a numbered slot
 * into the "Other ports" bucket.
 */
function buildLayout(
  ports: LldpDevicePort[],
  portCountOverride: number | null,
): {
  slots: SlotInfo[];
  specialPorts: LldpDevicePort[];
  inferredCount: number;
  isOverridden: boolean;
} {
  const numbered: { slot: number; port: LldpDevicePort; isSfp: boolean }[] = [];
  const special: LldpDevicePort[] = [];

  for (const port of ports) {
    const parsed = extractSlot(port.portId);
    if (parsed == null) {
      special.push(port);
      continue;
    }
    numbered.push({ slot: parsed.slot, port, isSfp: parsed.isSfp });
  }

  const highest = numbered.reduce((m, n) => Math.max(m, n.slot), 0);
  const inferredCount =
    portCountOverride != null
      ? portCountOverride
      : (COMMON_PORT_COUNTS.find((c) => c >= highest) ?? Math.max(8, highest));

  const byNumber = new Map<number, { port: LldpDevicePort; isSfp: boolean }>();
  for (const n of numbered) {
    byNumber.set(n.slot, { port: n.port, isSfp: n.isSfp });
  }

  const slots: SlotInfo[] = [];
  for (let i = 1; i <= inferredCount; i++) {
    const entry = byNumber.get(i);
    slots.push({
      slot: i,
      port: entry?.port ?? null,
      isSfp: entry?.isSfp ?? false,
    });
  }

  return {
    slots,
    specialPorts: special,
    inferredCount,
    isOverridden: portCountOverride != null,
  };
}

/**
 * Extract the slot number and whether it's an SFP/uplink port from a port ID.
 * Returns null if the port ID doesn't look slot-numbered (e.g. it's a MAC
 * address — older managed switches sometimes advertise MAC as port ID).
 */
function extractSlot(portId: string): { slot: number; isSfp: boolean } | null {
  const trimmed = portId.trim();
  if (/^([0-9a-fA-F]{2}[:.\- ]){5}[0-9a-fA-F]{2}$/.test(trimmed)) return null;

  // Prefer the *last* numeric run in the string — that captures "Eth1/14" → 14,
  // "swp14" → 14, "xe-0/0/14" → 14. Numbers that come before slashes are
  // typically chassis/module identifiers and not slot numbers.
  const matches = trimmed.match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const slot = Number(last);
  if (!Number.isFinite(slot) || slot <= 0 || slot > 200) return null;

  const isSfp = /sfp|xe-|te-|fortygig|hundredgig|qsfp/i.test(trimmed);
  return { slot, isSfp };
}
