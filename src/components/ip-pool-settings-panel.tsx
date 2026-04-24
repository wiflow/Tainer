"use client";

import { useActionState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { createIpPoolAction, deleteIpPoolAction } from "@/app/settings-actions";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { SectionPanel } from "@/components/ui/section-panel";
import { Form } from "@/components/ui/form";
import { initialActionState } from "@/lib/action-states";
import { getTagPillClass } from "@/lib/tag-utils";
import { useSiteBasePath } from "@/lib/use-site-path";

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
    <Form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(`Delete IP pool "${poolName}"?`)) {
          event.preventDefault();
        }
      }}
    >
      <input name="siteSlug" type="hidden" value={siteSlug} />
      <input name="poolId" type="hidden" value={poolId} />
      <input name="poolName" type="hidden" value={poolName} />
      <Button disabled={isPending} size="sm" type="submit" variant="ghost">
        <Trash2 className="h-3.5 w-3.5" />
        {isPending ? "Deleting..." : "Delete"}
      </Button>
    </Form>
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
  const tagsBySlug = new Map(availableTags.map((tag) => [tag.slug, tag]));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_0.95fr]">
      <SectionPanel
        title="IP pools"
        description="Add a named IPv4 subnet and let operators pick a free address from that pool during container creation."
      >
          <Form action={formAction} className="space-y-5">
            <input name="siteSlug" type="hidden" value={siteSlug} />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Pool name</span>
                <input
                  className={inputClassName}
                  name="name"
                  placeholder="Office LAN"
                  type="text"
                />
              </label>

              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Subnet</span>
                <input
                  className={inputClassName}
                  name="subnet"
                  placeholder="10.0.10.0/24"
                  type="text"
                />
              </label>

              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Bridge</span>
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
              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Gateway</span>
                <input
                  className={inputClassName}
                  name="gateway"
                  placeholder="10.0.10.1"
                  type="text"
                />
              </label>

              <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <span className="text-[13px] font-medium text-zinc-200">Default DNS</span>
                <input
                  className={inputClassName}
                  name="defaultDns"
                  placeholder="1.1.1.1, 8.8.8.8"
                  type="text"
                />
              </label>
            </div>

            <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Optional Tainer tag</span>
              <select className={inputClassName} defaultValue="" name="tagSlug">
                <option value="">No tag</option>
                {availableTags.map((tag) => (
                  <option key={tag.slug} value={tag.slug}>
                    {tag.name}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-[11px] text-zinc-500">
                When selected, new containers created from this pool automatically get that managed Tainer tag.
              </p>
            </label>

            <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3 text-[12px] text-zinc-500">
              Pools are limited to 1024 usable IPv4 addresses so the full list stays fast to browse in launch forms.
            </div>

            <div className="flex gap-2 border-t border-white/5 pt-4">
              <Button disabled={isPending} type="submit">
                <Plus className="h-3.5 w-3.5" />
                {isPending ? "Saving..." : "Create IP pool"}
              </Button>
            </div>
          </Form>
      </SectionPanel>

      <SectionPanel
        title="Configured pools"
        description="Live free and used counts are calculated from the current deployment inventory and IPAM reservations."
        noPadding
      >
        <div className="divide-y divide-white/5">
          {pools.length === 0 ? (
            <div className="px-4 py-3 text-[13px] text-zinc-500">
              No IP pools configured yet.
            </div>
          ) : (
            pools.map((pool) => {
              const tag = pool.tagSlug ? tagsBySlug.get(pool.tagSlug) ?? null : null;

              return (
                <div key={pool.id} className="px-4 py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[14px] font-semibold text-zinc-100">{pool.name}</p>
                        <span className="rounded-full border border-white/5 bg-zinc-900/70 px-2 py-0.5 text-[11px] text-zinc-400">
                          {pool.subnet}
                        </span>
                        {tag ? (
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${getTagPillClass(tag.color)}`}>
                            {tag.name}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[12px] text-zinc-500">
                        {pool.availableCount} free of {pool.usableHostCount} usable IPs · {pool.bridge}
                      </p>
                    </div>
                    <IpPoolDeleteButton poolId={pool.id} poolName={pool.name} />
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-md border border-white/5 bg-black/40 px-4 py-3">
                      <p className="text-[11px] font-medium text-zinc-500">Free</p>
                      <p className="mt-1 text-[18px] font-semibold text-emerald-300">{pool.availableCount}</p>
                    </div>
                    <div className="rounded-md border border-white/5 bg-black/40 px-4 py-3">
                      <p className="text-[11px] font-medium text-zinc-500">Used in Tainer</p>
                      <p className="mt-1 text-[18px] font-semibold text-sky-300">{pool.tainerUsedCount}</p>
                    </div>
                    <div className="rounded-md border border-white/5 bg-black/40 px-4 py-3">
                      <p className="text-[11px] font-medium text-zinc-500">Used in IPAM</p>
                      <p className="mt-1 text-[18px] font-semibold text-amber-300">{pool.ipamUsedCount}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
                    <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                      <p className="text-[11px] font-medium text-zinc-500">Network defaults</p>
                      <div className="mt-2 space-y-2 text-[13px] text-zinc-300">
                        <p className="break-all">Bridge: {pool.bridge}</p>
                        <p className="break-all">Gateway: {pool.gateway || "Not set"}</p>
                        <p className="break-all">DNS: {pool.defaultDns || "Not set"}</p>
                      </div>
                    </div>

                    <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                      <p className="text-[11px] font-medium text-zinc-500">Host range</p>
                      <div className="mt-2 space-y-1 text-[13px] text-zinc-300">
                        <p>Network: {pool.networkAddress}/{pool.hostPrefix}</p>
                        <p>First host: {pool.firstHost}</p>
                        <p>Last host: {pool.lastHost}</p>
                      </div>
                    </div>
                  </div>

                  {pool.ipamIssue ? (
                    <div className="mt-4 rounded-md border border-amber-900/70 bg-amber-950/30 px-4 py-3 text-[12px] text-amber-300">
                      IPAM lookup issue: {pool.ipamIssue}
                    </div>
                  ) : null}

                  {pool.tainerUsedAddresses.length > 0 ? (
                    <div className="mt-4 rounded-md border border-white/5 bg-zinc-950/60 px-4 py-3">
                      <p className="text-[11px] font-medium text-zinc-500">Currently used in Tainer</p>
                      <div className="mt-2 space-y-1 text-[12px] text-zinc-400">
                        {pool.tainerUsedAddresses.slice(0, 6).map((entry) => (
                          <p key={`${pool.id}:${entry.address}`}>
                            {entry.address} · {entry.deploymentLabel}
                          </p>
                        ))}
                        {pool.tainerUsedAddresses.length > 6 ? (
                          <p>+ {pool.tainerUsedAddresses.length - 6} more</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {pool.ipamUsedAddresses.length > 0 ? (
                    <div className="mt-4 rounded-md border border-white/5 bg-zinc-950/60 px-4 py-3">
                      <p className="text-[11px] font-medium text-zinc-500">Detected in IPAM</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {pool.ipamUsedAddresses.slice(0, 6).map((entry) => (
                          <div
                            key={`${pool.id}:ipam:${entry.address}`}
                            className="rounded-md border border-white/5 bg-[#111113] px-3 py-3"
                          >
                            <p className="font-mono text-[13px] text-zinc-100">{entry.address}</p>
                            {entry.service ? (
                              <p className="mt-1 break-words text-[12px] text-zinc-400">{entry.service}</p>
                            ) : null}
                          </div>
                        ))}
                        {pool.ipamUsedAddresses.length > 6 ? (
                          <div className="rounded-md border border-dashed border-white/5 bg-zinc-900/20 px-3 py-3">
                            <p className="text-[12px] text-zinc-500">+ {pool.ipamUsedAddresses.length - 6} more</p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <p className="mt-3 text-[11px] text-zinc-500">
                    Updated {new Date(pool.updatedAt).toLocaleString()}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </SectionPanel>
    </div>
  );
}
