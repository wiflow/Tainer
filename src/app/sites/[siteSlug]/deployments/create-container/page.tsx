import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ContainerImagePicker } from "@/components/container-image-picker";
import { ProxmoxIssues } from "@/components/proxmox-issues";
import { buttonVariants } from "@/components/ui/button";
import { getTemplateInventory, withSiteConfig } from "@/lib/proxmox";
import { ensureSiteConfig } from "@/lib/site-context";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CreateContainerPage({
  params,
}: {
  params: Promise<{ siteSlug: string }>;
}) {
  const { siteSlug } = await params;
  const siteConfig = await ensureSiteConfig(siteSlug);

  const { issues, templates } = await withSiteConfig(siteConfig, () =>
    getTemplateInventory(),
  );

  return (
    <div className="space-y-4">
      <Link
        className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "-ml-3")}
        href={`/sites/${siteSlug}/deployments`}
      >
        <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
        Deployments
      </Link>

      <ProxmoxIssues
        description="Container creation depends on your token being able to see CT template storage and images."
        issues={issues}
      />

      {templates.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-[#111113] p-10 text-center">
          <p className="text-sm font-medium text-zinc-200">
            No base CT images are visible right now.
          </p>
          <p className="mt-2 text-[13px] text-zinc-500">
            Import or sync a CT image first, then come back here to launch a container.
          </p>
          <Link
            className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "mt-5")}
            href={`/sites/${siteSlug}/images`}
          >
            Open image library
          </Link>
        </div>
      ) : (
        <ContainerImagePicker templates={templates} />
      )}
    </div>
  );
}
