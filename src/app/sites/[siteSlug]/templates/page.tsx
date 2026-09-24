import { unstable_cache } from "next/cache";

import { FileText, Download, Monitor, HardDrive } from "lucide-react";

import { CreateTemplateMenu } from "@/components/create-template-menu";
import { ProxmoxIssues } from "@/components/proxmox-issues";
import { TemplatesBoard } from "@/components/templates-board";
import { MetricCard } from "@/components/ui/metric-card";
import { getAppSettings, resolveDefaultRootfsStorage } from "@/lib/app-settings";
import { listDeploymentTemplates } from "@/lib/deployment-templates";
import { getTemplateAuthoringIndex, withSiteConfig } from "@/lib/proxmox";
import { requireSitePageAccess } from "@/lib/page-guard";
import { ensureSiteConfig } from "@/lib/site-context";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import { listVmTemplates } from "@/lib/vm-templates";

// Do not set force-dynamic here; it silently disables the unstable_cache below.
const getTemplatesPageData = unstable_cache(
  async (siteSlug: string) => {
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return withSiteConfig(siteConfig, async () => {
      return Promise.all([
        getTemplateAuthoringIndex(),
        listDeploymentTemplates(),
        listVmTemplates(),
        getAppSettings(),
      ]);
    });
  },
  ["templates-page-data"],
  { revalidate: 5 },
);

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ siteSlug: string }>;
}) {
  const { siteSlug } = await params;
  await requireSitePageAccess(siteSlug);
  await ensureSiteConfig(siteSlug);

  const [{ issues, rootfsTargets, templates }, deploymentTemplates, vmTemplates, settings] =
    await getTemplatesPageData(siteSlug);
  const defaultRootfsStorage = resolveDefaultRootfsStorage(
    rootfsTargets,
    settings.defaultRootfsStorage,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <CreateTemplateMenu />
      </div>

      <ProxmoxIssues
        description="Template authoring depends on seeing both source CT images and rootfs-capable storage pools."
        issues={issues}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<FileText className="w-3.5 h-3.5" />}
          label="Deployment templates"
          value={String(deploymentTemplates.length)}
          description="Standardized launch blueprints ready to deploy."
        />
        <MetricCard
          icon={<Download className="w-3.5 h-3.5" />}
          label="Base CT images"
          value={String(templates.length)}
          description="Imported raw images available as template sources."
        />
        <MetricCard
          icon={<Monitor className="w-3.5 h-3.5" />}
          label="VM templates"
          value={String(vmTemplates.length)}
          description="VM launch blueprints for QEMU/KVM machines."
        />
        <MetricCard
          icon={<HardDrive className="w-3.5 h-3.5" />}
          label="Default rootfs pool"
          value={defaultRootfsStorage || "Unset"}
          description="Pre-selected storage for new templates."
        />
      </div>

      <TemplatesBoard templates={deploymentTemplates} vmTemplates={vmTemplates} />
    </div>
  );
}
