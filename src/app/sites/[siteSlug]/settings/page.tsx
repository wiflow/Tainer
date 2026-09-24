import { Clock, HardDrive, Database } from "lucide-react";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { redirect } from "next/navigation";

import { ProxmoxIssues } from "@/components/proxmox-issues";
import { BackupSettingsForm, DockerLibraryForm, SettingsForm } from "@/components/settings-form";
import { SshKeySettingsForm } from "@/components/ssh-key-settings-form";
import { ApiTokenPanel } from "@/components/api-token-panel";
import { StateBackupPanel } from "@/components/state-backup-panel";
import { SectionPanel } from "@/components/ui/section-panel";
import { MetricCard } from "@/components/ui/metric-card";
import { getAppSettings, resolveDefaultRootfsStorage } from "@/lib/app-settings";
import { getCurrentSession } from "@/lib/auth";
import { getRootfsTargets, listBackupStoragePools, withSiteConfig } from "@/lib/proxmox";
import { requireSitePageAccess } from "@/lib/page-guard";
import { ensureSiteConfig } from "@/lib/site-context";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import { getSshKeyInfo } from "@/lib/ssh-keys";
import { listApiTokens } from "@/lib/api-tokens";
import { listEnabledSites } from "@/lib/site-store";
import {
  getStateBackupConfig,
  hasStateBackupPassphrase,
  listStateBackups,
  resolveDestinationDir,
} from "@/lib/state-backup";

// force-dynamic would silently disable the unstable_cache below.
const getSettingsPageData = unstable_cache(
  async (siteSlug: string) => {
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return withSiteConfig(siteConfig, async () => {
      return Promise.all([
        getAppSettings(),
        getRootfsTargets(),
        listBackupStoragePools(),
      ]);
    });
  },
  ["settings-page-data"],
  { revalidate: 5 },
);

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ siteSlug: string }>;
}) {
  const { siteSlug } = await params;
  await requireSitePageAccess(siteSlug);
  await ensureSiteConfig(siteSlug);

  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  if (session.user.role !== "admin") {
    redirect("/");
  }

  const [settings, rootfsResult, backupStorageResult] = await getSettingsPageData(siteSlug);
  const sshKeyInfo = await getSshKeyInfo();
  const stateBackupConfig = await getStateBackupConfig();
  const stateBackups = await listStateBackups(stateBackupConfig);
  const [apiTokens, enabledSites] = await Promise.all([listApiTokens(), listEnabledSites()]);
  const defaultRootfsStorage = resolveDefaultRootfsStorage(
    rootfsResult.targets,
    settings.defaultRootfsStorage,
  );

  return (
    <div className="space-y-4">

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          icon={<HardDrive className="w-3.5 h-3.5" />}
          label="Default rootfs pool"
          value={defaultRootfsStorage || "Unset"}
          description="Preselected for new container rootfs volumes."
        />
        <MetricCard
          icon={<Database className="w-3.5 h-3.5" />}
          label="Backup storage pools"
          value={String(backupStorageResult.pools.length)}
          description="Proxmox storage pools supporting backup content."
        />
        <MetricCard
          icon={<Clock className="w-3.5 h-3.5" />}
          label="Backup SLA"
          value={`${settings.defaultBackupSlaHours}h`}
          description="Maximum age for a backup to be considered within SLA."
        />
      </div>

      <ProxmoxIssues
        description="Settings rely on live Proxmox storage visibility. Missing pools usually mean permissions or unavailable storage."
        issues={[...rootfsResult.issues, ...backupStorageResult.issues]}
        title="Storage visibility notes"
      />

      <SettingsForm
        defaultRootfsStorage={defaultRootfsStorage}
        rootfsTargets={rootfsResult.targets}
        updatedAt={settings.updatedAt}
      />

      <BackupSettingsForm
        backupPools={backupStorageResult.pools}
        defaultBackupSlaHours={settings.defaultBackupSlaHours}
        defaultBackupStorage={settings.defaultBackupStorage}
        updatedAt={settings.updatedAt}
      />

      <DockerLibraryForm
        dockerLibraryPath={settings.dockerLibraryPath}
        envFallback={process.env.DOCKER_LIBRARY_PATH?.trim() ?? ""}
        updatedAt={settings.updatedAt}
      />

      <SshKeySettingsForm keyInfo={sshKeyInfo} />

      <StateBackupPanel
        config={{
          enabled: stateBackupConfig.enabled,
          scheduleHourUtc: stateBackupConfig.scheduleHourUtc,
          retention: stateBackupConfig.retention,
          destinationDir: stateBackupConfig.destinationDir,
          hasPassphrase: hasStateBackupPassphrase(stateBackupConfig),
          lastRun: stateBackupConfig.lastRun,
        }}
        backups={stateBackups}
        defaultDestination={resolveDestinationDir(stateBackupConfig)}
      />

      <ApiTokenPanel
        tokens={apiTokens}
        sites={enabledSites.map((site) => ({ id: site.id, name: site.name }))}
        appOrigin={process.env.APP_URL?.trim() || "https://your-tainer-host"}
        now={Date.now()}
      />

      <SectionPanel
        title="Looking for IP pools?"
        description={
          <>
            IP pool configuration moved to{" "}
            <Link
              className="text-zinc-200 underline decoration-zinc-600 underline-offset-2 hover:decoration-zinc-300"
              href={`/sites/${siteSlug}/network?tab=ip-pools`}
            >
              Network → IP pools
            </Link>
            . Storage, backup, and SSH defaults remain here.
          </>
        }
      />


      <SectionPanel
        title="What this affects"
        description="These defaults are used to reduce repetitive operator input without hiding the real Proxmox parameters."
        noPadding
      >
        <div className="divide-y divide-white/5">
          {[
            "The selected default rootfs storage is preselected when authoring and launching deployment templates.",
            "Operators can still change the rootfs storage per deployment before submitting.",
            "Only rootfs-capable Proxmox storage pools are offered in the dropdown.",
            "The backup storage default is used when triggering ad-hoc backups from deployment pages.",
            "Backup SLA determines when a deployment is flagged as unprotected due to stale backups.",
            "Backup storage must already be configured in Proxmox as a CIFS/SMB share with backup content type.",
          ].map((item) => (
            <div key={item} className="px-4 py-3 text-[13px] text-zinc-300">
              {item}
            </div>
          ))}
        </div>
      </SectionPanel>
    </div>
  );
}
