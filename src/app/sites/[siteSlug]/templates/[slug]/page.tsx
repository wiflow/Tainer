import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { DeploymentTemplateLaunchPanel } from "@/components/deployment-template-launch-panel";
import { ProxmoxIssues } from "@/components/proxmox-issues";
import { TemplateFormPreview } from "@/components/template-form-preview";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAppSettings, resolveDefaultRootfsStorage } from "@/lib/app-settings";
import { listContainerTags } from "@/lib/container-groups";
import { getDeploymentTemplate } from "@/lib/deployment-templates";
import { cn } from "@/lib/utils";
import { getImageEnv } from "@/lib/image-env-cache";
import { getIpPoolCatalog } from "@/lib/ip-pools";
import { getSuggestedNode } from "@/lib/load-balancer";
import { getNodes, getRootfsTargets, getTemplateDetail, withSiteConfig } from "@/lib/proxmox";
import { requireSitePageAccess } from "@/lib/page-guard";
import { ensureSiteConfig } from "@/lib/site-context";

export const dynamic = "force-dynamic";

type TemplatePageProps = {
  params: Promise<{
    siteSlug: string;
    slug: string;
  }>;
};

function mapIpPoolsForLaunch(
  pools: Awaited<ReturnType<typeof getIpPoolCatalog>>,
  tags: Awaited<ReturnType<typeof listContainerTags>>,
) {
  const tagsBySlug = new Map(tags.map((tag) => [tag.slug, tag]));

  return pools.map((pool) => ({
    availableAddresses: pool.availableAddresses,
    availableCount: pool.availableCount,
    bridge: pool.bridge,
    defaultDns: pool.defaultDns,
    gateway: pool.gateway,
    hostPrefix: pool.hostPrefix,
    id: pool.id,
    ipamIssue: pool.ipamIssue,
    ipamUsedCount: pool.ipamUsedCount,
    name: pool.name,
    subnet: pool.subnet,
    tagName: pool.tagSlug ? (tagsBySlug.get(pool.tagSlug)?.name ?? null) : null,
    tainerUsedCount: pool.tainerUsedCount,
  }));
}

async function renderBaseImageDetail(slug: string, siteSlug: string, siteConfig: Awaited<ReturnType<typeof ensureSiteConfig>>) {
  const [{ issues, nextId, template }, rootfsResult, settings, { nodes, metrics: nodeMetrics }, ipPools, tags] = await withSiteConfig(siteConfig, () =>
    Promise.all([
      getTemplateDetail(slug),
      getRootfsTargets(),
      getAppSettings(),
      getNodes(),
      getIpPoolCatalog(),
      listContainerTags(),
    ]),
  );

  if (!template) {
    return null;
  }

  const rootfsTargets = rootfsResult.targets.filter(
    (target) => target.shared || target.node === template.node,
  );
  const defaultRootfsStorage = resolveDefaultRootfsStorage(
    rootfsTargets,
    settings.defaultRootfsStorage,
  );
  const combinedIssues = [...issues, ...rootfsResult.issues];
  const launchIpPools = mapIpPoolsForLaunch(ipPools, tags);

  return (
    <div className="space-y-8">
      <div>
        <Link
          className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "mb-4 -ml-3")}
          href={`/sites/${siteSlug}/images`}
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Base images
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
            {template.name}
          </h1>
          <Badge variant="neutral">Base CT image</Badge>
          <Badge variant="review">{template.storage}</Badge>
        </div>
        <p className="mt-2 max-w-2xl break-all text-[13px] leading-relaxed text-zinc-400">
          {template.volid}
        </p>
      </div>

      <ProxmoxIssues issues={combinedIssues} />

      <TemplateFormPreview
        defaultRootfsStorage={defaultRootfsStorage}
        imageEnv={await getImageEnv(template.volid)}
        ipPools={launchIpPools}
        issues={combinedIssues}
        nextId={nextId}
        nodeMetrics={nodeMetrics}
        nodes={nodes}
        rootfsTargets={rootfsTargets}
        suggestedNode={getSuggestedNode(siteConfig.siteId)}
        template={template}
      />
    </div>
  );
}

export default async function TemplateDetailPage({ params }: TemplatePageProps) {
  const { siteSlug, slug } = await params;
  await requireSitePageAccess(siteSlug);
  const siteConfig = await ensureSiteConfig(siteSlug);

  const deploymentTemplate = await getDeploymentTemplate(slug);

  if (deploymentTemplate) {
    const [rootfsResult, { nextId }, imageEnv, { nodes, metrics: nodeMetrics }, ipPools, tags] = await withSiteConfig(siteConfig, () =>
      Promise.all([
        getRootfsTargets(),
        getTemplateDetail(deploymentTemplate.sourceTemplateId),
        getImageEnv(deploymentTemplate.sourceVolid),
        getNodes(),
        getIpPoolCatalog(),
        listContainerTags(),
      ]),
    );
    const rootfsTargets = rootfsResult.targets.filter(
      (target) => target.shared || target.node === deploymentTemplate.node,
    );
    const selectedRootfsStorage = resolveDefaultRootfsStorage(
      rootfsTargets,
      deploymentTemplate.rootfsStorage,
    );

    deploymentTemplate.rootfsStorage = selectedRootfsStorage;
    const launchIpPools = mapIpPoolsForLaunch(ipPools, tags);

    return (
      <div className="space-y-8">
        <div>
          <Link
            className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "mb-4 -ml-3")}
            href={`/sites/${siteSlug}/templates`}
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Templates
          </Link>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
              {deploymentTemplate.name}
            </h1>
            <Badge variant="neutral">Deployment template</Badge>
            <Badge variant="review">{deploymentTemplate.sourceName}</Badge>
            {deploymentTemplate.accessReady ? <Badge variant="neutral">SSH-ready</Badge> : null}
          </div>
          <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-zinc-400">
            {deploymentTemplate.description || "Reusable standardized deployment defaults for this image."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/5 bg-zinc-800 sm:grid-cols-4">
          {[
            { label: "Source image", value: deploymentTemplate.sourceFileName },
            { label: "Rootfs", value: `${deploymentTemplate.rootfsStorage} · ${deploymentTemplate.rootfsSize} GB` },
            { label: "Runtime", value: `${deploymentTemplate.memory} MB · ${deploymentTemplate.cores} cores` },
            { label: "Network", value: deploymentTemplate.bridge || "vmbr0" },
          ].map((item) => (
            <div key={item.label} className="bg-zinc-900/80 px-4 py-3">
              <p className="text-[11px] font-medium text-zinc-500">{item.label}</p>
              <p className="mt-1 text-[13px] text-zinc-200">{item.value}</p>
            </div>
          ))}
        </div>

        <ProxmoxIssues
          description="Deployment templates depend on the source image still being present in Proxmox and on the selected rootfs pool remaining visible."
          issues={rootfsResult.issues}
        />

        <DeploymentTemplateLaunchPanel
          imageEnv={imageEnv}
          ipPools={launchIpPools}
          nextId={nextId}
          nodeMetrics={nodeMetrics}
          nodes={nodes}
          rootfsTargets={rootfsTargets}
          suggestedNode={getSuggestedNode(siteConfig.siteId)}
          template={deploymentTemplate}
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="border-b border-white/5">
              <CardTitle>Saved defaults</CardTitle>
              <CardDescription>
                This is what operators get prefilled when they deploy from this template.
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-zinc-800/60 p-0">
              {[
                `Hostname prefix: ${deploymentTemplate.hostnamePrefix || "Not set"}`,
                `Managed SSH access: ${deploymentTemplate.accessReady ? `Yes (${deploymentTemplate.managedLoginUser})` : "No"}`,
                `Unprivileged: ${deploymentTemplate.unprivileged ? "Yes" : "No"}`,
                `Start on boot: ${deploymentTemplate.onboot ? "Yes" : "No"}`,
                `Start after create: ${deploymentTemplate.startAfterCreate ? "Yes" : "No"}`,
              ].map((item) => (
                <div key={item} className="px-5 py-3 text-[13px] text-zinc-300">
                  {item}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-white/5">
              <CardTitle>Environment preset</CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-white/5 bg-zinc-950/80 px-4 py-3 text-[12px] text-zinc-300">
                {deploymentTemplate.envText || "# No default environment variables saved"}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const baseImagePage = await renderBaseImageDetail(slug, siteSlug, siteConfig);

  if (!baseImagePage) {
    notFound();
  }

  return baseImagePage;
}
