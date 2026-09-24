import { requireSitePageAccess } from "@/lib/page-guard";
import { ensureSiteConfig } from "@/lib/site-context";

import { TagCreateForm } from "@/components/tag-create-form";

export default async function TagCreatePage({
  params,
}: {
  params: Promise<{ siteSlug: string }>;
}) {
  const { siteSlug } = await params;
  await requireSitePageAccess(siteSlug);
  await ensureSiteConfig(siteSlug);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
          Create tag
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          Define a new container tag for organizing and bulk operations.
        </p>
      </div>

      <TagCreateForm />
    </div>
  );
}
