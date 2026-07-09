"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Box,
  Cable,
  ExternalLink,
  Gauge,
  LoaderCircle,
  Plug,
  Server,
  Shield,
  Tag,
  Unplug,
  X,
} from "lucide-react";

import { updateDeploymentNicAction } from "@/app/virtual-switch-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { VirtualSwitchTable, type PortRow } from "@/components/virtual-switch-table";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type {
  BridgeSection,
  VirtualPort,
  VirtualSwitchNode,
} from "@/lib/virtual-switching";
import { cn } from "@/lib/utils";

type Props = {
  nodes: VirtualSwitchNode[];
  siteSlug: string;
  canManage: boolean;
};

function portKey(port: VirtualPort): string {
  return `${port.deploymentId}:${port.netKey}`;
}

/** Deterministic accent per VLAN id so ports on the same VLAN read as a
 *  group at a glance — same trick UniFi uses with per-network colors. */
const VLAN_ACCENTS = [
  "text-sky-300 bg-sky-500/15 border-sky-500/25",
  "text-violet-300 bg-violet-500/15 border-violet-500/25",
  "text-amber-300 bg-amber-500/15 border-amber-500/25",
  "text-cyan-300 bg-cyan-500/15 border-cyan-500/25",
  "text-fuchsia-300 bg-fuchsia-500/15 border-fuchsia-500/25",
  "text-lime-300 bg-lime-500/15 border-lime-500/25",
];

function vlanAccent(tag: number): string {
  return VLAN_ACCENTS[tag % VLAN_ACCENTS.length];
}

export function VirtualSwitchPanel({ nodes, siteSlug, canManage }: Props) {
  const router = useRouter();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [state, formAction, isPending] = useActionState(
    updateDeploymentNicAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(state, {
    errorTitle: "Interface update failed",
    successTitle: "Interface updated",
  });

  // Re-pull the server-rendered overview once a change lands so chips and
  // the table reflect the new config without a manual reload.
  const handledRequestId = useRef("");
  useEffect(() => {
    if (
      state.status === "success" &&
      state.requestId &&
      state.requestId !== handledRequestId.current
    ) {
      handledRequestId.current = state.requestId;
      router.refresh();
    }
  }, [state.status, state.requestId, router]);

  const allPorts = useMemo<PortRow[]>(
    () =>
      nodes.flatMap((n) =>
        n.bridges.flatMap((b) => b.ports.map((p) => ({ ...p, node: n.node }))),
      ),
    [nodes],
  );
  const selectedPort =
    allPorts.find((p) => portKey(p) === selectedKey) ?? null;

  if (allPorts.length === 0 && nodes.every((n) => n.bridges.length === 0)) {
    return (
      <p className="rounded-lg border border-dashed border-white/10 bg-zinc-950/40 px-4 py-6 text-center text-[12px] text-zinc-500">
        No bridges or guest interfaces visible. Deploy a container or VM to see
        its virtual port here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {nodes.map((node) => (
        <NodeChassis
          key={node.node}
          node={node}
          selectedKey={selectedKey}
          onSelect={(key) => setSelectedKey(key === selectedKey ? null : key)}
        />
      ))}

      {selectedPort ? (
        <PortDetail
          key={portKey(selectedPort)}
          port={selectedPort}
          node={selectedPort.node}
          siteSlug={siteSlug}
          canManage={canManage}
          formAction={formAction}
          isPending={isPending}
          onClose={() => setSelectedKey(null)}
        />
      ) : null}

      <Legend />

      {allPorts.length > 0 ? (
        <VirtualSwitchTable
          rows={allPorts}
          siteSlug={siteSlug}
          canManage={canManage}
          selectedKey={selectedKey}
          onOpenPort={(key) => setSelectedKey(key === selectedKey ? null : key)}
        />
      ) : null}
    </div>
  );
}

function NodeChassis({
  node,
  selectedKey,
  onSelect,
}: {
  node: VirtualSwitchNode;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const portCount = node.bridges.reduce((acc, b) => acc + b.ports.length, 0);
  return (
    <div className="rounded-xl border border-white/[0.08] bg-gradient-to-b from-zinc-900 to-zinc-950 shadow-inner">
      <div className="flex items-center gap-2.5 border-b border-white/[0.05] px-4 py-2.5">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            node.online
              ? "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
              : "bg-zinc-600",
          )}
        />
        <span className="text-[13px] font-medium text-zinc-100">{node.node}</span>
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-zinc-600">
          virtual switch
        </span>
        <span className="ml-auto text-[11px] tabular-nums text-zinc-500">
          {node.bridges.length} {node.bridges.length === 1 ? "bridge" : "bridges"} ·{" "}
          {portCount} {portCount === 1 ? "port" : "ports"}
        </span>
      </div>

      {node.configError ? (
        <p className="px-4 py-2 text-[11px] text-amber-300/80">{node.configError}</p>
      ) : null}

      <div className="space-y-3 px-4 py-3">
        {node.bridges.map((bridge) => (
          <BridgeStrip
            key={bridge.name}
            bridge={bridge}
            selectedKey={selectedKey}
            onSelect={onSelect}
          />
        ))}
        {node.bridges.length === 0 && !node.configError ? (
          <p className="py-1 text-[11.5px] text-zinc-600">No bridges defined.</p>
        ) : null}
      </div>
    </div>
  );
}

function BridgeStrip({
  bridge,
  selectedKey,
  onSelect,
}: {
  bridge: BridgeSection;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11.5px] text-zinc-300">{bridge.name}</span>
        {bridge.cidr ? (
          <span className="font-mono text-[10.5px] text-zinc-500">{bridge.cidr}</span>
        ) : null}
        {bridge.vlanAware ? (
          <span className="rounded border border-sky-500/25 bg-sky-500/10 px-1.5 py-px text-[9.5px] uppercase tracking-wide text-sky-300">
            VLAN aware
          </span>
        ) : null}
        {bridge.missing ? (
          <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-px text-[9.5px] uppercase tracking-wide text-amber-300">
            not in node config
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="flex flex-wrap gap-1.5">
          {bridge.ports.map((port) => (
            <GuestPortChip
              key={portKey(port)}
              port={port}
              showVlanRow={bridge.ports.some((p) => p.vlanTag != null)}
              selected={selectedKey === portKey(port)}
              onClick={() => onSelect(portKey(port))}
            />
          ))}
          {bridge.ports.length === 0 ? (
            <span className="py-2 text-[11px] text-zinc-600">
              No guest interfaces on this bridge.
            </span>
          ) : null}
        </div>

        {bridge.uplinks.length > 0 ? (
          // mt aligns uplink tiles with the port chips (below the name row).
          <div className="ml-1 mt-[18px] flex gap-1.5 border-l border-white/[0.06] pl-3">
            {bridge.uplinks.map((uplink) => (
              <div
                key={uplink.iface}
                title={`Physical uplink ${uplink.iface} (${uplink.active ? "active" : "inactive"})`}
                className={cn(
                  "flex h-[52px] w-16 flex-col items-center justify-center gap-1 rounded-md border",
                  uplink.active
                    ? "border-sky-500/30 bg-sky-500/[0.08] text-sky-300"
                    : "border-white/[0.08] bg-white/[0.02] text-zinc-600",
                )}
              >
                <Cable className="h-3.5 w-3.5" />
                <span className="max-w-full truncate px-1 font-mono text-[9.5px]">
                  {uplink.iface}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function GuestPortChip({
  port,
  showVlanRow,
  selected,
  onClick,
}: {
  port: VirtualPort;
  /** Render the VLAN badge row only when at least one port on the bridge is
   *  tagged — an all-untagged bridge gets clean chips with nothing dangling. */
  showVlanRow: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const GuestIcon = port.guestType === "qemu" ? Server : Box;
  const tone = port.linkDown
    ? "border-rose-500/35 bg-rose-500/[0.08] text-rose-300"
    : port.running
      ? "border-emerald-500/40 bg-gradient-to-b from-emerald-500/25 to-emerald-500/10 text-emerald-200"
      : "border-white/[0.08] bg-white/[0.03] text-zinc-500";

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${port.deploymentName} — ${port.guestType === "qemu" ? "VM" : "CT"} ${port.vmid} ${port.netKey}`}
      className="group flex w-16 flex-col items-center gap-1"
    >
      <span className="w-full truncate text-center text-[9.5px] leading-tight text-zinc-500 group-hover:text-zinc-300 transition-colors">
        {port.deploymentName}
      </span>
      <span
        className={cn(
          "relative flex h-[42px] w-[46px] flex-col items-center justify-center rounded-md border transition-colors",
          tone,
          selected && "ring-2 ring-sky-400 ring-offset-2 ring-offset-zinc-950",
        )}
      >
        {port.linkDown ? (
          <Unplug className="absolute right-0.5 top-0.5 h-2.5 w-2.5 text-rose-300" />
        ) : port.firewall ? (
          <Shield className="absolute right-0.5 top-0.5 h-2.5 w-2.5 opacity-70" />
        ) : null}
        <span className="flex items-center gap-0.5">
          <GuestIcon className="h-2.5 w-2.5 opacity-70" />
          <span className="text-[11px] font-medium tabular-nums">{port.vmid}</span>
        </span>
        {port.netKey !== "net0" ? (
          <span className="font-mono text-[8px] opacity-70">{port.netKey}</span>
        ) : null}
      </span>
      {showVlanRow ? (
        port.vlanTag != null ? (
          <span
            className={cn(
              "rounded border px-1 py-px text-[8.5px] tabular-nums leading-none",
              vlanAccent(port.vlanTag),
            )}
          >
            {port.vlanTag}
          </span>
        ) : (
          // Invisible spacer keeps chips on a mixed bridge vertically aligned.
          <span aria-hidden className="h-[13px]" />
        )
      ) : null}
    </button>
  );
}

function PortDetail({
  port,
  node,
  siteSlug,
  canManage,
  formAction,
  isPending,
  onClose,
}: {
  port: VirtualPort;
  node: string;
  siteSlug: string;
  canManage: boolean;
  formAction: (formData: FormData) => void;
  isPending: boolean;
  onClose: () => void;
}) {
  const guestLabel = port.guestType === "qemu" ? "VM" : "CT";
  // Keyed remount below resets these when another port is selected.
  const [vlanDraft, setVlanDraft] = useState(
    port.vlanTag != null ? String(port.vlanTag) : "",
  );
  const [rateDraft, setRateDraft] = useState(
    port.rateMbps != null ? String(port.rateMbps) : "",
  );
  const [firewallDraft, setFirewallDraft] = useState(port.firewall);

  const hidden = (
    <>
      <input name="siteSlug" type="hidden" value={siteSlug} />
      <input name="deploymentId" type="hidden" value={port.deploymentId} />
      <input name="netKey" type="hidden" value={port.netKey} />
    </>
  );

  return (
    <div className="rounded-xl border border-white/[0.08] bg-zinc-950/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-zinc-100">
              {port.deploymentName}
            </span>
            <span className="rounded border border-white/10 bg-black/40 px-1.5 py-0.5 font-mono text-[10.5px] text-zinc-400">
              {guestLabel} {port.vmid} · {port.netKey}
            </span>
            <Link
              href={`/sites/${siteSlug}/deployments/${port.deploymentId}`}
              className="inline-flex items-center gap-1 text-[11px] text-sky-300 hover:text-sky-200"
            >
              <ExternalLink className="h-3 w-3" /> open deployment
            </Link>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11.5px] sm:grid-cols-3">
            <DetailField label="Node" value={node} mono />
            <DetailField label="Bridge" value={port.bridge} mono />
            <DetailField label="Guest interface" value={port.iface ?? "—"} mono />
            <DetailField label="MAC" value={port.mac ?? "—"} mono />
            <DetailField label="Configured IP" value={port.ip ?? "—"} mono />
            <DetailField
              label="State"
              value={
                port.linkDown
                  ? "link forced down"
                  : port.running
                    ? "up"
                    : "guest stopped"
              }
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
          aria-label="Close port details"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {canManage ? (
        <div className="mt-3 flex flex-wrap items-end gap-4 border-t border-white/[0.06] pt-3">
          <Form action={formAction}>
            {hidden}
            <input name="linkDown" type="hidden" value={port.linkDown ? "0" : "1"} />
            <Button
              disabled={isPending}
              size="sm"
              type="submit"
              variant={port.linkDown ? "success" : "danger"}
            >
              {isPending ? (
                <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : port.linkDown ? (
                <Plug className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Unplug className="mr-1.5 h-3.5 w-3.5" />
              )}
              {port.linkDown ? "Reconnect link" : "Disconnect link"}
            </Button>
          </Form>

          <Form action={formAction} className="flex flex-wrap items-end gap-3">
            {hidden}
            <label className="flex flex-col gap-1 text-[10.5px] text-zinc-500">
              <span className="inline-flex items-center gap-1">
                <Tag className="h-3 w-3" /> VLAN tag
              </span>
              <input
                name="vlanTag"
                value={vlanDraft}
                onChange={(e) => setVlanDraft(e.target.value)}
                placeholder="none"
                inputMode="numeric"
                className="h-8 w-24 rounded-md border border-white/10 bg-black/40 px-2 text-[12px] text-zinc-100 outline-none focus:border-zinc-500"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10.5px] text-zinc-500">
              <span className="inline-flex items-center gap-1">
                <Gauge className="h-3 w-3" /> Rate limit (MB/s)
              </span>
              <input
                name="rateMbps"
                value={rateDraft}
                onChange={(e) => setRateDraft(e.target.value)}
                placeholder="unlimited"
                inputMode="decimal"
                className="h-8 w-28 rounded-md border border-white/10 bg-black/40 px-2 text-[12px] text-zinc-100 outline-none focus:border-zinc-500"
              />
            </label>
            <label className="flex h-8 items-center gap-1.5 text-[11.5px] text-zinc-300">
              <input
                type="checkbox"
                checked={firewallDraft}
                onChange={(e) => setFirewallDraft(e.target.checked)}
                className="h-3.5 w-3.5 accent-emerald-500"
              />
              <Shield className="h-3 w-3 text-zinc-500" /> Firewall
            </label>
            <input name="firewall" type="hidden" value={firewallDraft ? "1" : "0"} />
            <Button disabled={isPending} size="sm" type="submit" variant="secondary">
              {isPending ? (
                <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Apply
            </Button>
          </Form>
        </div>
      ) : (
        <p className="mt-3 border-t border-white/[0.06] pt-3 text-[11px] text-zinc-600">
          You need the &quot;Manage deployments&quot; permission on this site to change
          link state, VLAN, rate, or firewall settings.
        </p>
      )}
      <p className="mt-2 text-[10.5px] text-zinc-600">
        Changes apply live via the Proxmox API — a running guest keeps its other
        interface settings (IP, MAC, MTU) untouched.
      </p>
    </div>
  );
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[9.5px] uppercase tracking-[0.14em] text-zinc-600">
        {label}
      </div>
      <div className={cn("truncate text-zinc-200", mono && "font-mono text-[11px]")}>
        {value}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[10.5px] text-zinc-500">
      <LegendItem swatch="border-emerald-500/40 bg-emerald-500/20" label="Running" />
      <LegendItem swatch="border-white/[0.08] bg-white/[0.03]" label="Guest stopped" />
      <LegendItem swatch="border-rose-500/35 bg-rose-500/[0.08]" label="Link forced down" />
      <span className="inline-flex items-center gap-1.5">
        <Shield className="h-3 w-3" /> Firewall on
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Tag className="h-3 w-3" /> VLAN tag below port
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Cable className="h-3 w-3" /> Physical uplink
      </span>
    </div>
  );
}

function LegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-3 w-3 rounded-sm border", swatch)} />
      {label}
    </span>
  );
}
