"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  HardDrive,
  Layers3,
  Search,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import type { LiveTemplate } from "@/lib/proxmox";
import { useSiteBasePath } from "@/lib/use-site-path";
import { cn } from "@/lib/utils";

function humanizeTemplateName(fileName: string) {
  let title = fileName;

  if (title.endsWith(".tar.gz")) title = title.slice(0, -7);
  else if (title.endsWith(".tar.xz")) title = title.slice(0, -7);
  else if (title.endsWith(".tar.zst")) title = title.slice(0, -8);
  else if (title.endsWith(".tar")) title = title.slice(0, -4);

  return title
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatCreatedAt(value: string | null) {
  if (!value) {
    return "Import time unavailable";
  }

  try {
    return `Imported ${new Date(value).toLocaleDateString()}`;
  } catch {
    return "Import time unavailable";
  }
}

function buildSearchText(template: LiveTemplate) {
  return [
    template.name,
    humanizeTemplateName(template.fileName),
    template.fileName,
    template.node,
    template.storage,
    template.sizeLabel,
    template.volid,
  ]
    .join(" ")
    .toLowerCase();
}

export function ContainerImagePicker({ templates }: { templates: LiveTemplate[] }) {
  const siteBase = useSiteBasePath();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const storageCount = useMemo(
    () => new Set(templates.map((template) => `${template.node}::${template.storage}`)).size,
    [templates],
  );
  const filteredTemplates = useMemo(() => {
    const terms = deferredSearch
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    const sortedTemplates = [...templates].sort((left, right) => {
      const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;

      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }

      return left.fileName.localeCompare(right.fileName);
    });

    if (terms.length === 0) {
      return sortedTemplates;
    }

    return sortedTemplates.filter((template) => {
      const haystack = buildSearchText(template);
      return terms.every((term) => haystack.includes(term));
    });
  }, [deferredSearch, templates]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
        <label className="block rounded-xl border border-white/5 bg-[#111113] px-4 py-3">
          <span className="text-[12px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            Search Base Images
          </span>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              className="h-10 border-white/10 bg-zinc-950/60 pl-9 text-zinc-100 placeholder:text-zinc-500"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by image name, filename, storage, node, or volid..."
              value={search}
            />
          </div>
        </label>

        <div className="rounded-xl border border-white/5 bg-[#111113] px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            Visible Images
          </p>
          <p className="mt-2 text-2xl font-semibold text-zinc-100">
            {filteredTemplates.length}
          </p>
          <p className="text-[12px] text-zinc-500">
            of {templates.length} imported
          </p>
        </div>

        <div className="rounded-xl border border-white/5 bg-[#111113] px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            Storage Targets
          </p>
          <p className="mt-2 text-2xl font-semibold text-zinc-100">
            {storageCount}
          </p>
          <p className="text-[12px] text-zinc-500">
            node/storage pairs
          </p>
        </div>
      </div>

      {filteredTemplates.length === 0 ? (
        <div className="rounded-xl border border-white/5 bg-[#111113] p-10 text-center">
          <p className="text-sm font-medium text-zinc-200">
            No base images match that search.
          </p>
          <button
            className="mt-2 text-[13px] text-sky-400 transition-colors hover:text-sky-300"
            onClick={() => setSearch("")}
            type="button"
          >
            Clear the filter
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredTemplates.map((template) => (
            <div
              key={template.id}
              className="group relative overflow-hidden rounded-xl border border-white/5 bg-[#111113] transition-colors hover:border-white/10 hover:bg-zinc-900/80"
            >
              <div className="absolute inset-y-0 left-0 w-[3px] bg-zinc-500" />

              <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <p className="text-[15px] font-semibold text-zinc-100">
                      {humanizeTemplateName(template.fileName)}
                    </p>
                    <span className="rounded-full border border-white/5 bg-zinc-950/80 px-2.5 py-1 text-[11px] text-zinc-400">
                      Base CT image
                    </span>
                  </div>

                  <p className="mt-2 break-all font-mono text-[12px] text-zinc-400">
                    {template.fileName}
                  </p>

                  <div className="mt-3 grid gap-2 text-[13px] text-zinc-500 sm:grid-cols-2 xl:grid-cols-4">
                    <span className="flex items-center gap-1.5">
                      <Layers3 className="h-3.5 w-3.5" />
                      {template.node}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <HardDrive className="h-3.5 w-3.5" />
                      {template.storage}
                    </span>
                    <span>{template.sizeLabel}</span>
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {formatCreatedAt(template.createdAt)}
                    </span>
                  </div>

                  <p className="mt-2 break-all text-[12px] text-zinc-600">
                    {template.volid}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    className={cn(buttonVariants({ size: "sm" }), "h-9")}
                    href={`${siteBase}/templates/${template.id}`}
                  >
                    Open create form
                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
