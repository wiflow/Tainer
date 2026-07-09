"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Shield, Tag, Unplug } from "lucide-react";

import { updateDeploymentNicAction } from "@/app/virtual-switch-actions";
import { useTaskToasts } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialBasicActionState } from "@/lib/action-states";
import type { VirtualPort } from "@/lib/virtual-switching";
import { cn } from "@/lib/utils";

export type PortRow = VirtualPort & { node: string };

function rowKey(row: PortRow): string {
  return `${row.deploymentId}:${row.netKey}`;
}

/**
 * Flat, searchable table of every guest NIC across all nodes — the operating
 * view next to the panel's looking view. With manage-deployments, rows are
 * selectable for a bulk VLAN retag; each NIC still goes through the same
 * audited single-NIC action.
 */
export function VirtualSwitchTable({
  rows,
  siteSlug,
  canManage,
  selectedKey,
  onOpenPort,
}: {
  rows: PortRow[];
  siteSlug: string;
  canManage: boolean;
  selectedKey: string | null;
  onOpenPort: (key: string) => void;
}) {
  const router = useRouter();
  const { pushToast } = useTaskToasts();
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkVlan, setBulkVlan] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [isApplying, startApplying] = useTransition();

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      [
        row.deploymentName,
        String(row.vmid),
        row.node,
        row.bridge,
        row.netKey,
        row.mac ?? "",
        row.ip ?? "",
        row.vlanTag != null ? String(row.vlanTag) : "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [rows, search]);

  const allVisibleChecked =
    filtered.length > 0 && filtered.every((row) => checked.has(rowKey(row)));

  const toggleAllVisible = () => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allVisibleChecked) {
        for (const row of filtered) next.delete(rowKey(row));
      } else {
        for (const row of filtered) next.add(rowKey(row));
      }
      return next;
    });
  };

  const toggleOne = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const applyBulkVlan = () => {
    const targets = rows.filter((row) => checked.has(rowKey(row)));
    if (targets.length === 0) return;
    const vlan = bulkVlan.trim();

    startApplying(async () => {
      let ok = 0;
      const failures: string[] = [];
      // Sequential on purpose — each change is an individual audited config
      // PUT against Proxmox; hammering them in parallel risks digest races
      // on guests with several NICs.
      for (let i = 0; i < targets.length; i++) {
        const row = targets[i];
        setProgress(`${i + 1}/${targets.length} — ${row.deploymentName} ${row.netKey}`);
        const fd = new FormData();
        fd.set("siteSlug", siteSlug);
        fd.set("deploymentId", row.deploymentId);
        fd.set("netKey", row.netKey);
        fd.set("vlanTag", vlan);
        const result = await updateDeploymentNicAction(initialBasicActionState, fd);
        if (result.status === "success") ok++;
        else failures.push(`${row.deploymentName} ${row.netKey}: ${result.message}`);
      }
      setProgress(null);
      setChecked(new Set());
      if (failures.length === 0) {
        pushToast({
          title: vlan ? `VLAN ${vlan} applied` : "VLAN cleared",
          message: `${ok} interface${ok === 1 ? "" : "s"} updated.`,
          variant: "success",
        });
      } else {
        pushToast({
          title: "Bulk VLAN change finished with errors",
          message: `${ok} updated, ${failures.length} failed.\n${failures.slice(0, 3).join("\n")}`,
          variant: "error",
        });
      }
      router.refresh();
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-[#111113]">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/5 px-3 py-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Filter by name, VMID, bridge, VLAN, IP, MAC…"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            className="h-8 bg-black/30 pl-9 text-[12.5px]"
          />
        </div>
        <span className="text-[11.5px] tabular-nums text-zinc-500">
          {filtered.length} of {rows.length} interfaces
        </span>
      </div>

      {canManage && checked.size > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-white/5 bg-sky-500/[0.04] px-3 py-2">
          <span className="text-[12px] text-zinc-200 tabular-nums">
            {checked.size} selected
          </span>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <Tag className="h-3 w-3" />
            <input
              value={bulkVlan}
              onChange={(e) => setBulkVlan(e.target.value)}
              placeholder="VLAN (empty = clear)"
              inputMode="numeric"
              className="h-7 w-36 rounded-md border border-white/10 bg-black/40 px-2 text-[12px] text-zinc-100 outline-none focus:border-zinc-500"
            />
          </label>
          <Button size="sm" variant="secondary" disabled={isApplying} onClick={applyBulkVlan}>
            {isApplying ? "Applying…" : bulkVlan.trim() ? `Set VLAN ${bulkVlan.trim()}` : "Clear VLAN"}
          </Button>
          <button
            type="button"
            className="text-[11px] text-zinc-500 hover:text-zinc-300"
            onClick={() => setChecked(new Set())}
          >
            Clear selection
          </button>
          {progress ? (
            <span className="text-[11px] tabular-nums text-sky-300">{progress}</span>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-white/5 bg-black/40 text-zinc-400">
              {canManage ? (
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allVisibleChecked}
                    onChange={toggleAllVisible}
                    className="h-3.5 w-3.5 accent-sky-500"
                    aria-label="Select all visible"
                  />
                </th>
              ) : null}
              <th className="px-3 py-2 font-medium">Port</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Node</th>
              <th className="px-3 py-2 font-medium">Bridge</th>
              <th className="px-3 py-2 font-medium">VLAN</th>
              <th className="px-3 py-2 font-medium">IP</th>
              <th className="px-3 py-2 font-medium">MAC</th>
              <th className="px-3 py-2 font-medium">Rate</th>
              <th className="px-3 py-2 font-medium">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filtered.map((row) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  className={cn(
                    "transition-colors hover:bg-white/[0.04]",
                    selectedKey === key && "bg-sky-500/[0.06]",
                  )}
                >
                  {canManage ? (
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        checked={checked.has(key)}
                        onChange={() => toggleOne(key)}
                        className="h-3.5 w-3.5 accent-sky-500"
                        aria-label={`Select ${row.deploymentName} ${row.netKey}`}
                      />
                    </td>
                  ) : null}
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px] text-zinc-400">
                    {row.guestType === "qemu" ? "VM" : "CT"} {row.vmid} · {row.netKey}
                  </td>
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => onOpenPort(key)}
                      className="max-w-[180px] truncate text-left text-zinc-200 hover:text-white hover:underline"
                      title="Open port details"
                    >
                      {row.deploymentName}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px] text-zinc-500">
                    {row.node}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px] text-zinc-400">
                    {row.bridge}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-zinc-300">
                    {row.vlanTag ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px] text-zinc-400">
                    {row.ip ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px] text-zinc-500">
                    {row.mac ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-zinc-400">
                    {row.rateMbps != null ? `${row.rateMbps} MB/s` : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      {row.linkDown ? (
                        <span className="inline-flex items-center gap-1 text-rose-300">
                          <Unplug className="h-3 w-3" /> link down
                        </span>
                      ) : row.running ? (
                        <span className="text-emerald-300">up</span>
                      ) : (
                        <span className="text-zinc-500">stopped</span>
                      )}
                      {row.firewall ? (
                        <Shield className="h-3 w-3 text-zinc-500" aria-label="Firewall on" />
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={canManage ? 10 : 9}
                  className="px-3 py-6 text-center text-[12px] text-zinc-500"
                >
                  No interfaces match the filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
