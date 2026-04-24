import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { DockerImageSyncPanel } from "@/components/docker-image-sync-panel";
import { ProxmoxIssues } from "@/components/proxmox-issues";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDockerHubRepositoryDetail } from "@/lib/docker-hub";
import { matchesOciTemplateFileName } from "@/lib/oci-template";
import { getTemplateLibraryIndex, withSiteConfig } from "@/lib/proxmox";
import { ensureSiteConfig } from "@/lib/site-context";
import { cn, truncateMiddle } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ImageDetailPageProps = {
  params: Promise<{
    siteSlug: string;
    namespace: string;
    repository: string;
  }>;
};

export default async function ImageDetailPage({ params }: ImageDetailPageProps) {
  const { siteSlug, namespace, repository } = await params;
  const siteConfig = await ensureSiteConfig(siteSlug);

  const [detail, templateIndex] = await withSiteConfig(siteConfig, () =>
    Promise.all([
      getDockerHubRepositoryDetail(namespace, repository),
      getTemplateLibraryIndex(),
    ]),
  );

  if (!detail.repository) {
    notFound();
  }

  const linuxCompatibleTags = detail.tags.filter(
    (tag) =>
      tag.platforms.length === 0 ||
      tag.platforms.some((platform) => platform.startsWith("linux/")),
  );
  const pullableTags =
    linuxCompatibleTags.length > 0 ? linuxCompatibleTags : detail.tags;
  const hiddenUnsupportedTagCount = Math.max(detail.tags.length - pullableTags.length, 0);
  const importedTemplates = templateIndex.templates.filter((template) =>
    matchesOciTemplateFileName(namespace, repository, template.fileName),
  );
  const issues = [...detail.issues, ...templateIndex.issues];

  return (
    <div className="space-y-8">
      <div>
        <Link
          className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "mb-4 -ml-3")}
          href={`/sites/${siteSlug}/images`}
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Image library
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
            {detail.repository.fullName}
          </h1>
          <Badge
            variant={
              detail.repository.isOfficial
                ? "success"
                : detail.repository.isPrivate
                  ? "warning"
                  : "review"
            }
          >
            {detail.repository.isOfficial
              ? "Official"
              : detail.repository.isPrivate
                ? "Private"
                : "Public"}
          </Badge>
        </div>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-zinc-400">
          {detail.repository.description}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/5 bg-zinc-800 sm:grid-cols-4">
        {[
          { label: "Pulls", value: detail.repository.pullCount.toLocaleString() },
          { label: "Stars", value: detail.repository.starCount.toLocaleString() },
          { label: "Storage size", value: detail.repository.storageSize },
          {
            label: "Updated",
            value: detail.repository.lastUpdated
              ? new Date(detail.repository.lastUpdated).toLocaleDateString()
              : "Unavailable",
          },
        ].map((item) => (
          <div key={item.label} className="bg-zinc-900/80 px-4 py-3">
            <p className="text-[11px] font-medium text-zinc-500">{item.label}</p>
            <p className="mt-1 text-[13px] text-zinc-200">{item.value}</p>
          </div>
        ))}
      </div>

      <ProxmoxIssues
        description="These notes cover Docker Hub reads and Proxmox CT template access for native OCI pulls."
        issues={issues}
        title="Docker Hub & Proxmox notes"
      />

      <DockerImageSyncPanel
        namespace={detail.repository.namespace}
        repository={detail.repository.name}
        tags={pullableTags}
        targets={templateIndex.targets}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-b border-white/5">
            <CardTitle>Recent tags</CardTitle>
            <CardDescription>
              {hiddenUnsupportedTagCount > 0
                ? `${hiddenUnsupportedTagCount.toLocaleString()} Windows-only or unsupported tags are hidden to keep CT pulls Linux-compatible.`
                : "Docker Hub tag data for this repository, limited to Linux-compatible CT pull targets."}
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-zinc-800/60 p-0">
            {pullableTags.length === 0 ? (
              <div className="px-5 py-4 text-[13px] text-zinc-500">
                No Linux-compatible tags were returned for this repository.
              </div>
            ) : (
              pullableTags.map((tag) => (
                <div key={tag.name} className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-semibold text-zinc-100">{tag.name}</p>
                    <Badge variant="neutral">{tag.fullSize}</Badge>
                  </div>
                  <p className="mt-1 text-[12px] text-zinc-500">
                    {truncateMiddle(tag.digest, 12, 10)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {tag.platforms.length > 0 ? (
                      tag.platforms.map((platform) => (
                        <span
                          key={`${tag.name}-${platform}`}
                          className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400"
                        >
                          {platform}
                        </span>
                      ))
                    ) : (
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">
                        Platform list unavailable
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-[12px] text-zinc-500">
                    {tag.lastUpdated
                      ? `Updated ${new Date(tag.lastUpdated).toLocaleString()}`
                      : "Update time unavailable"}
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
              Native Proxmox CT templates currently stored for this repository.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-zinc-800/60 p-0">
            {importedTemplates.length === 0 ? (
              <div className="px-5 py-4 text-[13px] text-zinc-500">
                No Proxmox CT templates for this repository have been pulled yet.
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
