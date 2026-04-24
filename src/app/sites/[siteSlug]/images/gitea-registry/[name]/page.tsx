import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { GiteaImagePullPanel } from "@/components/gitea-image-pull-panel";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getGiteaPackageDetail } from "@/lib/gitea";
import { getTemplateLibraryIndex, withSiteConfig } from "@/lib/proxmox";
import { ensureSiteConfig } from "@/lib/site-context";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type GiteaImageDetailPageProps = {
  params: Promise<{ siteSlug: string; name: string }>;
};

export default async function GiteaImageDetailPage({ params }: GiteaImageDetailPageProps) {
  const { siteSlug, name } = await params;
  const siteConfig = await ensureSiteConfig(siteSlug);

  const [detail, templateIndex] = await withSiteConfig(siteConfig, () =>
    Promise.all([
      getGiteaPackageDetail(name),
      getTemplateLibraryIndex(),
    ]),
  );

  if (!detail) {
    notFound();
  }

  const importedTemplates = templateIndex.templates.filter(
    (template) =>
      template.fileName.startsWith(`${name}_`) && template.fileName.endsWith(".tar"),
  );

  return (
    <div className="space-y-8">
      <div>
        <Link
          className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "mb-4 -ml-3")}
          href={`/sites/${siteSlug}/images?source=gitea`}
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Image library
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
            {detail.name}
          </h1>
          <Badge variant="review">Gitea</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-zinc-400">
          Container image from your Gitea registry.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/5 bg-zinc-800 sm:grid-cols-3">
        <div className="bg-zinc-900/80 px-4 py-3">
          <p className="text-[11px] font-medium text-zinc-500">Tags</p>
          <p className="mt-1 text-[13px] text-zinc-200">{detail.tags.length}</p>
        </div>
        <div className="bg-zinc-900/80 px-4 py-3">
          <p className="text-[11px] font-medium text-zinc-500">Latest tag</p>
          <p className="mt-1 text-[13px] text-zinc-200">{detail.tags[0]?.name ?? "—"}</p>
        </div>
        <div className="bg-zinc-900/80 px-4 py-3">
          <p className="text-[11px] font-medium text-zinc-500">OCI reference</p>
          <p className="mt-1 break-all text-[13px] text-zinc-200">{detail.ociReference}</p>
        </div>
      </div>

      <GiteaImagePullPanel
        name={detail.name}
        ociReference={detail.ociReference}
        tags={detail.tags}
        targets={templateIndex.targets}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-b border-white/5">
            <CardTitle>Tags</CardTitle>
            <CardDescription>
              All known versions of this container package in Gitea.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-zinc-800/60 p-0">
            {detail.tags.length === 0 ? (
              <div className="px-5 py-4 text-[13px] text-zinc-500">
                No tags found for this package.
              </div>
            ) : (
              detail.tags.map((tag) => (
                <div key={tag.name} className="px-5 py-4">
                  <p className="text-[13px] font-semibold text-zinc-100">{tag.name}</p>
                  <p className="mt-1 text-[12px] text-zinc-500">
                    {tag.createdAt
                      ? `Created ${new Date(tag.createdAt).toLocaleString()}`
                      : "Created time unavailable"}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-white/5">
            <CardTitle>Imported CT Templates</CardTitle>
            <CardDescription>
              Proxmox CT templates currently stored for this image.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-zinc-800/60 p-0">
            {importedTemplates.length === 0 ? (
              <div className="px-5 py-4 text-[13px] text-zinc-500">
                No Proxmox CT templates for this image have been pulled yet.
              </div>
            ) : (
              importedTemplates.map((template) => (
                <Link
                  key={template.id}
                  className="block px-5 py-4 transition-colors hover:bg-zinc-800/30"
                  href={`/sites/${siteSlug}/templates/${template.id}`}
                >
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-semibold text-zinc-100">
                      {template.fileName}
                    </p>
                    <Badge variant="review">{template.storage}</Badge>
                  </div>
                  <p className="mt-1 break-all text-[12px] text-zinc-500">
                    {template.volid}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-zinc-500">
                    <span>{template.sizeLabel}</span>
                    <span>
                      {template.createdAt
                        ? `Created ${new Date(template.createdAt).toLocaleString()}`
                        : "Created time unavailable"}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
