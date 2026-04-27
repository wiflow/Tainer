import { ArrowLeft, Eye, History } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionPanel } from "@/components/ui/section-panel";
import { requirePermission, requireSession } from "@/lib/auth";
import { getConfigSnapshot } from "@/lib/node-config-backup";
import { withSiteConfig } from "@/lib/proxmox";
import { ensureSiteConfig } from "@/lib/site-context";

export const dynamic = "force-dynamic";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const ARRAY_IDENTITY_KEYS = ["pos", "iface", "storage", "id", "name"] as const;
const COMMA_SET_FIELDS = new Set(["content", "nodes", "tags"]);

function canonicaliseCsvSet(raw: string): string {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort()
    .join(",");
}

function findArrayIdentityKey(arr: unknown[]): string | null {
  if (arr.length === 0) return null;
  if (!arr.every((e) => e !== null && typeof e === "object" && !Array.isArray(e))) {
    return null;
  }
  for (const key of ARRAY_IDENTITY_KEYS) {
    if (arr.every((e) => key in (e as Record<string, unknown>))) return key;
  }
  return null;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(sortKeysDeep);
    const idKey = findArrayIdentityKey(value);
    if (idKey) {
      return [...items].sort((a, b) => {
        const av = (a as Record<string, unknown>)[idKey];
        const bv = (b as Record<string, unknown>)[idKey];
        if (typeof av === "number" && typeof bv === "number") return av - bv;
        return String(av).localeCompare(String(bv));
      });
    }
    return items;
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const raw = source[key];
      if (COMMA_SET_FIELDS.has(key) && typeof raw === "string" && raw.includes(",")) {
        sorted[key] = canonicaliseCsvSet(raw);
      } else {
        sorted[key] = sortKeysDeep(raw);
      }
    }
    return sorted;
  }
  return value;
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(sortKeysDeep(value), null, 2);
  } catch {
    return String(value);
  }
}

type SectionRender = {
  body: string;
  empty: boolean;
  key: string;
  language: "text" | "json";
  meta: string;
  title: string;
};

function renderSections(snapshot: NonNullable<Awaited<ReturnType<typeof getConfigSnapshot>>>): SectionRender[] {
  const c = snapshot.configs;
  const networkArr = Array.isArray(c.network) ? c.network : [];
  const storageArr = Array.isArray(c.storage) ? c.storage : [];
  const firewallArr = Array.isArray(c.firewallRules) ? c.firewallRules : [];

  return [
    {
      body: prettyJson(c.network),
      empty: networkArr.length === 0,
      key: "network",
      language: "json",
      meta: `${networkArr.length} interface${networkArr.length === 1 ? "" : "s"}`,
      title: "Network interfaces",
    },
    {
      body: prettyJson(c.dns),
      empty: !c.dns,
      key: "dns",
      language: "json",
      meta: "node-scoped",
      title: "DNS resolver",
    },
    {
      body: typeof c.hosts === "string" ? c.hosts : prettyJson(c.hosts),
      empty: !c.hosts,
      key: "hosts",
      language: "text",
      meta: typeof c.hosts === "string" ? `${c.hosts.split("\n").length} lines` : "",
      title: "/etc/hosts",
    },
    {
      body: typeof c.timezone === "string" ? c.timezone : prettyJson(c.timezone),
      empty: !c.timezone || c.timezone === "unknown",
      key: "timezone",
      language: "text",
      meta: "node-scoped",
      title: "Timezone",
    },
    {
      body: prettyJson(c.storage),
      empty: storageArr.length === 0,
      key: "storage",
      language: "json",
      meta: `${storageArr.length} pool${storageArr.length === 1 ? "" : "s"} · cluster-wide`,
      title: "Storage definitions",
    },
    {
      body: prettyJson(c.firewallRules),
      empty: firewallArr.length === 0,
      key: "firewallRules",
      language: "json",
      meta: `${firewallArr.length} rule${firewallArr.length === 1 ? "" : "s"} · cluster-wide`,
      title: "Firewall rules",
    },
  ];
}

export default async function ViewSnapshotPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteSlug: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const { siteSlug } = await params;
  const { id } = await searchParams;
  if (!id) notFound();

  const siteConfig = await ensureSiteConfig(siteSlug);
  const session = await requireSession();
  requirePermission(session, "manage-settings");

  const snapshot = await withSiteConfig(siteConfig, () => getConfigSnapshot(id));
  if (!snapshot) notFound();

  const sections = renderSections(snapshot);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild size="sm" variant="ghost">
            <Link href={`/sites/${siteSlug}/node-configs`}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to snapshots
            </Link>
          </Button>
          <div>
            <h1 className="text-[15px] font-medium text-white flex items-center gap-2">
              <Eye className="h-4 w-4 text-sky-400" />
              {snapshot.label}
            </h1>
            <p className="text-[12px] text-zinc-500">
              Captured from <Badge variant="neutral">{snapshot.nodeName}</Badge> on{" "}
              {formatDate(snapshot.createdAt)} by {snapshot.createdBy}
            </p>
          </div>
        </div>
        <Button asChild size="sm" variant="warning">
          <Link href={`/sites/${siteSlug}/node-configs/restore?id=${snapshot.id}`}>
            <History className="h-3.5 w-3.5" />
            Restore this snapshot
          </Link>
        </Button>
      </div>

      <SectionPanel
        title="Snapshot contents"
        description="Read-only view of every config section captured in this snapshot."
      >
        <div className="space-y-4">
          {sections.map((s) => (
            <div key={s.key} className="rounded-lg border border-white/5">
              <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5">
                <span className="text-[13px] font-medium text-zinc-200">{s.title}</span>
                <Badge variant={s.empty ? "neutral" : "info"}>
                  {s.empty ? "empty" : s.meta}
                </Badge>
              </div>
              <div className="p-3">
                {s.empty ? (
                  <p className="text-[12px] text-zinc-600 italic">
                    No data captured for this section.
                  </p>
                ) : (
                  <pre className="max-h-96 overflow-auto rounded bg-zinc-950 p-3 text-[11px] text-zinc-300 font-mono whitespace-pre-wrap">
                    {s.body}
                  </pre>
                )}
              </div>
            </div>
          ))}
        </div>
      </SectionPanel>
    </div>
  );
}
