import Link from "next/link";
import { ArrowRight, Box, Layers3, Tag } from "lucide-react";
import { unstable_cache } from "next/cache";

import { requireSitePageAccess } from "@/lib/page-guard";
import { ensureSiteConfig } from "@/lib/site-context";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

import { TagsBoard } from "@/components/tags-board";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { listContainerTags } from "@/lib/container-groups";
import { getDeploymentIndex, withSiteConfig } from "@/lib/proxmox";
import { extractManagedTagSlugs } from "@/lib/tag-utils";
import { cn } from "@/lib/utils";

// Avoid `force-dynamic` here — it silently disables the unstable_cache below.
const getTagsPageData = unstable_cache(
  async (siteSlug: string) => {
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return withSiteConfig(siteConfig, async () => {
      return Promise.all([
        listContainerTags(),
        getDeploymentIndex(),
      ]);
    });
  },
  ["tags-page-data"],
  { revalidate: 5 },
);

export default async function TagsPage({
  params,
}: {
  params: Promise<{ siteSlug: string }>;
}) {
  const { siteSlug } = await params;
  await requireSitePageAccess(siteSlug);
  await ensureSiteConfig(siteSlug);

  const [tags, { deployments }] = await getTagsPageData(siteSlug);

  // Compute per-tag stats by scanning deployment tagList for grp:* tags
  const memberCounts: Record<string, number> = {};
  const statusCounts: Record<string, { running: number; stopped: number; total: number }> = {};

  let taggedContainers = 0;

  for (const tag of tags) {
    memberCounts[tag.slug] = 0;
    statusCounts[tag.slug] = { running: 0, stopped: 0, total: 0 };
  }

  for (const deployment of deployments) {
    const tagSlugs = extractManagedTagSlugs(deployment.tagList)
      .filter((slug) => memberCounts[slug] !== undefined);

    if (tagSlugs.length === 0) continue;

    taggedContainers++;

    for (const slug of tagSlugs) {
      memberCounts[slug]++;
      statusCounts[slug].total++;

      if (deployment.rawStatus === "running") {
        statusCounts[slug].running++;
      } else if (deployment.rawStatus === "stopped") {
        statusCounts[slug].stopped++;
      }
    }
  }

  const untaggedContainers = deployments.length - taggedContainers;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Link
          className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}
          href={`/sites/${siteSlug}/tags/create`}
        >
          Create tag
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          icon={<Tag className="w-3.5 h-3.5" />}
          label="Total tags"
          value={String(tags.length)}
          description="Logical tags defined for organizing your deployments."
        />
        <MetricCard
          icon={<Layers3 className="w-3.5 h-3.5" />}
          label="Tagged"
          value={String(taggedContainers)}
          description="Deployments currently assigned to at least one tag."
        />
        <MetricCard
          icon={<Box className="w-3.5 h-3.5" />}
          label="Untagged"
          value={String(untaggedContainers)}
          description="Deployments not yet assigned to any tag."
        />
      </div>

      <TagsBoard tags={tags} memberCounts={memberCounts} statusCounts={statusCounts} />
    </div>
  );
}
