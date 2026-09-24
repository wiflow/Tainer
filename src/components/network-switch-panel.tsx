"use client";

import { useMemo, useState } from "react";
import { ArrowDownToLine, Cable, Tag, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { LldpDevicePort } from "@/lib/lldp-types";
import type { SnmpPort } from "@/lib/lldp-snmp-types";

type Props = {
  ports: LldpDevicePort[];
  portCountOverride?: number | null;
  snmpPorts?: SnmpPort[] | null;
};

type SlotInfo = {
  slot: number;
  port: LldpDevicePort | null;
  isSfp: boolean;
};

const STALE_THRESHOLD_MS = 5 * 60_000;
const FRESH_THRESHOLD_MS = 90_000;
const COMMON_PORT_COUNTS = [8, 16, 24, 28, 32, 48, 52];

export function NetworkSwitchPanel({ ports, portCountOverride, snmpPorts }: Props) {
  if (snmpPorts && snmpPorts.length > 0) {
    return <SnmpFrontPanel lldpPorts={ports} snmpPorts={snmpPorts} />;
  }
  return (
    <LldpInferredPanel ports={ports} portCountOverride={portCountOverride ?? null} />
  );
}

function LldpInferredPanel({
  ports,
  portCountOverride,
}: {
  ports: LldpDevicePort[];
  portCountOverride: number | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { slots, specialPorts, inferredCount, isOverridden } = useMemo(
    () => buildLayout(ports, portCountOverride),
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

  const hasNumberedPorts = slots.some((s) => s.port !== null);

  if (!hasNumberedPorts) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-white/[0.06] bg-zinc-950/40 px-4 py-3">
          <div className="text-[11px] text-zinc-500">
            This device advertises ports by MAC address, not switch-style port
            names, which is typical of a Linux host or another Proxmox node. No physical
            chassis to draw; the observed links are listed below. Enable SNMP
            polling for a real port inventory if this is a managed switch.
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-zinc-500">
            Links observed ({specialPorts.length})
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {specialPorts.map((p) => (
              <LinkRow
                key={p.portId}
                port={p}
                selected={selectedId === p.portId}
                onClick={() =>
                  setSelectedId(p.portId === selectedId ? null : p.portId)
                }
              />
            ))}
          </div>
        </div>
        {selectedPort ? (
          <PortDetailPanel port={selectedPort} onClose={() => setSelectedId(null)} />
        ) : null}
        <Legend />
      </div>
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

function LinkRow({
  port,
  selected,
  onClick,
}: {
  port: LldpDevicePort;
  selected: boolean;
  onClick: () => void;
}) {
  const stale = isStale(port.lastSeenAt);
  const fresh = isFresh(port.lastSeenAt);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
        stale
          ? "border-rose-500/25 bg-rose-500/[0.05] hover:bg-rose-500/[0.08]"
          : "border-sky-500/25 bg-sky-500/[0.05] hover:bg-sky-500/[0.09]",
        selected ? "ring-2 ring-sky-400 ring-offset-2 ring-offset-zinc-950" : "",
      )}
    >
      <span
        className={cn(
          "relative inline-block h-2 w-2 flex-shrink-0 rounded-full",
          stale ? "bg-rose-400" : "bg-sky-400",
        )}
      >
        {!stale && fresh ? (
          <span className="absolute inset-0 animate-ping rounded-full bg-sky-400/60" />
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Cable className="h-3 w-3 flex-shrink-0 text-zinc-500" />
          <span className="font-mono text-[11.5px] text-zinc-200">
            {port.portDescription?.trim() || port.portId}
          </span>
          {port.vlanId != null ? (
            <span className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-200">
              <Tag className="h-2.5 w-2.5" /> VLAN {port.vlanId}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-zinc-500">
          <ArrowDownToLine className="h-3 w-3" />
          <span>connects to</span>
          <span className="font-mono text-zinc-300">
            {port.connectedTo.agentHost}
          </span>
          <span className="text-zinc-600">·</span>
          <span className="font-mono text-zinc-400">
            {port.connectedTo.localInterface}
          </span>
        </div>
      </div>
      <span
        className={cn(
          "flex-shrink-0 text-[10px] tabular-nums",
          stale ? "text-rose-300/80" : "text-zinc-500",
        )}
      >
        {formatAge(Date.now() - Date.parse(port.lastSeenAt))}
      </span>
    </button>
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

function PortRowGrouped({
  slots,
  selectedId,
  onSelect,
}: {
  slots: SlotInfo[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
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

function extractSlot(portId: string): { slot: number; isSfp: boolean } | null {
  const trimmed = portId.trim();
  if (/^([0-9a-fA-F]{2}[:.\- ]){5}[0-9a-fA-F]{2}$/.test(trimmed)) return null;

  // The last number is the port; in "xe-0/0/14" the others are chassis or module ids.
  const matches = trimmed.match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const slot = Number(last);
  if (!Number.isFinite(slot) || slot <= 0 || slot > 200) return null;

  const isSfp = /sfp|xe-|te-|fortygig|hundredgig|qsfp/i.test(trimmed);
  return { slot, isSfp };
}

type SnmpSlot = {
  slot: number;
  isSfp: boolean;
  snmp: SnmpPort;
  shortName: string;
  lldp: LldpDevicePort | null;
};

const ETHERNET_TYPE_NUMBERS = new Set([6, 7, 117, 169]); // IANA ifType values

function isPhysicalSnmpPort(p: SnmpPort): boolean {
  if (p.type != null && ETHERNET_TYPE_NUMBERS.has(p.type)) return true;
  if (p.type != null) return false;
  if (/^(vlan|vl|lo|loopback|null|tunnel|po|port-?channel|bdi|nve|svi)/i.test(p.name)) {
    return false;
  }
  return /\d/.test(p.name);
}

function shortenPortName(name: string): string {
  return name
    .replace(/^TwentyFiveGigabitEthernet/i, "Twe")
    .replace(/^HundredGigabitEthernet/i, "Hu")
    .replace(/^FortyGigabitEthernet/i, "Fo")
    .replace(/^TenGigabitEthernet/i, "Te")
    .replace(/^GigabitEthernet/i, "Gi")
    .replace(/^FastEthernet/i, "Fa")
    .replace(/^Ethernet/i, "Eth");
}

function slotFromSnmpName(name: string): { slot: number; isSfp: boolean } | null {
  return extractSlot(name);
}

function findLldpForSnmp(
  snmp: SnmpPort,
  lldpPorts: LldpDevicePort[],
): LldpDevicePort | null {
  if (!lldpPorts.length) return null;
  const snmpShort = shortenPortName(snmp.name).toLowerCase();
  const snmpSlot = slotFromSnmpName(snmp.name)?.slot ?? null;

  for (const l of lldpPorts) {
    const candidates = [l.portId, l.portDescription ?? ""]
      .map((s) => s.trim())
      .filter(Boolean);
    for (const cand of candidates) {
      const candShort = shortenPortName(cand).toLowerCase();
      if (candShort === snmpShort) return l;
      const candSlot = slotFromSnmpName(cand)?.slot ?? null;
      if (candSlot != null && candSlot === snmpSlot && /eth|gi|te|fa|swp/i.test(cand)) {
        return l;
      }
    }
  }
  return null;
}

function SnmpFrontPanel({
  lldpPorts,
  snmpPorts,
}: {
  lldpPorts: LldpDevicePort[];
  snmpPorts: SnmpPort[];
}) {
  const [selectedSnmpIndex, setSelectedSnmpIndex] = useState<number | null>(null);

  const slots: SnmpSlot[] = useMemo(() => {
    return snmpPorts
      .filter(isPhysicalSnmpPort)
      .map((p) => {
        const slot = slotFromSnmpName(p.name);
        const isSfp =
          (slot?.isSfp ?? false) ||
          /^(TenGigabit|FortyGigabit|HundredGigabit|TwentyFiveGigabit|XE|Te|Fo|Hu|Twe)/i.test(
            p.name,
          ) ||
          (p.speedBps !== null && p.speedBps >= 10_000_000_000);
        return {
          slot: slot?.slot ?? p.index,
          isSfp,
          snmp: p,
          shortName: shortenPortName(p.name),
          lldp: findLldpForSnmp(p, lldpPorts),
        } satisfies SnmpSlot;
      })
      .sort((a, b) => {
        if (a.isSfp !== b.isSfp) return a.isSfp ? 1 : -1;
        return a.slot - b.slot;
      });
  }, [snmpPorts, lldpPorts]);

  const rjSlots = slots.filter((s) => !s.isSfp);
  const sfpSlots = slots.filter((s) => s.isSfp);
  const selected = slots.find((s) => s.snmp.index === selectedSnmpIndex) ?? null;

  const upCount = slots.filter((s) => s.snmp.operStatus === "up").length;
  const downCount = slots.filter(
    (s) => s.snmp.operStatus === "down" && s.snmp.adminStatus === "up",
  ).length;
  const disabledCount = slots.filter(
    (s) => s.snmp.adminStatus !== "up" && s.snmp.adminStatus !== "unknown",
  ).length;
  const observedCount = slots.filter((s) => s.lldp).length;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-gradient-to-b from-zinc-900 to-[#0c0c0e] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_24px_-12px_rgba(0,0,0,0.6)]">
        <div className="flex items-center justify-between border-b border-white/[0.04] bg-black/30 px-4 py-2 text-[10.5px] uppercase tracking-[0.14em] text-zinc-500">
          <div className="flex items-center gap-3">
            <span>
              {slots.length}-port chassis
            </span>
            <span className="flex items-center gap-1">
              <LedDot tone="up" />
              <span className="text-emerald-300">{upCount}</span>
              <span className="ml-0.5 text-zinc-500">up</span>
            </span>
            <span className="flex items-center gap-1">
              <LedDot tone="down" />
              <span className="text-rose-300">{downCount}</span>
              <span className="ml-0.5 text-zinc-500">down</span>
            </span>
            {disabledCount > 0 ? (
              <span className="flex items-center gap-1">
                <LedDot tone="off" />
                <span className="text-zinc-400">{disabledCount}</span>
                <span className="ml-0.5 text-zinc-500">disabled</span>
              </span>
            ) : null}
            {observedCount > 0 ? (
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-400 ring-2 ring-sky-400/30" />
                <span className="text-sky-300">{observedCount}</span>
                <span className="ml-0.5 text-zinc-500">LLDP</span>
              </span>
            ) : null}
          </div>
          <span>front panel</span>
        </div>

        <div className="flex flex-wrap items-end gap-x-4 gap-y-3 px-5 py-5">
          <SnmpRjGrid slots={rjSlots} selectedIndex={selectedSnmpIndex} onSelect={setSelectedSnmpIndex} />
          {sfpSlots.length > 0 ? (
            <div className="ml-2 flex items-end gap-1 border-l border-white/[0.06] pl-3">
              {sfpSlots.map((s) => (
                <SnmpPortChip
                  key={s.snmp.index}
                  slot={s}
                  selected={selectedSnmpIndex === s.snmp.index}
                  onSelect={setSelectedSnmpIndex}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {selected ? (
        <SnmpPortDetailPanel slot={selected} onClose={() => setSelectedSnmpIndex(null)} />
      ) : null}

      <SnmpLegend />
    </div>
  );
}

function SnmpRjGrid({
  slots,
  selectedIndex,
  onSelect,
}: {
  slots: SnmpSlot[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
}) {
  const groups: SnmpSlot[][] = [];
  for (let i = 0; i < slots.length; i += 8) {
    groups.push(slots.slice(i, i + 8));
  }

  return (
    <div className="flex items-end gap-3">
      {groups.map((group, gi) => (
        <div key={gi} className="grid grid-flow-col grid-rows-2 gap-1.5">
          {group.map((s) => (
            <SnmpPortChip
              key={s.snmp.index}
              slot={s}
              selected={selectedIndex === s.snmp.index}
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function SnmpPortChip({
  slot,
  selected,
  onSelect,
}: {
  slot: SnmpSlot;
  selected: boolean;
  onSelect: (index: number | null) => void;
}) {
  const { snmp, isSfp, lldp } = slot;
  const isUp = snmp.operStatus === "up";
  const isAdminDown = snmp.adminStatus !== "up" && snmp.adminStatus !== "unknown";
  const isLinkDown = !isUp && !isAdminDown;
  const hasLldp = lldp !== null;

  const tone = (() => {
    if (isAdminDown) return "off";
    if (isUp) return "up";
    if (isLinkDown) return "down";
    return "off";
  })();

  const speedMbps = snmp.speedBps ? Math.round(snmp.speedBps / 1_000_000) : 0;

  const titleParts: string[] = [`Port ${slot.slot}: ${snmp.name}`];
  if (snmp.alias) titleParts.push(`alias=${snmp.alias}`);
  titleParts.push(`oper=${snmp.operStatus}`);
  titleParts.push(`admin=${snmp.adminStatus}`);
  if (speedMbps) titleParts.push(`${speedMbps >= 1000 ? `${speedMbps / 1000}G` : `${speedMbps}M`}`);
  if (lldp) titleParts.push(`LLDP→${lldp.connectedTo.agentHost}:${lldp.connectedTo.localInterface}`);

  return (
    <button
      aria-label={titleParts.join(" · ")}
      title={titleParts.join(" · ")}
      type="button"
      onClick={() => onSelect(selected ? null : snmp.index)}
      className="group flex flex-col items-center gap-0.5"
    >
      <span
        className={cn(
          "relative block overflow-hidden rounded-[3px] border transition-all duration-150",
          isSfp ? "h-9 w-5" : "h-7 w-7",
          tone === "up" && "border-emerald-400/40 bg-emerald-500/[0.12]",
          tone === "down" && "border-rose-500/30 bg-rose-500/[0.08]",
          tone === "off" && "border-white/[0.07] bg-white/[0.02]",
          selected && "ring-2 ring-sky-400 ring-offset-2 ring-offset-zinc-900",
          hasLldp && !selected && "ring-1 ring-sky-400/40",
        )}
      >
        {tone === "up" ? (
          <span
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-[3px] bg-[radial-gradient(circle_at_50%_0%,rgba(74,222,128,0.55),transparent_75%)]",
              hasLldp ? "animate-lldp-port-pulse" : "",
            )}
          />
        ) : null}
        {tone === "down" ? (
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-[3px] bg-[radial-gradient(circle_at_50%_0%,rgba(244,63,94,0.35),transparent_75%)]" />
        ) : null}
        {!isSfp ? (
          <span className="pointer-events-none absolute inset-x-1 bottom-0 h-[2px] rounded-b-[1px] bg-black/40" />
        ) : null}
        {isSfp ? (
          <span className="pointer-events-none absolute left-1/2 top-1 h-[7px] w-px -translate-x-1/2 bg-white/[0.08]" />
        ) : null}
      </span>
      <span
        className={cn(
          "text-[9px] font-medium tabular-nums",
          tone === "up" ? "text-zinc-200" : tone === "down" ? "text-rose-300/80" : "text-zinc-500",
          selected && "text-sky-300",
        )}
      >
        {slot.slot}
      </span>
    </button>
  );
}

function SnmpPortDetailPanel({
  slot,
  onClose,
}: {
  slot: SnmpSlot;
  onClose: () => void;
}) {
  const { snmp, lldp } = slot;
  const speedLabel = (() => {
    if (snmp.speedBps == null) return "—";
    const mbps = snmp.speedBps / 1_000_000;
    if (mbps >= 1000) return `${(mbps / 1000).toFixed(mbps % 1000 === 0 ? 0 : 1)} Gbps`;
    return `${Math.round(mbps)} Mbps`;
  })();
  const isUp = snmp.operStatus === "up";
  const isAdminDown = snmp.adminStatus !== "up" && snmp.adminStatus !== "unknown";

  return (
    <section
      className={cn(
        "rounded-xl border",
        isUp
          ? "border-emerald-500/20 bg-emerald-500/[0.04]"
          : isAdminDown
            ? "border-zinc-500/20 bg-zinc-500/[0.04]"
            : "border-rose-500/20 bg-rose-500/[0.04]",
      )}
    >
      <header
        className={cn(
          "flex items-center justify-between border-b px-4 py-2.5",
          isUp
            ? "border-emerald-500/15"
            : isAdminDown
              ? "border-zinc-500/15"
              : "border-rose-500/15",
        )}
      >
        <div className="flex items-center gap-2">
          <Cable
            className={cn(
              "h-3.5 w-3.5",
              isUp ? "text-emerald-300" : isAdminDown ? "text-zinc-300" : "text-rose-300",
            )}
          />
          <h3 className="text-[12.5px] font-medium text-zinc-100">
            {slot.shortName}
          </h3>
          <span className="text-[10.5px] text-zinc-500">{snmp.name}</span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium",
              isUp
                ? "bg-emerald-500/15 text-emerald-200"
                : isAdminDown
                  ? "bg-zinc-500/15 text-zinc-200"
                  : "bg-rose-500/15 text-rose-200",
            )}
          >
            {isAdminDown ? "disabled" : isUp ? "link up" : "link down"}
          </span>
        </div>
        <button
          aria-label="Close port detail"
          className="text-zinc-400 hover:text-zinc-200"
          onClick={onClose}
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      <dl className="grid grid-cols-1 gap-3 px-4 py-3 text-[12px] sm:grid-cols-3">
        <div>
          <dt className="text-[10.5px] uppercase tracking-[0.14em] text-zinc-500">
            Operational
          </dt>
          <dd className="mt-0.5 text-zinc-200">{snmp.operStatus}</dd>
        </div>
        <div>
          <dt className="text-[10.5px] uppercase tracking-[0.14em] text-zinc-500">
            Admin
          </dt>
          <dd className="mt-0.5 text-zinc-200">{snmp.adminStatus}</dd>
        </div>
        <div>
          <dt className="text-[10.5px] uppercase tracking-[0.14em] text-zinc-500">
            Speed
          </dt>
          <dd className="mt-0.5 text-zinc-200">{speedLabel}</dd>
        </div>
        {snmp.alias ? (
          <div className="sm:col-span-3">
            <dt className="text-[10.5px] uppercase tracking-[0.14em] text-zinc-500">
              Alias (ifAlias)
            </dt>
            <dd className="mt-0.5 text-zinc-200">{snmp.alias}</dd>
          </div>
        ) : null}
        {lldp ? (
          <div className="sm:col-span-3">
            <dt className="text-[10.5px] uppercase tracking-[0.14em] text-sky-300/70">
              LLDP neighbour from this site
            </dt>
            <dd className="mt-0.5 flex flex-wrap items-center gap-2">
              <ArrowDownToLine className="h-3 w-3 text-sky-300" />
              <span className="font-mono text-zinc-100">{lldp.connectedTo.agentHost}</span>
              <span className="text-zinc-500">·</span>
              <span className="font-mono text-zinc-300">{lldp.connectedTo.localInterface}</span>
              {lldp.vlanId != null ? (
                <span className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-200">
                  <Tag className="h-2.5 w-2.5" /> VLAN {lldp.vlanId}
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function LedDot({ tone }: { tone: "up" | "down" | "off" }) {
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 rounded-full",
        tone === "up" && "bg-emerald-400 shadow-[0_0_4px_rgba(74,222,128,0.7)]",
        tone === "down" && "bg-rose-400 shadow-[0_0_4px_rgba(244,63,94,0.6)]",
        tone === "off" && "bg-zinc-600",
      )}
    />
  );
}

function SnmpLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10.5px] text-zinc-500">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-[2px] border border-emerald-400/40 bg-emerald-500/[0.12]" />
        link up
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-[2px] border border-rose-500/30 bg-rose-500/[0.08]" />
        link down
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-[2px] border border-white/[0.07] bg-white/[0.02]" />
        admin disabled
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-[2px] border border-emerald-400/40 bg-emerald-500/[0.12] ring-1 ring-sky-400/40" />
        LLDP neighbour active
      </span>
    </div>
  );
}
