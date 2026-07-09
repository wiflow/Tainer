import Link from "next/link";
import { ArrowLeft, Monitor } from "lucide-react";
import { notFound } from "next/navigation";

import { VmTemplateLaunchPanel } from "@/components/vm-template-launch-panel";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSuggestedNode } from "@/lib/load-balancer";
import { getDiskStorageTargets, getNextId, getNodes, listIsoImages, withSiteConfig } from "@/lib/proxmox";
import { ensureSiteConfig } from "@/lib/site-context";
import { getVmTemplate } from "@/lib/vm-templates";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type VmTemplatePageProps = {
  params: Promise<{ siteSlug: string; id: string }>;
};

export default async function VmTemplateDetailPage({ params }: VmTemplatePageProps) {
  const { siteSlug, id } = await params;
  const siteConfig = await ensureSiteConfig(siteSlug);

  const template = await getVmTemplate(id);

  if (!template) {
    notFound();
  }

  const { nextId, nodes, metrics, isoResult, diskResult } = await withSiteConfig(siteConfig, async () => {
    const [nextId, { nodes, metrics }] = await Promise.all([
      getNextId(),
      getNodes(),
    ]);

    const [isoResult, diskResult] = await Promise.all([
      listIsoImages(nodes),
      getDiskStorageTargets(nodes),
    ]);

    return { nextId, nodes, metrics, isoResult, diskResult };
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
        <div className="flex flex-wrap items-center gap-2.5">
          <Monitor className="h-5 w-5 text-zinc-400" />
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
            {template.name}
          </h1>
          <Badge variant="review">VM</Badge>
          {template.accessReady ? <Badge variant="neutral">SSH-ready</Badge> : null}
        </div>
        {template.description && (
          <p className="mt-1 text-[13px] text-zinc-500">{template.description}</p>
        )}
      </div>

      {/* Template details */}
      <Card className="overflow-hidden rounded-2xl">
        <CardHeader className="border-b border-white/5">
          <CardTitle>Template configuration</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid divide-y divide-zinc-800/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <div className="divide-y divide-zinc-800/60">
              <div className="px-5 py-3.5">
                <p className="text-[12px] font-medium text-zinc-500">ISO image</p>
                <p className="mt-1 text-[13px] text-zinc-300">{template.isoFileName || "None"}</p>
              </div>
              <div className="px-5 py-3.5">
                <p className="text-[12px] font-medium text-zinc-500">Hardware</p>
                <p className="mt-1 text-[13px] text-zinc-300">
                  {template.cores} cores · {template.sockets} sockets · {template.memory} MB · {template.cpuType}
                </p>
              </div>
              <div className="px-5 py-3.5">
                <p className="text-[12px] font-medium text-zinc-500">Disk</p>
                <p className="mt-1 text-[13px] text-zinc-300">
                  {template.diskSize} GB on {template.diskStorage} · {template.scsihw}
                </p>
              </div>
            </div>
            <div className="divide-y divide-zinc-800/60">
              <div className="px-5 py-3.5">
                <p className="text-[12px] font-medium text-zinc-500">Machine</p>
                <p className="mt-1 text-[13px] text-zinc-300">
                  {template.machineType} · {template.osType} · VGA {template.vgaType}
                </p>
              </div>
              <div className="px-5 py-3.5">
                <p className="text-[12px] font-medium text-zinc-500">Network</p>
                <p className="mt-1 text-[13px] text-zinc-300">{template.bridge || "vmbr0"}</p>
              </div>
              <div className="px-5 py-3.5">
                <p className="text-[12px] font-medium text-zinc-500">Options</p>
                  <p className="mt-1 text-[13px] text-zinc-300">
                    {[
                      template.accessReady && `Managed SSH (${template.managedLoginUser})`,
                      template.cloudInitCapable && "Cloud-init capable",
                      template.enableQemuAgent && "QEMU Agent",
                      template.onboot && "Start on boot",
                      template.startAfterCreate && "Auto-start",
                  ].filter(Boolean).join(" · ") || "None"}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <VmTemplateLaunchPanel
        diskTargets={diskResult.targets}
        isoImages={isoResult.images}
        nextId={nextId}
        nodeMetrics={metrics}
        nodes={nodes}
        suggestedNode={getSuggestedNode(siteConfig.siteId)}
        template={template}
      />
    </div>
  );
}
