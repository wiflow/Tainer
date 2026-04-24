"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { CopyableText } from "@/components/copyable-text";
import { CreateDeploymentMenu } from "@/components/create-deployment-menu";
import { DeploymentTagList } from "@/components/deployment-tag-list";
import { DeploymentQuickActions } from "@/components/deployment-quick-actions";
import { DeploymentStatusBadge } from "@/components/deployment-status-badge";
import { Pagination } from "@/components/pagination";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TAG_PREFIX, type ManagedTagDefinition } from "@/lib/tag-utils";
import type { LiveDeployment } from "@/lib/proxmox";
import { useSiteBasePath } from "@/lib/use-site-path";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

function getStatusAccent(status: string) {
  if (status === "running") return "bg-emerald-500";
  if (status === "stopped") return "bg-zinc-600";
  if (status === "paused") return "bg-amber-500";
  return "bg-blue-500";
}

export function DeploymentsBoard({ deployments, updateMap = {}, tags = [] }: { deployments: LiveDeployment[]; updateMap?: Record<string, boolean>; tags?: ManagedTagDefinition[] }) {
  const siteBase = useSiteBasePath();
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "lxc" | "qemu">("");
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search);

  const filteredDeployments = useMemo(() => {
    let filtered = deployments;

    // Type filter
    if (typeFilter) {
      filtered = filtered.filter((d) => d.type === typeFilter);
    }

    // Tag filter
    if (tagFilter === "__untagged__") {
      filtered = filtered.filter((d) => !d.tagList.some((t) => t.startsWith(TAG_PREFIX)));
    } else if (tagFilter) {
      filtered = filtered.filter((d) => d.tagList.includes(`${TAG_PREFIX}${tagFilter}`));
    }

    // Text search
    const term = deferredSearch.trim().toLowerCase();
    if (term) {
      filtered = filtered.filter(
        (d) =>
          d.name.toLowerCase().includes(term) ||
          d.node.toLowerCase().includes(term) ||
          d.ipAddress.toLowerCase().includes(term) ||
          d.templateName.toLowerCase().includes(term) ||
          d.tagList.some((tag) => tag.toLowerCase().includes(term)) ||
          String(d.vmid).includes(term),
      );
    }

    return filtered;
  }, [deployments, deferredSearch, tagFilter, typeFilter]);

  const totalPages = Math.ceil(filteredDeployments.length / PAGE_SIZE);
  const currentPage = Math.min(page, totalPages || 1);
  const paginatedDeployments = filteredDeployments.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  // Reset to page 1 when search changes
  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleTagFilter = (value: string) => {
    setTagFilter(value);
    setPage(1);
  };

  const handleTypeFilter = (value: string) => {
    setTypeFilter(value as "" | "lxc" | "qemu");
    setPage(1);
  };

  if (deployments.length === 0) {
    return (
      <div className="rounded-2xl border border-white/5 bg-[#111113] p-10 text-center">
        <p className="text-sm font-medium text-zinc-200">
          No containers or VMs are visible right now.
        </p>
        <p className="mt-2 text-[13px] text-zinc-400">
          Deploy from a saved template or create a virtual machine to get started.
        </p>
        <div className="mt-5 flex items-center justify-center">
          <CreateDeploymentMenu />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search + group filter */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Search by name, image, node, IP, tag, or VMID..."
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSearch(e.target.value)}
            className="pl-9 bg-[#111113]"
          />
        </div>
        {tags.length > 0 && (
          <select
            value={tagFilter}
            onChange={(e) => handleTagFilter(e.target.value)}
            className="h-9 rounded-md border border-white/10 bg-[#111113] px-2.5 text-[13px] text-zinc-300 outline-none focus:border-zinc-500"
          >
            <option value="">All tags</option>
            {tags.map((g) => (
              <option key={g.slug} value={g.slug}>{g.name}</option>
            ))}
            <option value="__untagged__">Untagged</option>
          </select>
        )}
        <select
          value={typeFilter}
          onChange={(e) => handleTypeFilter(e.target.value)}
          className="h-9 rounded-md border border-white/10 bg-[#111113] px-2.5 text-[13px] text-zinc-300 outline-none focus:border-zinc-500"
        >
          <option value="">All types</option>
          <option value="lxc">LXC</option>
          <option value="qemu">VM</option>
        </select>
        <span className="text-[13px] tabular-nums text-zinc-500 whitespace-nowrap">
          {filteredDeployments.length} of {deployments.length}
        </span>
        <CreateDeploymentMenu />
      </div>

      {/* Table list */}
      {filteredDeployments.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-[#111113] p-10 text-center">
          <p className="text-sm font-medium text-zinc-200">
            No containers match your search.
          </p>
          <button
            className="mt-2 text-[13px] text-emerald-400 hover:underline"
            onClick={() => setSearch("")}
            type="button"
          >
            Clear search filter
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-white/5 bg-[#111113]">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-white/5 bg-black/40">
                  <th className="px-4 py-3 font-medium text-zinc-400 w-10">Status</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Name</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Node</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">IP Address</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Resources</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Uptime</th>
                  <th className="px-4 py-3 font-medium text-zinc-400 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {paginatedDeployments.map((deployment) => (
                  <tr key={deployment.id} className="hover:bg-white/5 transition-colors group">
                    <td className="px-4 py-3">
                      {deployment.rawStatus === "running" ? (
                        <span className="flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-black/50 px-2.5 py-0.5 text-[11px] text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"></span> {deployment.statusLabel}
                        </span>
                      ) : deployment.rawStatus === "stopped" ? (
                        <span className="flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-black/50 px-2.5 py-0.5 text-[11px] text-zinc-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-zinc-500"></span> {deployment.statusLabel}
                        </span>
                      ) : (
                        <span className="flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-black/50 px-2.5 py-0.5 text-[11px] text-amber-400">
                           <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span> {deployment.statusLabel}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <Link href={`${siteBase}/deployments/${deployment.id}`} className="font-medium text-zinc-200 hover:underline">
                            {deployment.name}
                          </Link>
                          {deployment.type === "qemu" && <Badge variant="review">VM</Badge>}
                          {updateMap[deployment.id] && <Badge variant="warning">Update</Badge>}
                        </div>
                        <div className="text-[11px] font-mono text-zinc-400">VMID {deployment.vmid}</div>
                        {deployment.tagList.length > 0 && (
                          <DeploymentTagList
                            tagClassName="rounded-[5px] px-2 py-0.5"
                            tagList={deployment.tagList}
                            tags={tags}
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md border border-white/10 bg-black/50 px-2 py-0.5 text-[11px] text-zinc-400">
                        {deployment.node}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <CopyableText
                        className="text-zinc-300 text-[12px]"
                        text={deployment.ipAddress || "No IP"}
                      />
                    </td>
                    <td className="px-4 py-3 text-[12px] text-zinc-400 whitespace-nowrap">
                      {deployment.memory} &middot; {deployment.cpu} &middot; {deployment.disk}
                    </td>
                    <td className="px-4 py-3 text-zinc-300 text-[12px] whitespace-nowrap">
                      {deployment.uptime && deployment.uptime !== "-" ? deployment.uptime : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end">
                        <DeploymentQuickActions
                          deploymentId={deployment.id}
                          rawStatus={deployment.rawStatus}
                          siteSlug={siteBase.replace(/^\/sites\//, "")}
                          type={deployment.type}
                          vmid={deployment.vmid}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
