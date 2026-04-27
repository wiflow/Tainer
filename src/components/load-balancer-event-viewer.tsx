"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Filter, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  LbEventCategory,
  LbEventLevel,
  LoadBalancerEventEntry,
} from "@/lib/load-balancer/event-log";

/**
 * Reuses the visual + interaction language of AuditLogViewer (search +
 * collapsible filter sidebar + framer-motion expand) but driven by load
 * balancer events instead of admin audit entries. Same patterns so the two
 * pages feel consistent: chevron rotates on expand, severity badge on the
 * left, expanded row shows full structured details.
 */

const LEVEL_BADGE_VARIANT: Record<LbEventLevel, "info" | "warning" | "destructive"> = {
  info: "info",
  warning: "warning",
  destructive: "destructive",
};

const CATEGORY_LABEL: Record<LbEventCategory, string> = {
  "migration-triggered": "migration",
  "migration-failed": "migration failed",
  "circuit-breaker-opened": "breaker open",
  "circuit-breaker-closed": "breaker closed",
  "tick-error": "tick error",
  "settings-changed": "settings",
};

type Filters = {
  level: LbEventLevel[];
  category: LbEventCategory[];
  node: string[];
};

const EMPTY_FILTERS: Filters = { level: [], category: [], node: [] };

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function EventRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: LoadBalancerEventEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <motion.button
        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-white/[0.025]"
        onClick={onToggle}
        type="button"
      >
        <motion.div
          animate={{ rotate: expanded ? 180 : 0 }}
          className="flex-shrink-0"
          transition={{ duration: 0.15 }}
        >
          <ChevronDown className="h-3.5 w-3.5 text-zinc-600" />
        </motion.div>

        <Badge className="flex-shrink-0" variant={LEVEL_BADGE_VARIANT[entry.level]}>
          {CATEGORY_LABEL[entry.category]}
        </Badge>

        <time className="w-20 flex-shrink-0 font-mono text-[11px] text-zinc-500">
          {formatTime(entry.recordedAt)}
        </time>

        {entry.node ? (
          <span className="flex-shrink-0 hidden md:inline min-w-[100px] text-[11px] text-zinc-400 font-mono truncate">
            {entry.node}
          </span>
        ) : (
          <span className="flex-shrink-0 hidden md:inline min-w-[100px] text-[11px] text-zinc-600 italic">
            cluster
          </span>
        )}

        {entry.vmid != null ? (
          <Badge variant="neutral" className="flex-shrink-0 hidden lg:inline-flex">
            #{entry.vmid}
          </Badge>
        ) : null}

        <p className="flex-1 truncate text-[12px] text-zinc-300">{entry.message}</p>
      </motion.button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden border-t border-white/5 bg-[#0d0d0e]"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            key={`${entry.id}-details`}
            transition={{ duration: 0.18 }}
          >
            <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                    Category
                  </p>
                  <p className="font-mono text-[12px] text-zinc-200">{entry.category}</p>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                    Site
                  </p>
                  <p className="text-[12px] text-zinc-200">{entry.siteName}</p>
                  <p className="font-mono text-[10px] text-zinc-600">{entry.siteId}</p>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                    Node
                  </p>
                  <p className="font-mono text-[12px] text-zinc-200">
                    {entry.node ?? "—"}
                  </p>
                </div>
                {entry.vmid != null ? (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                      VMID
                    </p>
                    <p className="font-mono text-[12px] text-zinc-200">{entry.vmid}</p>
                  </div>
                ) : null}
              </div>
              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                    Recorded at
                  </p>
                  <p className="font-mono text-[12px] text-zinc-200">
                    {formatDate(entry.recordedAt)}
                  </p>
                  <p className="font-mono text-[10px] text-zinc-600">{entry.recordedAt}</p>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                    Entry ID
                  </p>
                  <p className="font-mono text-[10px] text-zinc-500 break-all">{entry.id}</p>
                </div>
              </div>
              <div className="md:col-span-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                  Message
                </p>
                <p className="rounded-md border border-white/5 bg-zinc-950 px-3 py-2 font-mono text-[12px] text-zinc-300 whitespace-pre-wrap">
                  {entry.message}
                </p>
              </div>
              {entry.details && Object.keys(entry.details).length > 0 ? (
                <div className="md:col-span-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                    Details
                  </p>
                  <pre className="max-h-60 overflow-auto rounded-md border border-white/5 bg-zinc-950 px-3 py-2 font-mono text-[11px] text-zinc-400">
                    {JSON.stringify(entry.details, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function FilterGroup<T extends string>({
  active,
  label,
  onToggle,
  options,
  optionLabels,
}: {
  active: T[];
  label: string;
  onToggle: (value: T) => void;
  options: T[];
  optionLabels?: Record<string, string>;
}) {
  if (options.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </p>
      <div className="space-y-1.5">
        {options.map((opt) => {
          const selected = active.includes(opt);
          const display = optionLabels?.[opt] ?? opt;
          return (
            <motion.button
              aria-pressed={selected}
              className={`flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors ${
                selected
                  ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
                  : "border-white/[0.06] text-zinc-400 hover:border-white/[0.12] hover:bg-white/[0.025]"
              }`}
              key={opt}
              onClick={() => onToggle(opt)}
              type="button"
              whileHover={{ x: 2 }}
            >
              <span className="truncate">{display}</span>
              {selected ? <Check className="h-3 w-3 flex-shrink-0" /> : null}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

export function LoadBalancerEventViewer({
  entries,
}: {
  entries: LoadBalancerEventEntry[];
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const categories = useMemo(
    () => Array.from(new Set(entries.map((e) => e.category))).sort() as LbEventCategory[],
    [entries],
  );
  const nodes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      if (!e.node) continue;
      counts.set(e.node, (counts.get(e.node) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([n]) => n);
  }, [entries]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return entries.filter((e) => {
      if (filters.level.length > 0 && !filters.level.includes(e.level)) return false;
      if (filters.category.length > 0 && !filters.category.includes(e.category)) return false;
      if (filters.node.length > 0) {
        if (!e.node || !filters.node.includes(e.node)) return false;
      }
      if (!q) return true;
      const hay = `${e.message} ${e.category} ${e.node ?? ""} ${e.vmid ?? ""} ${
        JSON.stringify(e.details ?? {})
      }`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, filters, searchQuery]);

  const activeFilterCount =
    filters.level.length + filters.category.length + filters.node.length;

  function toggleArrayFilter<K extends keyof Filters>(key: K, value: Filters[K][number]) {
    setFilters((prev) => {
      const list = prev[key] as Array<typeof value>;
      const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
      return { ...prev, [key]: next };
    });
  }

  return (
    <div className="flex h-[calc(100vh-12rem)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-white/5 bg-[#0a0a0c]">
      <div className="flex items-center gap-2 border-b border-white/5 bg-[#111113] p-4">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <Input
            className="h-9 pl-9 text-[12px]"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by message, node, VMID, or category…"
            value={searchQuery}
          />
        </div>
        <Button
          className="relative"
          onClick={() => setShowFilters((s) => !s)}
          size="sm"
          variant={showFilters ? "default" : "outline"}
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
          {activeFilterCount > 0 ? (
            <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-500 px-1 text-[10px] font-semibold text-zinc-950">
              {activeFilterCount}
            </span>
          ) : null}
        </Button>
        <span className="hidden md:inline text-[11px] text-zinc-500 whitespace-nowrap">
          {filtered.length} of {entries.length}
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <AnimatePresence initial={false}>
          {showFilters ? (
            <motion.aside
              animate={{ width: 240, opacity: 1 }}
              className="flex flex-shrink-0 flex-col gap-5 overflow-y-auto border-r border-white/5 bg-[#0d0d0e] p-4"
              exit={{ width: 0, opacity: 0 }}
              initial={{ width: 0, opacity: 0 }}
              key="filters"
              transition={{ duration: 0.18 }}
            >
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-semibold text-zinc-200">Filters</p>
                {activeFilterCount > 0 ? (
                  <Button
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setFilters(EMPTY_FILTERS)}
                    size="sm"
                    variant="ghost"
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
              <FilterGroup<LbEventLevel>
                active={filters.level}
                label="Severity"
                onToggle={(v) => toggleArrayFilter("level", v)}
                options={["info", "warning", "destructive"]}
              />
              <FilterGroup<LbEventCategory>
                active={filters.category}
                label="Category"
                onToggle={(v) => toggleArrayFilter("category", v)}
                options={categories}
                optionLabels={CATEGORY_LABEL}
              />
              <FilterGroup
                active={filters.node}
                label="Node"
                onToggle={(v) => toggleArrayFilter("node", v)}
                options={nodes}
              />
            </motion.aside>
          ) : null}
        </AnimatePresence>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center p-12 text-center">
              <p className="text-[13px] text-zinc-500">
                {entries.length === 0
                  ? "No load-balancer events recorded yet. Migrations and breaker openings will show up here as they happen."
                  : "No events match the current filters."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {filtered.map((entry) => (
                <EventRow
                  entry={entry}
                  expanded={expandedId === entry.id}
                  key={entry.id}
                  onToggle={() => setExpandedId((cur) => (cur === entry.id ? null : entry.id))}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
