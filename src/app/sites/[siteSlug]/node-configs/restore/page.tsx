import { ArrowLeft, History } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionPanel } from "@/components/ui/section-panel";
import { requireSession, requireSitePermission } from "@/lib/auth";
import {
  compareConfigSnapshots,
  getConfigSnapshot,
  type NodeConfigSnapshot,
} from "@/lib/node-config-backup";
import {
  getClusterFirewallRules,
  getNodeDnsConfig,
  getNodeHostsConfig,
  getNodeNetworkConfig,
  getNodeTimeConfig,
  getStorageConfig,
  withSiteConfig,
} from "@/lib/proxmox";
import { requireSitePageAccess } from "@/lib/page-guard";
import { ensureSiteConfig } from "@/lib/site-context";

import { RestoreForm } from "./restore-form";

export const dynamic = "force-dynamic";

async function buildLiveSnapshot(snapshot: NodeConfigSnapshot): Promise<NodeConfigSnapshot> {
  const [networkResult, dnsResult, hostsResult, timeResult, storageResult, firewallResult] =
    await Promise.allSettled([
      getNodeNetworkConfig(snapshot.nodeName),
      getNodeDnsConfig(snapshot.nodeName),
      getNodeHostsConfig(snapshot.nodeName),
      getNodeTimeConfig(snapshot.nodeName),
      getStorageConfig(),
      getClusterFirewallRules(),
    ]);

  return {
    configs: {
      dns: dnsResult.status === "fulfilled" ? dnsResult.value : null,
      firewallRules: firewallResult.status === "fulfilled" ? firewallResult.value : [],
      hosts: hostsResult.status === "fulfilled" ? hostsResult.value : "",
      network: networkResult.status === "fulfilled" ? networkResult.value : [],
      storage: storageResult.status === "fulfilled" ? storageResult.value : [],
      timezone: timeResult.status === "fulfilled" ? timeResult.value.timezone : "unknown",
    },
    createdAt: new Date().toISOString(),
    createdBy: "live",
    id: "__current__",
    label: "Current live configuration",
    nodeName: snapshot.nodeName,
  };
}

export default async function RestoreSnapshotPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteSlug: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const { siteSlug } = await params;
  await requireSitePageAccess(siteSlug);
  const { id } = await searchParams;
  if (!id) notFound();

  const siteConfig = await ensureSiteConfig(siteSlug);
  const session = await requireSession();
  requireSitePermission(session, siteConfig.siteId, "manage-settings");

  const snapshot = await withSiteConfig(siteConfig, () => getConfigSnapshot(id));
  if (!snapshot) notFound();

  const live = await withSiteConfig(siteConfig, () => buildLiveSnapshot(snapshot));
  const diffs = compareConfigSnapshots(live, snapshot);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild size="sm" variant="ghost">
            <Link href={`/sites/${siteSlug}/node-configs`}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to snapshots
            </Link>
          </Button>
          <div>
            <h1 className="text-[15px] font-medium text-white flex items-center gap-2">
              <History className="h-4 w-4 text-amber-400" />
              Restore configuration
            </h1>
            <p className="text-[12px] text-zinc-500">
              Apply &ldquo;{snapshot.label}&rdquo; to node{" "}
              <Badge variant="neutral">{snapshot.nodeName}</Badge>
            </p>
          </div>
        </div>
      </div>

      <SectionPanel
        title="Changes that will be applied"
        description="Each section shows the current live config (Before) vs the snapshot (After). Sections with no change are pre-deselected."
      >
        <div className="space-y-4">
          {diffs.map((d) => (
            <div key={d.section} className="rounded-lg border border-white/5">
              <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5">
                <span className="text-[13px] font-medium text-zinc-200">{d.section}</span>
                <Badge variant={d.changed ? "warning" : "success"}>
                  {d.changed ? "Will change" : "No change"}
                </Badge>
              </div>
              {d.changed && (
                <div className="grid lg:grid-cols-2 divide-x divide-zinc-800">
                  <div className="p-3">
                    <p className="mb-2 text-[11px] uppercase tracking-wider text-zinc-600">
                      Current (before)
                    </p>
                    <pre className="max-h-60 overflow-auto rounded bg-zinc-950 p-3 text-[11px] text-zinc-400 font-mono">
                      {d.before}
                    </pre>
                  </div>
                  <div className="p-3">
                    <p className="mb-2 text-[11px] uppercase tracking-wider text-zinc-600">
                      Snapshot (after)
                    </p>
                    <pre className="max-h-60 overflow-auto rounded bg-zinc-950 p-3 text-[11px] text-zinc-400 font-mono">
                      {d.after}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </SectionPanel>

      <RestoreForm
        diffs={diffs.map((d) => ({ changed: d.changed, section: d.section }))}
        siteSlug={siteSlug}
        snapshotId={snapshot.id}
        snapshotLabel={snapshot.label}
        nodeName={snapshot.nodeName}
      />
    </div>
  );
}
