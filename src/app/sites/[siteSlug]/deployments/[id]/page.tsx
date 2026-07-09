import Link from "next/link";
import { Activity, ArrowLeft, Cpu, HardDrive, Network } from "lucide-react";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/auto-refresh";
import { DeploymentActivityCard } from "@/components/deployment-activity-card";
import { DeploymentFirewallCard } from "@/components/deployment-firewall-card";
import { DeploymentNetworkPathCard } from "@/components/deployment-network-path-card";
import { DeploymentTagList } from "@/components/deployment-tag-list";
import { DeploymentBackupCard } from "@/components/deployment-backup-card";
import { DeploymentSnapshotCard } from "@/components/deployment-snapshot-card";
import { DeploymentLocalSshCard } from "@/components/deployment-local-ssh-card";
import { CopyableText } from "@/components/copyable-text";
import { DeploymentEnvEditor } from "@/components/deployment-env-editor";
import { DeploymentEditButton } from "@/components/deployment-resource-editor";
import { DeploymentQuickActions } from "@/components/deployment-quick-actions";
import { DeploymentStatusProvider } from "@/components/deployment-status-context";
import { LiveDeploymentStatusBadge } from "@/components/live-deployment-status-badge";
import { GuestConsolePanel } from "@/components/guest-console-panel";
import { DeploymentUpdateBanner } from "@/components/deployment-update-banner";
import { PortScanCard } from "@/components/port-scan-panel";
import { ProxmoxIssues } from "@/components/proxmox-issues";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listContainerTags } from "@/lib/container-groups";
import { getGeneratedDeploymentSshKeyInfo } from "@/lib/deployment-ssh-keys";
import { getDeploymentTemplate } from "@/lib/deployment-templates";
import { getAppSettings } from "@/lib/app-settings";
import { getCurrentSession, hasFreshGuestShellStepUp, hasSitePermission } from "@/lib/auth";
import { extractSshHost } from "@/lib/guest-access";
import { getDeploymentActivities } from "@/lib/deployment-activity-log";
import { getDeploymentBackupInfo, getDeploymentDetail, getDeploymentNetSpecs, getGuestFirewallOptions, getLatestDeploymentActivity, getNodes, getTemplateFileInfo, listGuestFirewallRules, listSnapshots, withSiteConfig } from "@/lib/proxmox";
import { resolveDeploymentNetworkPath } from "@/lib/lldp-deployment-path";
import { getLldpSnapshotsForSite } from "@/lib/lldp-snapshots";
import { ensureSiteConfig } from "@/lib/site-context";
import { cn, formatBytes } from "@/lib/utils";

export const dynamic = "force-dynamic";

type DeploymentPageProps = {
  params: Promise<{
    siteSlug: string;
    id: string;
  }>;
};

function parseStorageFromVolumeRef(volumeRef: string) {
  const storage = volumeRef.split(":")[0]?.trim() ?? "";
  return /^[A-Za-z0-9._-]+$/.test(storage) ? storage : "";
}

function ResourceBar({ label, ratio, used, total, color }: {
  label: string;
  ratio: number;
  used: string;
  total: string;
  color: string;
}) {
  const pct = Math.round(ratio * 100);

  return (
    <div className="rounded-xl border border-white/5 bg-black/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-zinc-400">{label}</p>
        <p className="text-[13px] font-semibold tabular-nums text-zinc-100">{pct}%</p>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={cn("h-full rounded-full transition-[width] duration-700", color)}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] tabular-nums text-zinc-600">
        {used} / {total}
      </p>
    </div>
  );
}

export default async function DeploymentDetailPage({
  params,
}: DeploymentPageProps) {
  const { siteSlug, id } = await params;
  const siteConfig = await ensureSiteConfig(siteSlug);

  // Phase 1: Fetch everything that only needs the deployment id / no dependencies
  const [deployment, { nodes, metrics: nodeMetrics }, session, tags, hasFreshStepUp, settings, activityLog] = await withSiteConfig(siteConfig, () =>
    Promise.all([
      getDeploymentDetail(id),
      getNodes(),
      getCurrentSession(),
      listContainerTags(),
      hasFreshGuestShellStepUp().catch(() => false),
      getAppSettings(),
      getDeploymentActivities(id).catch(() => []),
    ]),
  );

  if (!deployment) {
    notFound();
  }

  // Phase 2: Fetch everything that depends on the deployment result — all in parallel
  const tainerMeta = deployment.tainerMeta;
  const [latestActivityResult, sourceTemplate, imageInfo, backupInfo, snapshots, generatedLocalSsh, netPath, firewallOptions, firewallRules] = await withSiteConfig(siteConfig, () =>
    Promise.all([
      getLatestDeploymentActivity(deployment.node, deployment.vmid).catch(() => null),
      tainerMeta?.templateId ? getDeploymentTemplate(tainerMeta.templateId) : Promise.resolve(null),
      tainerMeta?.imageVolid && tainerMeta.imageCtime
        ? getTemplateFileInfo(deployment.node, tainerMeta.imageVolid).catch(() => null)
        : Promise.resolve(null),
      getDeploymentBackupInfo(
        deployment.node,
        deployment.vmid,
        deployment.type,
        settings.defaultBackupSlaHours,
      ).catch(() => null),
      listSnapshots(deployment.node, deployment.vmid, deployment.type).catch(() => []),
      tainerMeta?.localSsh?.mode === "generated"
        ? getGeneratedDeploymentSshKeyInfo(deployment.id)
        : Promise.resolve(null),
      (async () => {
        const [specs, lldpSnapshots] = await Promise.all([
          getDeploymentNetSpecs(deployment.id).catch(() => null),
          getLldpSnapshotsForSite(siteConfig.siteId).catch(() => ({ hosts: {} })),
        ]);
        if (!specs) return null;
        return resolveDeploymentNetworkPath({
          node: specs.node,
          netConfig: specs.specs,
          snapshots: lldpSnapshots,
        }).catch(() => null);
      })(),
      getGuestFirewallOptions(deployment.node, deployment.vmid, deployment.type).catch(
        () => null,
      ),
      listGuestFirewallRules(deployment.node, deployment.vmid, deployment.type).catch(
        () => null,
      ),
    ]),
  );

  const latestActivity = latestActivityResult ?? (
    tainerMeta?.deployedAt
      ? { label: "Deployed", occurredAt: tainerMeta.deployedAt }
      : null
  );

  const templateUpdated = !!(
    sourceTemplate && tainerMeta && sourceTemplate.updatedAt > tainerMeta.templateVersion
  );
  let imageUpdated = false;
  if (imageInfo && tainerMeta?.imageCtime && (
    imageInfo.ctime !== tainerMeta.imageCtime || imageInfo.size !== tainerMeta.imageSize
  )) {
    imageUpdated = true;
  }

  const restoreTargetStorage =
    parseStorageFromVolumeRef(deployment.rootfs) || settings.defaultRootfsStorage;

  const updateAvailable = templateUpdated || imageUpdated;
  const canRunDestructiveActions = session?.user.role === "admin";

  const usage = deployment.resourceUsage;
  const sshHost = extractSshHost(deployment.networkInfo?.ipAddress ?? deployment.ipAddress);
  const networkDisplayText = deployment.networkInfo
    ? `${deployment.networkInfo.ipAddress}${deployment.networkInfo.subnet}`
    : deployment.ipAddress;
  const networkCopyText = deployment.networkInfo?.ipAddress ?? deployment.ipAddress;

  return (
    <div className="space-y-8">
      {/* Status/uptime/metrics change outside the app and lag behind
          lifecycle actions — converge without a manual reload. */}
      <AutoRefresh intervalMs={15_000} eventsSite={siteSlug} />
      {/* Header with name, status, and actions */}
      <div>
        <Link
          className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "mb-4 -ml-3")}
          href={`/sites/${siteSlug}/deployments`}
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Deployments
        </Link>
        <DeploymentStatusProvider>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
                {deployment.name}
              </h1>
              <LiveDeploymentStatusBadge
                rawStatus={deployment.rawStatus}
                statusLabel={deployment.statusLabel}
              />
            </div>
            <p className="mt-1 text-[13px] text-zinc-500">
              {deployment.node} · {deployment.type === "qemu" ? "VM" : "CT"} {deployment.vmid} · {deployment.templateName}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DeploymentEditButton deployment={deployment} />
            <div className="h-6 w-px bg-white/5" aria-hidden />
            <DeploymentQuickActions
              allowDelete={canRunDestructiveActions}
              currentNode={deployment.node}
              deploymentId={deployment.id}
              nodeMetrics={nodeMetrics}
              nodes={nodes}
              rawStatus={deployment.rawStatus}
              siteSlug={siteSlug}
              type={deployment.type}
              vmid={deployment.vmid}
            />
          </div>
        </div>
        </DeploymentStatusProvider>
      </div>

      {updateAvailable && tainerMeta && (
        <DeploymentUpdateBanner
          canRecreate={canRunDestructiveActions}
          deploymentId={deployment.id}
          templateId={sourceTemplate?.id ?? ""}
          templateName={sourceTemplate?.name ?? tainerMeta.templateName}
          deployedAt={tainerMeta.deployedAt}
          templateUpdatedAt={sourceTemplate?.updatedAt ?? ""}
          imageUpdated={imageUpdated}
        />
      )}

      {/* Info cards row */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/5 bg-[#111113] p-4">
          <div className="flex items-center gap-2 text-zinc-500">
            <Network className="h-4 w-4" />
            <span className="text-[11px] uppercase tracking-[0.18em]">Network</span>
          </div>
          <div className="mt-3">
            <CopyableText
              className="text-[15px] font-medium text-zinc-100"
              copyText={networkCopyText}
              text={networkDisplayText}
            />
          </div>
          {deployment.networkInfo && (
            <div className="mt-3 space-y-1.5 border-t border-white/5 pt-3">
              {deployment.networkInfo.gateway && (
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-zinc-500">Gateway</span>
                  <CopyableText className="text-zinc-400" text={deployment.networkInfo.gateway} />
                </div>
              )}
              {deployment.networkInfo.dns && (
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-zinc-500">DNS</span>
                  <CopyableText className="text-zinc-400" text={deployment.networkInfo.dns} />
                </div>
              )}
              {deployment.networkInfo.hwAddress && (
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-zinc-500">MAC</span>
                  <CopyableText className="text-zinc-400" text={deployment.networkInfo.hwAddress} />
                </div>
              )}
              {deployment.networkInfo.interfaceName && (
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-zinc-500">Interface</span>
                  <span className="text-zinc-400">{deployment.networkInfo.interfaceName}</span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-white/5 bg-[#111113] p-4">
          <div className="flex items-center gap-2 text-zinc-500">
            <Cpu className="h-4 w-4" />
            <span className="text-[11px] uppercase tracking-[0.18em]">Resources</span>
          </div>
          <p className="mt-3 text-[15px] font-medium text-zinc-100">{deployment.cpu} · {deployment.memory}</p>
        </div>
        <div className="min-w-0 rounded-2xl border border-white/5 bg-[#111113] p-4">
          <div className="flex items-center gap-2 text-zinc-500">
            <HardDrive className="h-4 w-4" />
            <span className="text-[11px] uppercase tracking-[0.18em]">{deployment.type === "qemu" ? "Disk" : "Rootfs"}</span>
          </div>
          <p className="mt-3 truncate text-[15px] font-medium text-zinc-100" title={deployment.rootfs}>{deployment.rootfs}</p>
        </div>
        <div className="rounded-2xl border border-white/5 bg-[#111113] p-4">
          <div className="flex items-center gap-2 text-zinc-500">
            <Activity className="h-4 w-4" />
            <span className="text-[11px] uppercase tracking-[0.18em]">Uptime</span>
          </div>
          <p className="mt-3 text-[15px] font-medium text-zinc-100">{deployment.uptime}</p>
        </div>
      </div>

      <GuestConsolePanel
        deploymentId={deployment.id}
        guestType={deployment.type}
        hasFreshStepUp={hasFreshStepUp}
        hasTwoFactor={Boolean(session?.user.hasTwoFactor)}
        rawStatus={deployment.rawStatus}
      />

      {deployment.tainerMeta?.localSsh ? (
        <DeploymentLocalSshCard
          downloadHref={deployment.tainerMeta.localSsh.mode === "generated" && generatedLocalSsh
            ? `/api/deployments/${deployment.id}/ssh-private-key`
            : null}
          fileName={generatedLocalSsh?.fileName ?? null}
          fingerprint={deployment.tainerMeta.localSsh.fingerprint}
          host={sshHost}
          loginUser={deployment.tainerMeta.localSsh.loginUser}
          mode={deployment.tainerMeta.localSsh.mode}
        />
      ) : null}

      <ProxmoxIssues
        description="This detail view only exposes fields and operations the token is allowed to access."
        issues={deployment.issues}
      />

      {/* Resource usage + services */}
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        {usage ? (
          <Card className="overflow-hidden rounded-2xl">
            <CardHeader className="border-b border-white/5">
              <CardTitle>Resource usage</CardTitle>
              <CardDescription>
                Live resource consumption for this container.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-5">
              <ResourceBar
                color="bg-sky-400"
                label="CPU"
                ratio={usage.cpuRatio}
                total={deployment.cpu}
                used={`${Math.round(usage.cpuRatio * 100)}%`}
              />
              <ResourceBar
                color="bg-emerald-400"
                label="Memory"
                ratio={usage.memTotalBytes > 0 ? usage.memUsedBytes / usage.memTotalBytes : 0}
                total={formatBytes(usage.memTotalBytes)}
                used={formatBytes(usage.memUsedBytes)}
              />
              <ResourceBar
                color="bg-amber-400"
                label="Disk"
                ratio={usage.diskTotalBytes > 0 ? usage.diskUsedBytes / usage.diskTotalBytes : 0}
                total={formatBytes(usage.diskTotalBytes)}
                used={formatBytes(usage.diskUsedBytes)}
              />
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="rounded-xl border border-white/5 bg-black/40 p-3">
                  <p className="text-[11px] text-zinc-500">Network in</p>
                  <p className="mt-1 text-[14px] font-semibold tabular-nums text-zinc-100">{formatBytes(usage.netInBytes)}</p>
                </div>
                <div className="rounded-xl border border-white/5 bg-black/40 p-3">
                  <p className="text-[11px] text-zinc-500">Network out</p>
                  <p className="mt-1 text-[14px] font-semibold tabular-nums text-zinc-100">{formatBytes(usage.netOutBytes)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden rounded-2xl">
            <CardHeader className="border-b border-white/5">
              <CardTitle>Resource usage</CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              <p className="text-[13px] text-zinc-500">
                Resource metrics are only available when the container is running.
              </p>
            </CardContent>
          </Card>
        )}

        <PortScanCard
          deploymentId={deployment.id}
          deploymentType={deployment.type}
          ip={sshHost ?? deployment.ipAddress}
          siteSlug={siteSlug}
        />
      </div>

      <DeploymentBackupCard
        backupInfo={backupInfo}
        defaultBackupStorage={settings.defaultBackupStorage}
        deploymentId={deployment.id}
        deploymentType={deployment.type}
        isAdmin={canRunDestructiveActions}
        restoreTargetNode={deployment.node}
        restoreTargetStorage={restoreTargetStorage}
        vmid={deployment.vmid}
      />

      <DeploymentSnapshotCard
        deploymentId={deployment.id}
        isAdmin={canRunDestructiveActions}
        siteSlug={siteSlug}
        snapshots={snapshots}
      />

      <DeploymentActivityCard activities={activityLog} />

      {netPath ? (
        <DeploymentNetworkPathCard path={netPath} siteSlug={siteSlug} />
      ) : null}

      {firewallOptions && firewallRules ? (
        <DeploymentFirewallCard
          siteSlug={siteSlug}
          deploymentId={deployment.id}
          options={firewallOptions}
          rules={firewallRules}
          canManage={Boolean(
            session &&
              (canRunDestructiveActions ||
                hasSitePermission(session, siteConfig.siteId, "manage-security")),
          )}
        />
      ) : null}

      {deployment.type !== "qemu" && (
        <DeploymentEnvEditor deployment={deployment} />
      )}

      {/* Container / VM details at bottom */}
      <Card className="overflow-hidden rounded-2xl">
        <CardHeader className="border-b border-white/5">
          <CardTitle>{deployment.type === "qemu" ? "VM details" : "Container details"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {deployment.type === "qemu" ? (
            <div className="grid divide-y divide-zinc-800/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <div className="divide-y divide-zinc-800/60">
                <div className="px-5 py-3.5">
                  <p className="text-[12px] font-medium text-zinc-500">CPU type</p>
                  <p className="mt-1 text-[13px] text-zinc-300">{deployment.vmCpuType || "Default"}</p>
                </div>
                <div className="px-5 py-3.5">
                  <p className="text-[12px] font-medium text-zinc-500">Machine type</p>
                  <p className="mt-1 text-[13px] text-zinc-300">{deployment.vmMachineType || "Default"}</p>
                </div>
                <div className="px-5 py-3.5">
                  <p className="text-[12px] font-medium text-zinc-500">SCSI hardware</p>
                  <p className="mt-1 text-[13px] text-zinc-300">{deployment.vmScsiHw || "Default"}</p>
                </div>
              </div>
              <div className="divide-y divide-zinc-800/60">
                <div className="px-5 py-3.5">
                  <p className="text-[12px] font-medium text-zinc-500">VGA</p>
                  <p className="mt-1 text-[13px] text-zinc-300">{deployment.vmVga || "Default"}</p>
                </div>
                <div className="px-5 py-3.5">
                  <p className="text-[12px] font-medium text-zinc-500">ISO</p>
                  <p className="mt-1 break-all text-[13px] text-zinc-300">{deployment.vmIso || "None"}</p>
                </div>
                <div className="px-5 py-3.5">
                  <p className="text-[12px] font-medium text-zinc-500">Description</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">{deployment.description || "No description configured."}</p>
                </div>
                {(deployment.tagList.length > 0 || latestActivity) && (
                  <div className="px-5 py-3.5">
                    <p className="text-[12px] font-medium text-zinc-500">Tags</p>
                    <DeploymentTagList
                      className="mt-2"
                      latestActivity={latestActivity}
                      tagList={deployment.tagList}
                      tags={tags}
                    />
                  </div>
                )}
                <div className="px-5 py-3.5">
                  <p className="text-[12px] font-medium text-zinc-500">Config digest</p>
                  <p className="mt-1 break-all text-[12px] font-mono text-zinc-500">{deployment.digest || "Unavailable"}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid divide-y divide-zinc-800/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <div className="divide-y divide-zinc-800/60">
                <div className="px-5 py-3.5">
                  <p className="text-[12px] font-medium text-zinc-500">Template source</p>
                  <p className="mt-1 break-all text-[13px] text-zinc-300">{deployment.ostemplate || "Unavailable"}</p>
                </div>
                <div className="px-5 py-3.5">
                  <p className="text-[12px] font-medium text-zinc-500">Environment</p>
                  <p className="mt-1 text-[13px] text-zinc-300">{deployment.environmentMode} · {deployment.envCount} keys</p>
                </div>
                <div className="px-5 py-3.5">
                  <p className="text-[12px] font-medium text-zinc-500">Config digest</p>
                  <p className="mt-1 break-all text-[12px] font-mono text-zinc-500">{deployment.digest || "Unavailable"}</p>
                </div>
              </div>
              <div className="divide-y divide-zinc-800/60">
                <div className="px-5 py-3.5">
                  <p className="text-[12px] font-medium text-zinc-500">Description</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">{deployment.description || "No description configured."}</p>
                </div>
                {(deployment.tagList.length > 0 || latestActivity) && (
                  <div className="px-5 py-3.5">
                    <p className="text-[12px] font-medium text-zinc-500">Tags</p>
                    <DeploymentTagList
                      className="mt-2"
                      latestActivity={latestActivity}
                      tagList={deployment.tagList}
                      tags={tags}
                    />
                  </div>
                )}
                <div className="px-5 py-3.5">
                  <p className="text-[12px] font-medium text-zinc-500">Rootfs</p>
                  <p className="mt-1 text-[13px] text-zinc-300">{deployment.rootfs}</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
