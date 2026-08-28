import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  HardDrive,
  ShieldCheck,
} from "lucide-react";
import { unstable_cache } from "next/cache";
import { redirect } from "next/navigation";

import { BackupListTable } from "@/components/backup-list-table";
import { BackupPoliciesList } from "@/components/backup-policies-list";
import { BackupRunHistoryCard } from "@/components/backup-run-history-card";
import { BackupStorageCards } from "@/components/backup-storage-cards";
import { ProxmoxIssues } from "@/components/proxmox-issues";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { SectionPanel } from "@/components/ui/section-panel";
import { getAppSettings, resolveDefaultRootfsStorage } from "@/lib/app-settings";
import { getCurrentSession } from "@/lib/auth";
import { listBackupPolicies } from "@/lib/backup-policies";
import { listBackupRuns } from "@/lib/backup-run-log";
import { listContainerTags } from "@/lib/container-groups";
import { getBackupOverview, getProxmoxDefaults, getRootfsTargets, getStorageConfig, withSiteConfig } from "@/lib/proxmox";
import { getStorageBoxSummary, listOffloadLog } from "@/lib/storage-box";
import { StorageBoxCard } from "@/components/storage-box-card";
import { ensureSiteConfig } from "@/lib/site-context";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import { cn, formatBytes } from "@/lib/utils";

export const dynamic = "force-dynamic";

const getBackupsPageData = unstable_cache(
  async (siteSlug: string) => {
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return withSiteConfig(siteConfig, async () => {
      return Promise.all([
        getBackupOverview(),
        getAppSettings(),
        getRootfsTargets(),
        listBackupPolicies(),
        listBackupRuns(20),
        listContainerTags(),
      ]);
    });
  },
  ["backups-page-data"],
  { revalidate: 10 },
);

export default async function BackupsPage({
  params,
}: {
  params: Promise<{ siteSlug: string }>;
}) {
  const { siteSlug } = await params;
  await ensureSiteConfig(siteSlug);

  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const [overview, settings, rootfsResult, backupPolicies, backupRuns, availableTags] = await getBackupsPageData(siteSlug);

  // Storage Box state is read fresh (not through the cached loader): connect /
  // test actions must reflect immediately.
  const storageBoxSiteConfig = await resolveSiteConfigBySlug(siteSlug);
  const [storageBoxSummary, offloadLog, storageConfigs] = await withSiteConfig(
    storageBoxSiteConfig,
    () =>
      Promise.all([
        getStorageBoxSummary(),
        listOffloadLog(20),
        getStorageConfig().catch(() => [] as unknown[]),
      ]),
  );
  const dirStorages = (storageConfigs as { storage?: string; path?: string; content?: string }[])
    .filter((s) => s?.storage && s.path && (s.content ?? "").includes("backup"))
    .map((s) => s.storage as string);

  const defaults = getProxmoxDefaults();
  const isAdmin = session.user.role === "admin";
  const restoreTargetStorage = resolveDefaultRootfsStorage(
    rootfsResult.targets,
    settings.defaultRootfsStorage || defaults.defaultRootfsStorage,
  );

  const healthyPools = overview.backupStoragePools.filter((p) => p.issues.length === 0);
  const unhealthyPools = overview.backupStoragePools.filter((p) => p.issues.length > 0);

  if (overview.backupStoragePools.length === 0) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <ShieldCheck className="h-10 w-10 text-zinc-600" />
            <div>
              <p className="text-[15px] font-medium text-zinc-200">No backup storage found</p>
              <p className="mt-1 text-[13px] text-zinc-500">
                Configure a CIFS/SMB storage pool with &quot;backup&quot; content type in Proxmox to enable native backups.
              </p>
            </div>
            {isAdmin && (
              <Link
                className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}
                href={`/sites/${siteSlug}/settings`}
              >
                Configure in Settings
              </Link>
            )}
          </CardContent>
        </Card>

        {isAdmin && (
          <StorageBoxCard
            dirStorages={dirStorages}
            nodes={[]}
            offloadLog={offloadLog}
            siteSlug={siteSlug}
            summary={storageBoxSummary}
          />
        )}

        <ProxmoxIssues
          description="Errors encountered while querying backup storage from the Proxmox API."
          issues={overview.issues}
          title="API access notes"
        />
      </div>
    );
  }

  // Calculate stats
  const totalCapacity = overview.backupStoragePools.reduce(
    (sum, p) => sum + (p.totalBytes ?? 0),
    0,
  );
  const totalUsed = overview.backupStoragePools.reduce(
    (sum, p) => sum + (p.usedBytes ?? 0),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        {healthyPools.length > 0 ? (
          <Badge variant="success">{healthyPools.length} healthy pool{healthyPools.length !== 1 ? "s" : ""}</Badge>
        ) : (
          <Badge variant="destructive">No healthy pools</Badge>
        )}
        {unhealthyPools.length > 0 && (
          <Badge variant="review">{unhealthyPools.length} with issues</Badge>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<CalendarClock className="w-3.5 h-3.5" />}
          label="Backup policies"
          value={String(backupPolicies.length)}
          description={`${backupPolicies.filter((p) => p.enabled).length} active`}
        />
        <MetricCard
          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
          label="Backup archives"
          value={String(overview.recentArchives.length)}
        />
        <MetricCard
          icon={<HardDrive className="w-3.5 h-3.5" />}
          label="Backup storage"
          value={formatBytes(totalUsed)}
          description={`of ${formatBytes(totalCapacity)} total`}
        />
        <MetricCard
          icon={<Clock className="w-3.5 h-3.5" />}
          label="Unprotected"
          value={String(overview.unprotectedVmids.length)}
          description={overview.unprotectedVmids.length === 0 ? "All workloads backed up" : "workloads with no backups"}
        />
      </div>

      <ProxmoxIssues
        description="Errors encountered while querying backup data from the Proxmox API."
        issues={[...overview.issues, ...rootfsResult.issues]}
        title="API access notes"
      />

      {/* Off-site backup (Hetzner Storage Box) */}
      {isAdmin && (
        <StorageBoxCard
          dirStorages={dirStorages}
          nodes={[...new Set(overview.backupStoragePools.map((p) => p.node))]}
          offloadLog={offloadLog}
          siteSlug={siteSlug}
          summary={storageBoxSummary}
        />
      )}

      {/* Backup policies */}
      {isAdmin && (
        <BackupPoliciesList
          availableTags={availableTags}
          healthyPools={healthyPools}
          policies={backupPolicies}
        />
      )}

      {/* Backup run history */}
      <BackupRunHistoryCard runs={backupRuns} />

      {/* Backup storage pools */}
      <SectionPanel
        title="Backup storage"
        description="Storage pools configured for backup content. SMB/CIFS shares are backed up downstream by Veeam."
      >
        <BackupStorageCards pools={overview.backupStoragePools} />
      </SectionPanel>

      {/* Recent backup archives */}
      <SectionPanel
        title="Recent backup archives"
        description="Backup archives stored on Proxmox backup storage pools."
        noPadding
      >
        <BackupListTable
          archives={overview.recentArchives}
          defaultNode={defaults.defaultNode}
          defaultStorage={restoreTargetStorage}
          isAdmin={isAdmin}
        />
      </SectionPanel>

      {/* Unprotected workloads */}
      {overview.unprotectedVmids.length > 0 && (
        <SectionPanel
          title="Unprotected workloads"
          description="These VMIDs have no backup archives on any backup storage pool."
        >
          <div className="flex flex-wrap gap-2">
            {overview.unprotectedVmids.map((vmid) => (
              <span
                key={vmid}
                className="rounded-lg border border-amber-800/40 bg-amber-950/30 px-3 py-1.5 text-[13px] font-medium tabular-nums text-amber-300"
              >
                VMID {vmid}
              </span>
            ))}
          </div>
        </SectionPanel>
      )}
    </div>
  );
}
