import Link from "next/link";
import { ArrowLeft, Box, Play, Square } from "lucide-react";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";

import { requireSitePageAccess } from "@/lib/page-guard";
import { ensureSiteConfig } from "@/lib/site-context";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

import { DeploymentsBoard } from "@/components/deployments-board";
import { TagBulkActions } from "@/components/tag-bulk-actions";
import { TagBulkEnv } from "@/components/tag-bulk-env";
import { TagColorEditor } from "@/components/tag-color-editor";
import { TagDeleteButton } from "@/components/tag-delete-button";
import { TagMemberManager } from "@/components/tag-member-manager";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { getContainerTagBySlug, listContainerTags, TAG_PREFIX } from "@/lib/container-groups";
import { getDeploymentIndex, withSiteConfig } from "@/lib/proxmox";
import { getTagBadgeClass, hasManagedTag } from "@/lib/tag-utils";
import { cn } from "@/lib/utils";

// Avoid `force-dynamic` here — it silently disables the unstable_cache below.
const getTagDetailData = unstable_cache(
  async (siteSlug: string, slug: string) => {
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return withSiteConfig(siteConfig, async () => {
      return Promise.all([
        getContainerTagBySlug(slug),
        listContainerTags(),
        getDeploymentIndex(),
      ]);
    });
  },
  ["tag-detail-data"],
  { revalidate: 5 },
);

type TagDetailPageProps = {
  params: Promise<{ siteSlug: string; slug: string }>;
};

export default async function TagDetailPage({ params }: TagDetailPageProps) {
  const { siteSlug, slug } = await params;
  await requireSitePageAccess(siteSlug);
  await ensureSiteConfig(siteSlug);

  const [tag, allTags, { deployments }] = await getTagDetailData(siteSlug, slug);
  if (!tag) notFound();

  const tagEntry = `${TAG_PREFIX}${tag.slug}`;
  const members = deployments.filter((d) => d.tagList.includes(tagEntry));
  const nonMembers = deployments.filter(
    (d) => !hasManagedTag(d.tagList, tag.slug),
  );

  const stats = {
    attention: members.filter(
      (d) => d.rawStatus !== "running" && d.rawStatus !== "stopped",
    ).length,
    running: members.filter((d) => d.rawStatus === "running").length,
    stopped: members.filter((d) => d.rawStatus === "stopped").length,
    total: members.length,
  };

  return (
    <div className="space-y-8">
      {/* Back link + header */}
      <div>
        <Link
          className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "mb-4 -ml-3")}
          href={`/sites/${siteSlug}/tags`}
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Tags
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
                {tag.name}
              </h1>
              <Badge className={getTagBadgeClass(tag.color)}>
                {tag.color}
              </Badge>
              <TagColorEditor tagId={tag.id} currentColor={tag.color} description={tag.description} />
              <span className="text-[13px] text-zinc-500">
                {stats.total} {stats.total === 1 ? "member" : "members"}
              </span>
            </div>
            {tag.description && (
              <p className="mt-1 text-[13px] text-zinc-500">
                {tag.description}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TagDeleteButton
              memberCount={stats.total}
              redirectTo={`/sites/${siteSlug}/tags`}
              tagId={tag.id}
              tagName={tag.name}
            />
            <TagBulkActions
              tagSlug={tag.slug}
              hasRunning={stats.running > 0}
              hasStopped={stats.stopped > 0}
            />
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          icon={<Box className="w-3.5 h-3.5" />}
          label="Members"
          value={String(stats.total)}
          description="Total deployments assigned to this tag."
        />
        <MetricCard
          icon={<Play className="w-3.5 h-3.5" />}
          label="Running"
          value={String(stats.running)}
          description="Deployments currently running in this tag."
        />
        <MetricCard
          icon={<Square className="w-3.5 h-3.5" />}
          label="Stopped"
          value={String(stats.stopped)}
          description="Deployments currently stopped in this tag."
        />
      </div>

      {/* Bulk environment */}
      {members.length > 0 && (
        <TagBulkEnv
          tagSlug={tag.slug}
          memberCount={members.length}
          members={members.map((m) => ({ id: m.id, templateName: m.templateName }))}
        />
      )}

      {/* Member manager */}
      <TagMemberManager
        tagSlug={tag.slug}
        members={members}
        nonMembers={nonMembers}
        tags={allTags}
      />

      {/* Reuse deployments board for the member list */}
      {members.length > 0 && (
        <div>
          <h2 className="mb-4 text-sm font-semibold text-zinc-100">
            Tag members
          </h2>
          <DeploymentsBoard deployments={members} tags={allTags} />
        </div>
      )}
    </div>
  );
}
