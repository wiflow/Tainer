"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/pagination";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DeploymentTemplate } from "@/lib/deployment-templates";
import type { VmTemplate } from "@/lib/vm-templates";
import { useSiteBasePath } from "@/lib/use-site-path";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

export function TemplatesBoard({ templates, vmTemplates = [] }: { templates: DeploymentTemplate[]; vmTemplates?: VmTemplate[] }) {
  const siteBase = useSiteBasePath();
  type UnifiedTemplate = {
    id: string;
    name: string;
    description: string;
    type: "lxc" | "qemu";
    specs: string;
    storage: string;
    bridge: string;
    hostnamePrefix: string;
    sourceName: string;
    accessLabel: string | null;
    updatedAt: string;
  };

  const allTemplates: UnifiedTemplate[] = useMemo(() => {
    const lxc: UnifiedTemplate[] = templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      type: "lxc" as const,
      specs: `${t.memory} MB · ${t.cores} cores · ${t.rootfsSize} GB`,
      storage: t.rootfsStorage,
      bridge: t.bridge || "vmbr0",
      hostnamePrefix: t.hostnamePrefix,
      sourceName: t.sourceName,
      accessLabel: t.accessReady ? "SSH-ready" : null,
      updatedAt: t.updatedAt,
    }));
    const vm: UnifiedTemplate[] = vmTemplates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      type: "qemu" as const,
      specs: `${t.memory} MB · ${t.cores} cores · ${t.sockets} sock · ${t.diskSize} GB`,
      storage: t.diskStorage,
      bridge: t.bridge || "vmbr0",
      hostnamePrefix: t.hostnamePrefix,
      sourceName: t.isoFileName || "QEMU VM",
      accessLabel: t.accessReady ? "SSH-ready" : null,
      updatedAt: t.updatedAt,
    }));
    return [...lxc, ...vm].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [templates, vmTemplates]);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search);

  const filteredTemplates = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();
    if (!term) return allTemplates;

    return allTemplates.filter(
      (t) =>
        t.name.toLowerCase().includes(term) ||
        (t.description?.toLowerCase().includes(term) ?? false) ||
        t.sourceName.toLowerCase().includes(term) ||
        t.storage.toLowerCase().includes(term) ||
        (t.hostnamePrefix?.toLowerCase().includes(term) ?? false),
    );
  }, [allTemplates, deferredSearch]);

  const totalPages = Math.ceil(filteredTemplates.length / PAGE_SIZE);
  const currentPage = Math.min(page, totalPages || 1);
  const paginatedTemplates = filteredTemplates.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  if (allTemplates.length === 0) {
    return (
      <div className="rounded-2xl border border-white/5 bg-[#111113] p-10 text-center">
        <p className="text-sm font-medium text-zinc-200">
          No deployment templates saved yet.
        </p>
        <p className="mt-2 text-[13px] text-zinc-400">
          Create one from a base CT image or configure a VM template to get started.
        </p>
        <Link
          className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "mt-5")}
          href={`${siteBase}/templates/create`}
        >
          Create template
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Search by name, image, storage, or hostname..."
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSearch(e.target.value)}
            className="pl-9 bg-[#111113]"
          />
        </div>
        <span className="text-[13px] tabular-nums text-zinc-500 whitespace-nowrap">
          {filteredTemplates.length} of {allTemplates.length}
        </span>
      </div>

      {/* Table list */}
      {filteredTemplates.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-[#111113] p-10 text-center">
          <p className="text-sm font-medium text-zinc-200">
            No templates match your search.
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
          <div className="overflow-hidden overflow-x-auto rounded-xl border border-white/5 bg-[#111113]">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-white/5 bg-black/40">
                  <th className="px-4 py-3 font-medium text-zinc-400">Name</th>
                  <th className="px-4 py-3 font-medium text-zinc-400 w-10">Type</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Source</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Specs</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Storage & Network</th>
                  <th className="px-4 py-3 font-medium text-zinc-400 text-right w-10">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {paginatedTemplates.map((template) => (
                  <tr key={template.id} className="hover:bg-white/5 transition-colors group">
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <Link
                          className="font-medium text-zinc-100 hover:underline"
                          href={template.type === "qemu" ? `${siteBase}/templates/vm/${template.id}` : `${siteBase}/templates/${template.id}`}
                        >
                          {template.name}
                        </Link>
                        {template.description && (
                          <span className="text-[11px] text-zinc-400 line-clamp-1">{template.description}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={template.type === "qemu" ? "review" : "neutral"}>{template.type === "qemu" ? "VM" : "CT"}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="review">{template.sourceName}</Badge>
                        {template.accessLabel && <Badge variant="neutral">{template.accessLabel}</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-zinc-400 whitespace-nowrap">
                      {template.specs}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-zinc-400 whitespace-nowrap">
                      {template.storage}
                      <span className="mx-2 text-zinc-600">&middot;</span>
                      {template.bridge}
                      {template.hostnamePrefix && (
                        <>
                          <span className="mx-2 text-zinc-600">&middot;</span>
                          {template.hostnamePrefix}-*
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end relative">
                        <Link
                          className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "h-8")}
                          href={template.type === "qemu" ? `${siteBase}/templates/vm/${template.id}` : `${siteBase}/templates/${template.id}`}
                        >
                          Deploy
                          <ArrowRight className="ml-1 h-3.5 w-3.5" />
                        </Link>
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
