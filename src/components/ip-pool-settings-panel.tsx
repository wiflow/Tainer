"use client";

import { useActionState, useMemo, useState } from "react";
import { AlertTriangle, Plus, Trash2, X } from "lucide-react";

import { createIpPoolAction, deleteIpPoolAction } from "@/app/settings-actions";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { Form } from "@/components/ui/form";
import { initialActionState } from "@/lib/action-states";
import { getTagPillClass } from "@/lib/tag-utils";
import { useSiteBasePath } from "@/lib/use-site-path";
import { cn } from "@/lib/utils";

type AvailableTag = {
  color: string;
  name: string;
  slug: string;
};

type IpPoolUsage = {
  address: string;
  details?: string | null;
  deploymentId: string;
  deploymentLabel: string;
  service?: string | null;
  source: "ipam" | "tainer";
};

type IpPoolEntry = {
  availableAddresses: string[];
  availableCount: number;
  bridge: string;
  defaultDns: string;
  firstHost: string;
  gateway: string;
  hostPrefix: number;
  id: string;
  ipamIssue: string | null;
  ipamUsedAddresses: IpPoolUsage[];
  ipamUsedCount: number;
  lastHost: string;
  name: string;
  networkAddress: string;
  subnet: string;
  tagSlug: string | null;
  tainerUsedAddresses: IpPoolUsage[];
  tainerUsedCount: number;
  updatedAt: string;
  usableHostCount: number;
  usedAddresses: IpPoolUsage[];
  usedCount: number;
};

function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => acc * 256 + parseInt(octet, 10), 0);
}

function intToIp(n: number): string {
  return [
    Math.floor(n / 16777216) % 256,
    Math.floor(n / 65536) % 256,
    Math.floor(n / 256) % 256,
    n % 256,
  ].join(".");
}

type Cell = {
  ip: string;
  used: boolean;
  label: string | null;
  source: "tainer" | "ipam" | null;
};

function buildHeatmap(pool: IpPoolEntry): Cell[] {
  const firstInt = ipToInt(pool.firstHost);
  const lastInt = ipToInt(pool.lastHost);
  if (!Number.isFinite(firstInt) || !Number.isFinite(lastInt) || lastInt < firstInt) {
    return [];
  }
  const usageByIp = new Map<string, { label: string; source: "tainer" | "ipam" }>();
  for (const u of pool.ipamUsedAddresses) {
    usageByIp.set(u.address, {
      label: u.service || u.deploymentLabel || "in use (IPAM)",
      source: "ipam",
    });
  }
  for (const u of pool.tainerUsedAddresses) {
    usageByIp.set(u.address, {
      label: u.deploymentLabel || "in use",
      source: "tainer",
    });
  }
  const cells: Cell[] = [];
  for (let i = firstInt; i <= lastInt; i++) {
    const ip = intToIp(i);
    const usage = usageByIp.get(ip);
    cells.push({
      ip,
      used: Boolean(usage),
      label: usage?.label ?? null,
      source: usage?.source ?? null,
    });
  }
  return cells;
}

function PoolCard({
  pool,
  selected,
  onSelect,
}: {
  pool: IpPoolEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const cells = useMemo(() => buildHeatmap(pool), [pool]);
  const nextIp = pool.availableAddresses[0] ?? null;
  const usedCount = pool.usedCount;
  const totalCount = pool.usableHostCount;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex flex-col gap-3 rounded-xl border bg-zinc-950/40 px-4 py-4 text-left transition-all",
        "hover:bg-zinc-900/60 hover:border-white/10",
        selected
          ? "border-sky-400/40 ring-1 ring-sky-400/30 bg-zinc-900/60"
          : "border-white/[0.06]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px] font-semibold text-zinc-100">
            {pool.name}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
            {pool.subnet}
          </div>
        </div>
        <span className="shrink-0 text-[9.5px] font-medium uppercase tracking-[0.14em] text-zinc-500">
          Active
        </span>
      </div>

      <div
        className="grid gap-[2px]"
        style={{ gridTemplateColumns: "repeat(28, minmax(0, 1fr))" }}
      >
        {cells.map((cell) => (
          <span
            key={cell.ip}
            className={cn(
              "relative group/cell block aspect-square rounded-[2px]",
              cell.used
                ? cell.source === "ipam"
                  ? "bg-amber-300/80"
                  : "bg-zinc-300"
                : "bg-white/[0.04]",
            )}
          >
            <span
              className={cn(
                "pointer-events-none invisible absolute bottom-full left-1/2 z-20 mb-1.5",
                "-translate-x-1/2 rounded-md border border-white/10 bg-zinc-900/95 px-2 py-1",
                "text-[10.5px] font-mono whitespace-nowrap text-zinc-100 shadow-xl",
                "opacity-0 transition-opacity duration-75",
                "group-hover/cell:visible group-hover/cell:opacity-100",
              )}
            >
              {cell.ip}
              {cell.label ? (
                <>
                  <span className="text-zinc-600"> · </span>
                  <span
                    className={
                      cell.source === "ipam" ? "text-amber-300" : "text-sky-300"
                    }
                  >
                    {cell.label}
                  </span>
                </>
              ) : (
                <span className="text-zinc-500"> · free</span>
              )}
            </span>
          </span>
        ))}
      </div>

      <div className="mt-1 flex items-center justify-between text-[11.5px]">
        <span className="text-zinc-400">
          <span className="font-mono text-zinc-200">{usedCount}</span>
          <span className="text-zinc-600"> / </span>
          <span className="font-mono text-zinc-400">{totalCount}</span>
          <span className="ml-1 text-zinc-500">used</span>
        </span>
        {nextIp ? (
          <span className="text-zinc-500">
            next: <span className="font-mono text-zinc-300">{nextIp}</span>
          </span>
        ) : (
          <span className="text-rose-400/80">no free addresses</span>
        )}
      </div>
    </button>
  );
}

function PoolDetails({
  pool,
  tag,
  onClose,
}: {
  pool: IpPoolEntry;
  tag: AvailableTag | null;
  onClose: () => void;
}) {
  return (
    <section className="rounded-xl border border-sky-400/20 bg-sky-500/[0.03]">
      <header className="flex items-center justify-between border-b border-sky-400/15 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <h3 className="truncate font-mono text-[13px] font-semibold text-zinc-100">
            {pool.name}
          </h3>
          <span className="font-mono text-[11px] text-zinc-500">{pool.subnet}</span>
          {tag ? (
            <span
              className={`rounded-full border px-2 py-0.5 text-[10.5px] ${getTagPillClass(tag.color)}`}
            >
              {tag.name}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <IpPoolDeleteButton poolId={pool.id} poolName={pool.name} />
          <button
            aria-label="Close pool details"
            className="text-zinc-500 hover:text-zinc-200"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="space-y-4 px-4 py-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <CountTile label="Free" value={pool.availableCount} accent="emerald" />
          <CountTile label="Used (Tainer)" value={pool.tainerUsedCount} accent="sky" />
          <CountTile label="Used (IPAM)" value={pool.ipamUsedCount} accent="amber" />
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-md border border-white/[0.06] bg-black/30 px-4 py-3">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-zinc-500">
              Network defaults
            </p>
            <div className="mt-2 space-y-1.5 text-[12.5px] text-zinc-300">
              <p>
                Bridge: <span className="font-mono text-zinc-200">{pool.bridge}</span>
              </p>
              <p>
                Gateway:{" "}
                <span className="font-mono text-zinc-200">{pool.gateway || "Not set"}</span>
              </p>
              <p>
                DNS:{" "}
                <span className="font-mono text-zinc-200">{pool.defaultDns || "Not set"}</span>
              </p>
            </div>
          </div>
          <div className="rounded-md border border-white/[0.06] bg-black/30 px-4 py-3">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-zinc-500">
              Host range
            </p>
            <div className="mt-2 space-y-1.5 font-mono text-[12.5px] text-zinc-300">
              <p>
                Network: {pool.networkAddress}/{pool.hostPrefix}
              </p>
              <p>First host: {pool.firstHost}</p>
              <p>Last host: {pool.lastHost}</p>
            </div>
          </div>
        </div>

        {pool.ipamIssue ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/[0.05] px-4 py-3 text-[12px] text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-medium">IPAM lookup issue:</span> {pool.ipamIssue}
            </span>
          </div>
        ) : null}

        {pool.tainerUsedAddresses.length > 0 ? (
          <UsageList
            label="Currently used in Tainer"
            entries={pool.tainerUsedAddresses}
          />
        ) : null}

        {pool.ipamUsedAddresses.length > 0 ? (
          <UsageList label="Detected in IPAM" entries={pool.ipamUsedAddresses} />
        ) : null}

        <p className="text-[10.5px] text-zinc-500">
          Updated {new Date(pool.updatedAt).toLocaleString()}
        </p>
      </div>
    </section>
  );
}

function CountTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "emerald" | "sky" | "amber";
}) {
  const accentClass = {
    emerald: "text-emerald-300",
    sky: "text-sky-300",
    amber: "text-amber-300",
  }[accent];
  return (
    <div className="rounded-md border border-white/[0.06] bg-black/30 px-4 py-3">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </p>
      <p className={cn("mt-1 text-[20px] font-semibold tabular-nums", accentClass)}>
        {value}
      </p>
    </div>
  );
}

function UsageList({
  label,
  entries,
}: {
  label: string;
  entries: IpPoolUsage[];
}) {
  const visible = entries.slice(0, 8);
  const overflow = entries.length - visible.length;
  return (
    <div className="rounded-md border border-white/[0.06] bg-black/30 px-4 py-3">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </p>
      <div className="mt-2 grid gap-1 sm:grid-cols-2">
        {visible.map((entry) => (
          <div
            key={`${entry.source}:${entry.address}`}
            className="flex items-center justify-between gap-2 text-[12px]"
          >
            <span className="font-mono text-zinc-100">{entry.address}</span>
            <span className="truncate text-zinc-500">
              {entry.deploymentLabel || entry.service || "—"}
            </span>
          </div>
        ))}
      </div>
      {overflow > 0 ? (
        <p className="mt-2 text-[10.5px] text-zinc-500">+ {overflow} more</p>
      ) : null}
    </div>
  );
}

function IpPoolDeleteButton({
  poolId,
  poolName,
}: {
  poolId: string;
  poolName: string;
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    deleteIpPoolAction,
    initialActionState,
  );

  useActionTaskFeedback(state, {
    errorTitle: "IP pool deletion failed",
    successTitle: "IP pool deleted",
  });

  return (
    <Form action={formAction}>
      <input name="siteSlug" type="hidden" value={siteSlug} />
      <input name="poolId" type="hidden" value={poolId} />
      <input name="poolName" type="hidden" value={poolName} />
      <ConfirmSubmitButton
        className="h-8"
        consequences={[
          "Addresses already assigned to running guests keep working. They are not reclaimed.",
          "New deployments can no longer draw an address from this range.",
        ]}
        description={`Delete the IP pool "${poolName}"?`}
        disabled={isPending}
        pending={isPending}
        title="Delete IP pool"
        variant="ghost"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {isPending ? "Deleting…" : "Delete"}
      </ConfirmSubmitButton>
    </Form>
  );
}

function AddPoolForm({
  availableTags,
  onCancel,
  siteSlug,
}: {
  availableTags: AvailableTag[];
  onCancel: () => void;
  siteSlug: string;
}) {
  const [state, formAction, isPending] = useActionState(
    createIpPoolAction,
    initialActionState,
  );
  useActionTaskFeedback(state, {
    errorTitle: "IP pool save failed",
    successTitle: "IP pool saved",
  });

  const inputClassName =
    "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

  return (
    <section className="rounded-xl border border-white/[0.06] bg-zinc-950/40">
      <header className="flex items-center justify-between border-b border-white/[0.04] px-4 py-3">
        <div>
          <h3 className="text-[13px] font-medium text-zinc-100">Add IP pool</h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Add a named IPv4 subnet so operators can pick a free address from this pool
            during container creation.
          </p>
        </div>
        <button
          aria-label="Cancel add pool"
          className="text-zinc-500 hover:text-zinc-200"
          onClick={onCancel}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <Form action={formAction} className="space-y-4 px-4 py-4">
        <input name="siteSlug" type="hidden" value={siteSlug} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <label className="block">
            <span className="text-[12px] font-medium text-zinc-200">Pool name</span>
            <input className={inputClassName} name="name" placeholder="Office LAN" type="text" />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-zinc-200">Subnet</span>
            <input
              className={inputClassName}
              name="subnet"
              placeholder="10.0.10.0/24"
              type="text"
            />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-zinc-200">Bridge</span>
            <input
              className={inputClassName}
              defaultValue="vmbr0"
              name="bridge"
              placeholder="vmbr0"
              type="text"
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[12px] font-medium text-zinc-200">Gateway</span>
            <input
              className={inputClassName}
              name="gateway"
              placeholder="10.0.10.1"
              type="text"
            />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-zinc-200">Default DNS</span>
            <input
              className={inputClassName}
              name="defaultDns"
              placeholder="1.1.1.1, 8.8.8.8"
              type="text"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-[12px] font-medium text-zinc-200">Optional Tainer tag</span>
          <select className={inputClassName} defaultValue="" name="tagSlug">
            <option value="">No tag</option>
            {availableTags.map((tag) => (
              <option key={tag.slug} value={tag.slug}>
                {tag.name}
              </option>
            ))}
          </select>
          <span className="mt-1.5 block text-[11px] text-zinc-500">
            When selected, new containers created from this pool automatically get that
            managed Tainer tag.
          </span>
        </label>
        <div className="rounded-md border border-white/[0.06] bg-black/30 px-3 py-2 text-[11px] text-zinc-500">
          Pools are limited to 1024 usable IPv4 addresses so the full list stays fast to
          browse in launch forms.
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-3">
          <Button onClick={onCancel} type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={isPending} type="submit">
            <Plus className="h-3.5 w-3.5" />
            {isPending ? "Saving…" : "Create IP pool"}
          </Button>
        </div>
      </Form>
    </section>
  );
}

export function IpPoolSettingsPanel({
  availableTags,
  pools,
}: {
  availableTags: AvailableTag[];
  pools: IpPoolEntry[];
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const tagsBySlug = useMemo(
    () => new Map(availableTags.map((tag) => [tag.slug, tag])),
    [availableTags],
  );

  const totals = useMemo(() => {
    let used = 0;
    let total = 0;
    for (const p of pools) {
      used += p.usedCount;
      total += p.usableHostCount;
    }
    return { used, total };
  }, [pools]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const selectedPool = selectedId
    ? pools.find((p) => p.id === selectedId) ?? null
    : null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-zinc-50">IP pools</h2>
          <p className="mt-0.5 text-[12px] text-zinc-500">
            Named IPv4 subnets available for pool-based static container addressing.
            Click a pool to see who&apos;s using which address.
          </p>
        </div>
        <div className="font-mono text-[12px] text-zinc-400">
          <span className="text-zinc-200">{totals.used}</span>
          <span className="text-zinc-600"> / </span>
          <span>{totals.total}</span>
          <span className="ml-1 text-zinc-500">allocated</span>
        </div>
      </header>

      {pools.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-zinc-950/40 px-6 py-10 text-center text-[12.5px] text-zinc-500">
          No IP pools configured yet. Add one below to make pool-based addressing
          available in the deploy form.
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {pools.map((pool) => (
            <PoolCard
              key={pool.id}
              pool={pool}
              selected={selectedId === pool.id}
              onSelect={() =>
                setSelectedId((cur) => (cur === pool.id ? null : pool.id))
              }
            />
          ))}
        </div>
      )}

      {selectedPool ? (
        <PoolDetails
          pool={selectedPool}
          tag={
            selectedPool.tagSlug ? tagsBySlug.get(selectedPool.tagSlug) ?? null : null
          }
          onClose={() => setSelectedId(null)}
        />
      ) : null}

      {showAddForm ? (
        <AddPoolForm
          availableTags={availableTags}
          onCancel={() => setShowAddForm(false)}
          siteSlug={siteSlug}
        />
      ) : (
        <div>
          <Button
            onClick={() => setShowAddForm(true)}
            type="button"
            variant="secondary"
          >
            <Plus className="h-3.5 w-3.5" />
            Add IP pool
          </Button>
        </div>
      )}
    </div>
  );
}
