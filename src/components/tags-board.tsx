"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";

import { Pagination } from "@/components/pagination";
import { TagDeleteButton } from "@/components/tag-delete-button";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ContainerTag } from "@/lib/container-groups";
import { getTagAccentClass, getTagBadgeClass } from "@/lib/tag-utils";
import { useSiteBasePath } from "@/lib/use-site-path";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

export function TagsBoard({
  tags,
  memberCounts,
  statusCounts,
}: {
  tags: ContainerTag[];
  memberCounts: Record<string, number>;
  statusCounts: Record<string, { running: number; stopped: number; total: number }>;
}) {
  const siteBase = useSiteBasePath();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search);

  const filteredTags = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();
    if (!term) return tags;

    return tags.filter(
      (g) =>
        g.name.toLowerCase().includes(term) ||
        g.description.toLowerCase().includes(term),
    );
  }, [tags, deferredSearch]);

  const totalPages = Math.ceil(filteredTags.length / PAGE_SIZE);
  const currentPage = Math.min(page, totalPages || 1);
  const paginatedTags = filteredTags.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  // Reset to page 1 when search changes
  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  if (tags.length === 0) {
    return (
      <div className="rounded-2xl border border-white/5 bg-[#111113] p-10 text-center">
        <p className="text-sm font-medium text-zinc-200">
          No tags created yet.
        </p>
        <p className="mt-2 text-[13px] text-zinc-500">
          Create a tag to organize deployments and manage bulk operations.
        </p>
        <Link
          className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "mt-5")}
          href={`${siteBase}/tags/create`}
        >
          Create tag
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
            placeholder="Search by name or description..."
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSearch(e.target.value)}
            className="pl-9 bg-[#111113]"
          />
        </div>
        <span className="text-[13px] tabular-nums text-zinc-500 whitespace-nowrap">
          {filteredTags.length} of {tags.length}
        </span>
      </div>

      {/* Table list */}
      {filteredTags.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-[#111113] p-10 text-center">
          <p className="text-sm font-medium text-zinc-200">
            No tags match your search.
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
                  <th className="px-4 py-3 font-medium text-zinc-400">Tag Name</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Color</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Members</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Status</th>
                  <th className="px-4 py-3 font-medium text-zinc-400 text-right w-10">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {paginatedTags.map((tag) => {
                  const members = memberCounts[tag.slug] ?? 0;
                  const stats = statusCounts[tag.slug] ?? { running: 0, stopped: 0, total: 0 };
                  return (
                    <tr key={tag.id} className="hover:bg-white/5 transition-colors group">
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <Link href={`${siteBase}/tags/${tag.slug}`} className="font-medium text-zinc-100 hover:underline">
                            {tag.name}
                          </Link>
                          {tag.description && (
                            <span className="text-[11px] text-zinc-500 line-clamp-1">{tag.description}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium",
                            getTagBadgeClass(tag.color)
                          )}
                        >
                          {tag.color}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-zinc-400">
                        {members} member{members !== 1 ? "s" : ""}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-zinc-400">
                        <div className="flex items-center gap-2 text-zinc-300">
                          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {stats.running}</span>
                          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-zinc-500" /> {stats.stopped}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2 items-center relative">
                          <TagDeleteButton memberCount={members} tagId={tag.id} tagName={tag.name} />
                          <Link
                            className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "h-8")}
                            href={`${siteBase}/tags/${tag.slug}`}
                          >
                            Manage
                            <ArrowRight className="ml-1 h-3.5 w-3.5" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
