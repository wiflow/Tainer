import {
  CheckCircle2,
  Package,
  Server,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { SectionPanel } from "@/components/ui/section-panel";
import { requireSession, requireSitePermission } from "@/lib/auth";
import { withSiteConfig } from "@/lib/proxmox";
import { requireSitePageAccess } from "@/lib/page-guard";
import { ensureSiteConfig } from "@/lib/site-context";
import { getClusterUpdates, type NodeUpdateSummary } from "@/lib/update-manager";
import { CheckForUpdatesButton, RefreshAptButton, UpgradeNodeButton } from "./refresh-apt-button";

export const dynamic = "force-dynamic";

function priorityVariant(priority: string) {
  if (priority === "important" || priority === "required") return "destructive" as const;
  if (priority === "standard" || priority === "optional") return "neutral" as const;
  return "neutral" as const;
}

function NodeSection({ node, proxmoxBaseUrl }: { node: NodeUpdateSummary; proxmoxBaseUrl: string }) {
  if (node.error) {
    return (
      <SectionPanel
        title={node.node}
        description={node.error}
        headerRight={<Badge variant="destructive">Error</Badge>}
      >
        <div />
      </SectionPanel>
    );
  }

  return (
    <SectionPanel
      title={node.node}
      noPadding
      headerRight={
        <div className="flex flex-wrap items-center gap-2">
          {node.totalUpdates === 0 ? (
            <Badge variant="success">Up to date</Badge>
          ) : (
            <>
              <Badge variant="warning">{node.totalUpdates} update{node.totalUpdates !== 1 ? "s" : ""}</Badge>
              {node.securityUpdates > 0 && (
                <Badge variant="destructive">{node.securityUpdates} security</Badge>
              )}
            </>
          )}
          <RefreshAptButton node={node.node} />
          {node.totalUpdates > 0 && (
            <UpgradeNodeButton node={node.node} proxmoxBaseUrl={proxmoxBaseUrl} />
          )}
        </div>
      }
    >
      {node.updates.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-white/5 text-left text-[11px] uppercase tracking-[0.15em] text-zinc-600">
                <th className="px-5 py-2.5 font-medium">Package</th>
                <th className="px-5 py-2.5 font-medium">Current</th>
                <th className="px-5 py-2.5 font-medium">Available</th>
                <th className="px-5 py-2.5 font-medium">Priority</th>
                <th className="px-5 py-2.5 font-medium">Origin</th>
              </tr>
            </thead>
            <tbody>
              {node.updates.map((u) => (
                <tr
                  className="border-b border-white/5/40 last:border-b-0 hover:bg-[#111113] transition-colors"
                  key={u.packageName}
                >
                  <td className="px-5 py-2.5 font-medium text-zinc-200">{u.packageName}</td>
                  <td className="px-5 py-2.5 font-mono text-zinc-500">{u.currentVersion}</td>
                  <td className="px-5 py-2.5 font-mono text-emerald-400">{u.newVersion}</td>
                  <td className="px-5 py-2.5">
                    <Badge variant={priorityVariant(u.priority)}>{u.priority}</Badge>
                  </td>
                  <td className="px-5 py-2.5 text-zinc-500">{u.origin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionPanel>
  );
}

export default async function UpdatesPage({
  params,
}: {
  params: Promise<{ siteSlug: string }>;
}) {
  const { siteSlug } = await params;
  await requireSitePageAccess(siteSlug);
  const siteConfig = await ensureSiteConfig(siteSlug);

  const session = await requireSession();
  requireSitePermission(session, siteConfig.siteId, "manage-settings");

  const summary = await withSiteConfig(siteConfig, () =>
    getClusterUpdates(),
  );
  const proxmoxBaseUrl = siteConfig.apiUrl.replace(/\/api2\/?.*$/, "");

  const upToDateNodes = summary.nodes.filter((n) => n.totalUpdates === 0 && !n.error);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <CheckForUpdatesButton />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Package className="w-3.5 h-3.5" />}
          label="Total updates"
          value={String(summary.totalUpdates)}
        />
        <MetricCard
          icon={<ShieldAlert className="w-3.5 h-3.5" />}
          label="Security updates"
          value={String(summary.totalSecurityUpdates)}
        />
        <MetricCard
          icon={<Server className="w-3.5 h-3.5" />}
          label="Nodes checked"
          value={String(summary.nodes.length)}
        />
        <MetricCard
          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
          label="Up to date"
          value={String(upToDateNodes.length)}
          description={upToDateNodes.length === summary.nodes.length ? "All nodes current" : "nodes need no updates"}
        />
      </div>

      {summary.nodes.map((node) => (
        <NodeSection key={node.node} node={node} proxmoxBaseUrl={proxmoxBaseUrl} />
      ))}

      {summary.nodes.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <Server className="h-10 w-10 text-zinc-600" />
            <div>
              <p className="text-[15px] font-medium text-zinc-200">No nodes available</p>
              <p className="mt-1 text-[13px] text-zinc-500">
                Could not find any online nodes to check for updates.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
