import Link from "next/link";
import { ArrowLeft, Monitor } from "lucide-react";

import { VmCreateWizard } from "@/components/vm-create-wizard";
import { ProxmoxIssues } from "@/components/proxmox-issues";
import { buttonVariants } from "@/components/ui/button";
import { getDiskStorageTargets, getNextId, getNodes, listIsoImages, withSiteConfig } from "@/lib/proxmox";
import { ensureSiteConfig } from "@/lib/site-context";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CreateVmPage({
  params,
}: {
  params: Promise<{ siteSlug: string }>;
}) {
  const { siteSlug } = await params;
  const siteConfig = await ensureSiteConfig(siteSlug);

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

  const allIssues = [
    ...isoResult.issues,
    ...diskResult.issues,
  ];

  return (
    <div className="space-y-8">
      <div>
        <Link
          className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "mb-4 -ml-3")}
          href={`/sites/${siteSlug}/deployments`}
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Deployments
        </Link>
        <div className="flex items-center gap-2">
          <Monitor className="h-5 w-5 text-zinc-400" />
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
            Create virtual machine
          </h1>
        </div>
        <p className="mt-1 text-[13px] text-zinc-500">
          Configure and launch a QEMU/KVM virtual machine using an ISO image from your Proxmox storage.
        </p>
      </div>

      <ProxmoxIssues
        description="VM creation requires storage visibility and QEMU permissions on the target node."
        issues={allIssues}
      />

      <VmCreateWizard
        defaultNode={nodes[0]?.name ?? ""}
        diskTargets={diskResult.targets}
        isoImages={isoResult.images}
        nextId={nextId}
        nodeMetrics={metrics}
        nodes={nodes}
      />
    </div>
  );
}
