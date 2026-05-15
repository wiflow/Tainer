"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Filter, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdminAuditAction, AdminAuditEntry } from "@/lib/admin-audit-log";

/**
 * Adapted from a "shadcn-ui interactive logs table" pattern but driven by
 * Tainer's actual AdminAuditEntry shape rather than a fake api-gateway dataset.
 * Preserved: search + expand-on-click + animated filter sidebar.
 * Replaced: synthetic level/service/duration/status fields with category +
 * level derived from the audit action, plus actor/target visibility.
 */

type Level = "info" | "warning" | "destructive";

/** Maps each audit action to a human-friendly category + a severity level. */
const ACTION_META: Record<AdminAuditAction, { category: string; level: Level }> = {
  "user-created": { category: "users", level: "info" },
  "user-deleted": { category: "users", level: "destructive" },
  "user-role-changed": { category: "users", level: "warning" },
  "user-permissions-updated": { category: "users", level: "warning" },
  "user-groups-updated": { category: "users", level: "info" },
  "password-changed": { category: "passwords", level: "info" },
  "password-reset-requested": { category: "passwords", level: "info" },
  "admin-password-reset": { category: "passwords", level: "warning" },
  "two-factor-enabled": { category: "2fa", level: "info" },
  "two-factor-disabled": { category: "2fa", level: "warning" },
  "settings-updated": { category: "settings", level: "info" },
  "template-created": { category: "templates", level: "info" },
  "template-updated": { category: "templates", level: "info" },
  "template-deleted": { category: "templates", level: "destructive" },
  "ip-pool-created": { category: "network", level: "info" },
  "ip-pool-deleted": { category: "network", level: "destructive" },
  "alert-settings-updated": { category: "alerts", level: "info" },
  "alert-test-sent": { category: "alerts", level: "info" },
  "session-revoked": { category: "sessions", level: "warning" },
  "sessions-revoked": { category: "sessions", level: "warning" },
  "group-created": { category: "groups", level: "info" },
  "group-updated": { category: "groups", level: "info" },
  "group-deleted": { category: "groups", level: "destructive" },
  "sso-login": { category: "sso", level: "info" },
  "sso-user-provisioned": { category: "sso", level: "info" },
  "sso-provider-created": { category: "sso", level: "info" },
  "sso-provider-updated": { category: "sso", level: "info" },
  "sso-provider-deleted": { category: "sso", level: "destructive" },
  "login-success": { category: "logins", level: "info" },
  "login-failure": { category: "logins", level: "warning" },
  "ldap-login-success": { category: "ldap", level: "info" },
  "ldap-login-failure": { category: "ldap", level: "warning" },
  "ldap-user-provisioned": { category: "ldap", level: "info" },
  "ldap-config-updated": { category: "ldap", level: "warning" },
  "ldap-config-deleted": { category: "ldap", level: "destructive" },
  "integration-configured": { category: "integrations", level: "info" },
  "integration-updated": { category: "integrations", level: "info" },
  "integration-removed": { category: "integrations", level: "destructive" },
  "lldp-token-issued": { category: "network", level: "info" },
  "lldp-token-revoked": { category: "network", level: "warning" },
  "lldp-snapshots-cleared": { category: "network", level: "warning" },
  "lldp-ingest-rejected": { category: "network", level: "warning" },
  "lldp-annotation-updated": { category: "network", level: "info" },
  "lldp-annotation-removed": { category: "network", level: "info" },
  "login-lockout-cleared": { category: "logins", level: "warning" },
};

function actionMeta(action: string): { category: string; level: Level } {
  return ACTION_META[action as AdminAuditAction] ?? { category: "other", level: "info" };
}

const LEVEL_BADGE_VARIANT: Record<Level, "info" | "warning" | "destructive"> = {
  info: "info",
  warning: "warning",
  destructive: "destructive",
};

type Filters = {
  level: Level[];
  category: string[];
  actor: string[];
};

const EMPTY_FILTERS: Filters = { level: [], category: [], actor: [] };

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

function LogRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: AdminAuditEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = actionMeta(entry.action);

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

        <Badge variant={LEVEL_BADGE_VARIANT[meta.level]} className="flex-shrink-0">
          {meta.category}
        </Badge>

        <time className="w-20 flex-shrink-0 font-mono text-[11px] text-zinc-500">
          {formatTime(entry.recordedAt)}
        </time>

        <span className="flex-shrink-0 min-w-[140px] text-[12px] font-medium text-zinc-200 truncate">
          {entry.actorName || entry.actorEmail || "system"}
        </span>

        <span className="flex-shrink-0 hidden md:inline text-[11px] uppercase tracking-[0.16em] text-zinc-600 min-w-[160px]">
          {entry.action}
        </span>

        <p className="flex-1 truncate text-[12px] text-zinc-400">{entry.message}</p>

        {entry.targetEmail ? (
          <span className="flex-shrink-0 hidden lg:inline text-[11px] text-zinc-500 max-w-[200px] truncate">
            → {entry.targetEmail}
          </span>
        ) : null}
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
                    Action
                  </p>
                  <p className="font-mono text-[12px] text-zinc-200">{entry.action}</p>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                    Actor
                  </p>
                  <p className="text-[12px] text-zinc-200">
                    {entry.actorName || "—"}
                    {entry.actorEmail ? (
                      <span className="ml-1 text-zinc-500">&lt;{entry.actorEmail}&gt;</span>
                    ) : null}
                  </p>
                </div>
                {entry.targetEmail ? (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                      Target
                    </p>
                    <p className="font-mono text-[12px] text-zinc-200">{entry.targetEmail}</p>
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
}: {
  active: T[];
  label: string;
  onToggle: (value: T) => void;
  options: T[];
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
              <span className="truncate">{opt}</span>
              {selected ? <Check className="h-3 w-3 flex-shrink-0" /> : null}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

export function AuditLogViewer({ entries }: { entries: AdminAuditEntry[] }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  // Derive option lists from the data we actually have, not a hardcoded set.
  const categories = useMemo(
    () =>
      Array.from(new Set(entries.map((e) => actionMeta(e.action).category))).sort(),
    [entries],
  );
  const actors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      const k = e.actorEmail || e.actorName || "system";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    // Top 12 most-active actors so the panel stays readable on big logs.
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([k]) => k);
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return entries.filter((e) => {
      const meta = actionMeta(e.action);

      if (filters.level.length > 0 && !filters.level.includes(meta.level)) return false;
      if (filters.category.length > 0 && !filters.category.includes(meta.category)) return false;
      if (filters.actor.length > 0) {
        const k = e.actorEmail || e.actorName || "system";
        if (!filters.actor.includes(k)) return false;
      }

      if (!q) return true;
      const hay =
        `${e.message} ${e.action} ${e.actorEmail} ${e.actorName} ${e.targetEmail ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, filters, searchQuery]);

  const activeFilterCount =
    filters.level.length + filters.category.length + filters.actor.length;

  function toggleArrayFilter<K extends keyof Filters>(key: K, value: Filters[K][number]) {
    setFilters((prev) => {
      const list = prev[key] as Array<typeof value>;
      const next = list.includes(value)
        ? list.filter((v) => v !== value)
        : [...list, value];
      return { ...prev, [key]: next };
    });
  }

  return (
    <div className="flex h-[calc(100vh-9rem)] min-h-[480px] flex-col overflow-hidden rounded-2xl border border-white/5 bg-[#0a0a0c]">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/5 bg-[#111113] p-4">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <Input
            className="h-9 pl-9 text-[12px]"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by actor, target, action, or message…"
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
          {filteredEntries.length} of {entries.length}
        </span>
      </div>

      {/* Body */}
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
              <FilterGroup<Level>
                active={filters.level}
                label="Severity"
                onToggle={(v) => toggleArrayFilter("level", v)}
                options={["info", "warning", "destructive"]}
              />
              <FilterGroup
                active={filters.category}
                label="Category"
                onToggle={(v) => toggleArrayFilter("category", v)}
                options={categories}
              />
              <FilterGroup
                active={filters.actor}
                label="Top actors"
                onToggle={(v) => toggleArrayFilter("actor", v)}
                options={actors}
              />
            </motion.aside>
          ) : null}
        </AnimatePresence>

        <div className="flex-1 overflow-y-auto">
          {filteredEntries.length === 0 ? (
            <div className="flex h-full items-center justify-center p-12 text-center">
              <p className="text-[13px] text-zinc-500">
                {entries.length === 0
                  ? "No audit log entries yet."
                  : "No entries match the current filters."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {filteredEntries.map((entry) => (
                <LogRow
                  entry={entry}
                  expanded={expandedId === entry.id}
                  key={entry.id}
                  onToggle={() =>
                    setExpandedId((cur) => (cur === entry.id ? null : entry.id))
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
