import Link from "next/link";
import { ArrowLeft, Monitor } from "lucide-react";

import { VmTemplateCreateForm } from "@/components/vm-template-create-form";
import { ProxmoxIssues } from "@/components/proxmox-issues";
import { buttonVariants } from "@/components/ui/button";
import { getDiskStorageTargets, getNodes, listIsoImages, withSiteConfig } from "@/lib/proxmox";
import { requireSitePageAccess } from "@/lib/page-guard";
import { ensureSiteConfig } from "@/lib/site-context";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CreateVmTemplatePage({
  params,
}: {
  params: Promise<{ siteSlug: string }>;
}) {
  const { siteSlug } = await params;
  await requireSitePageAccess(siteSlug);
  const siteConfig = await ensureSiteConfig(siteSlug);

  const { nodes, metrics, isoResult, diskResult } = await withSiteConfig(siteConfig, async () => {
    const { nodes, metrics } = await getNodes();
    const [isoResult, diskResult] = await Promise.all([
      listIsoImages(nodes),
      getDiskStorageTargets(nodes),
    ]);

    return { nodes, metrics, isoResult, diskResult };
  });

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
          <Monitor className="h-5 w-5 text-zinc-400" />
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
            Create VM template
          </h1>
        </div>
        <p className="mt-1 text-[13px] text-zinc-500">
          Save a reusable virtual machine configuration as a deployment template.
        </p>
      </div>

      <ProxmoxIssues
        description="VM template creation needs visibility into storage pools and ISO images."
        issues={[...isoResult.issues, ...diskResult.issues]}
      />

      <VmTemplateCreateForm
        defaultNode={nodes[0]?.name ?? ""}
        diskTargets={diskResult.targets}
        isoImages={isoResult.images}
        nodeMetrics={metrics}
        nodes={nodes}
      />
    </div>
  );
}
