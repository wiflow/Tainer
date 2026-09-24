import Link from "next/link";
import { ArrowLeft, Layers3, Monitor } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireSitePageAccess } from "@/lib/page-guard";
import { ensureSiteConfig } from "@/lib/site-context";
import { listVmTemplates } from "@/lib/vm-templates";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CreateVmFromTemplatePage({
  params,
}: {
  params: Promise<{ siteSlug: string }>;
}) {
  const { siteSlug } = await params;
  await requireSitePageAccess(siteSlug);
  await ensureSiteConfig(siteSlug);

  const templates = await listVmTemplates();

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
            Create VM from template
          </h1>
        </div>
        <p className="mt-1 text-[13px] text-zinc-500">
          Choose a saved VM template and open its launch form with the defaults already applied.
        </p>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-[#111113] p-10 text-center">
          <p className="text-sm font-medium text-zinc-200">
            No VM templates have been created yet.
          </p>
          <p className="mt-2 text-[13px] text-zinc-500">
            Save a reusable VM template first, then launch new VMs from it here.
          </p>
          <Link
            className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "mt-5")}
            href={`/sites/${siteSlug}/templates/create-vm`}
          >
            Create VM template
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {templates.map((template) => (
            <Card
              key={template.id}
              className="overflow-hidden rounded-2xl border-white/5 bg-[#111113] transition-colors hover:border-white/10 hover:bg-zinc-900/80"
            >
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <p className="font-medium text-zinc-100">{template.name}</p>
                    <span className="rounded-full border border-white/5 bg-zinc-950/80 px-2.5 py-1 text-[11px] text-zinc-400">
                      VM template
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-zinc-500">
                    <span className="flex items-center gap-1.5">
                      <Layers3 className="h-3.5 w-3.5" />
                      {template.node}
                    </span>
                    <span className="hidden h-3 w-px bg-zinc-800 sm:block" />
                    <span>{template.memory} MB · {template.cores} cores · {template.sockets} sockets</span>
                    <span className="hidden h-3 w-px bg-zinc-800 sm:block" />
                    <span>{template.diskSize} GB on {template.diskStorage}</span>
                  </div>
                  <p className="mt-1.5 text-[12px] text-zinc-600">
                    {template.isoFileName || "No ISO preselected"} · {template.bridge || "vmbr0"}
                  </p>
                  {template.description ? (
                    <p className="mt-1 text-[12px] text-zinc-500">{template.description}</p>
                  ) : null}
                </div>

                <Link
                  className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "shrink-0")}
                  href={`/sites/${siteSlug}/templates/vm/${template.id}`}
                >
                  Create VM
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
