import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { DeploymentTemplateCreatePanel } from "@/components/deployment-template-create-panel";
import { ProxmoxIssues } from "@/components/proxmox-issues";
import { buttonVariants } from "@/components/ui/button";
import { getAppSettings, resolveDefaultRootfsStorage } from "@/lib/app-settings";
import { getImageEnvMap } from "@/lib/image-env-cache";
import { getTemplateAuthoringIndex, withSiteConfig } from "@/lib/proxmox";
import { requireSitePageAccess } from "@/lib/page-guard";
import { ensureSiteConfig } from "@/lib/site-context";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CreateTemplatePage({
  params,
}: {
  params: Promise<{ siteSlug: string }>;
}) {
  const { siteSlug } = await params;
  await requireSitePageAccess(siteSlug);
  const siteConfig = await ensureSiteConfig(siteSlug);

  const [{ issues, rootfsTargets, templates }, settings, imageEnvMap] =
    await withSiteConfig(siteConfig, () =>
      Promise.all([
        getTemplateAuthoringIndex(),
        getAppSettings(),
        getImageEnvMap(),
      ]),
    );
  const defaultRootfsStorage = resolveDefaultRootfsStorage(
    rootfsTargets,
    settings.defaultRootfsStorage,
  );

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
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
          Create Deployment Template
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          Save a reusable configuration on top of a base CT image so future deployments start from approved defaults.
        </p>
      </div>

      <ProxmoxIssues
        description="Template authoring depends on seeing both source CT images and rootfs-capable storage pools."
        issues={issues}
      />

      <DeploymentTemplateCreatePanel
        baseTemplates={templates}
        defaultRootfsStorage={defaultRootfsStorage}
        imageEnvMap={imageEnvMap}
        rootfsTargets={rootfsTargets}
      />
    </div>
  );
}
