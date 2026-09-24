import {
  CalendarClock,
  FileJson2,
  Server,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/ui/metric-card";
import { SectionPanel } from "@/components/ui/section-panel";
import { requirePermission, requireSession } from "@/lib/auth";
import { listConfigSnapshotPolicies } from "@/lib/config-snapshot-policies";
import { listConfigSnapshots, compareConfigSnapshots, getConfigSnapshot } from "@/lib/node-config-backup";
import { getNodes, withSiteConfig } from "@/lib/proxmox";
import { requireSitePageAccess } from "@/lib/page-guard";
import { ensureSiteConfig } from "@/lib/site-context";
import { ConfigSnapshotSchedules } from "./config-snapshot-schedules";
import { NodeConfigSnapshots } from "./node-config-snapshots";

export const dynamic = "force-dynamic";

export default async function NodeConfigsPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteSlug: string }>;
  searchParams: Promise<{ compare_a?: string; compare_b?: string }>;
}) {
  const { siteSlug } = await params;
  await requireSitePageAccess(siteSlug);
  const siteConfig = await ensureSiteConfig(siteSlug);

  const session = await requireSession();
  requirePermission(session, "manage-settings");

  const [snapshots, nodesData, schedules] = await withSiteConfig(siteConfig, () =>
    Promise.all([
      listConfigSnapshots(),
      getNodes(),
      listConfigSnapshotPolicies(),
    ]),
  );

  const nodeNames = nodesData.nodes.map((n) => n.name);

  // Compare mode
  const sp = await searchParams;
  let diffs: { section: string; before: string; after: string; changed: boolean }[] | null = null;
  let compareLabels: { a: string; b: string } | null = null;

  if (sp.compare_a && sp.compare_b) {
    const [snapA, snapB] = await Promise.all([
      getConfigSnapshot(sp.compare_a),
      getConfigSnapshot(sp.compare_b),
    ]);
    if (snapA && snapB) {
      diffs = compareConfigSnapshots(snapA, snapB);
      compareLabels = { a: snapA.label, b: snapB.label };
    }
  }

  // Group snapshots by node
  const groupedByNode = new Map<string, typeof snapshots>();
  for (const snap of snapshots) {
    const existing = groupedByNode.get(snap.nodeName) ?? [];
    existing.push(snap);
    groupedByNode.set(snap.nodeName, existing);
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          icon={<FileJson2 className="w-3.5 h-3.5" />}
          label="Snapshots"
          value={String(snapshots.length)}
        />
        <MetricCard
          icon={<Server className="w-3.5 h-3.5" />}
          label="Nodes covered"
          value={String(groupedByNode.size)}
          description={`of ${nodeNames.length} total nodes`}
        />
        <MetricCard
          icon={<CalendarClock className="w-3.5 h-3.5" />}
          label="Active schedules"
          value={String(schedules.filter((s) => s.enabled).length)}
          description={`${schedules.length} total`}
        />
      </div>

      {/* Schedules */}
      <ConfigSnapshotSchedules nodeNames={nodeNames} policies={schedules} />

      {/* Take snapshot + list */}
      <NodeConfigSnapshots
        nodeNames={nodeNames}
        snapshots={snapshots}
      />

      {/* Compare results */}
      {diffs && compareLabels && (
        <SectionPanel
          title="Configuration Diff"
          description={`Comparing "${compareLabels.a}" vs "${compareLabels.b}"`}
        >
          <div className="space-y-4">
            {diffs.map((d) => (
              <div key={d.section} className="rounded-lg border border-white/5">
                <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5">
                  <span className="text-[13px] font-medium text-zinc-200">{d.section}</span>
                  <Badge variant={d.changed ? "warning" : "success"}>
                    {d.changed ? "Changed" : "No change"}
                  </Badge>
                </div>
                {d.changed && (
                  <div className="grid lg:grid-cols-2 divide-x divide-zinc-800">
                    <div className="p-3">
                      <p className="mb-2 text-[11px] uppercase tracking-wider text-zinc-600">Before</p>
                      <pre className="max-h-60 overflow-auto rounded bg-zinc-950 p-3 text-[11px] text-zinc-400 font-mono">
                        {d.before}
                      </pre>
                    </div>
                    <div className="p-3">
                      <p className="mb-2 text-[11px] uppercase tracking-wider text-zinc-600">After</p>
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
      )}
    </div>
  );
}
