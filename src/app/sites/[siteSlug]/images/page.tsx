import Link from "next/link";
import { ArrowRight, FolderArchive, HardDriveDownload, Package, Search } from "lucide-react";
import { unstable_cache } from "next/cache";

import { CustomRegistryPullPanel } from "@/components/custom-registry-pull-panel";
import { IntentLink } from "@/components/intent-link";
import { ProxmoxIssues } from "@/components/proxmox-issues";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { SectionPanel } from "@/components/ui/section-panel";
import { MetricCard } from "@/components/ui/metric-card";
import { getDockerHubOverview } from "@/lib/docker-hub";
import { getGiteaOverview, isGiteaConfigured } from "@/lib/gitea";
import { getTemplateLibraryIndex, withSiteConfig } from "@/lib/proxmox";
import { ensureSiteConfig } from "@/lib/site-context";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ImagesPageQuery = {
  name?: string;
  namespace?: string;
  page?: string;
  q?: string;
  source?: string;
};

type ImagesPageData = {
  dockerOverview: DockerHubOverview | null;
  giteaOverview: GiteaOverview | null;
  templateIndex: Awaited<ReturnType<typeof getTemplateLibraryIndex>>;
};

type ImagesPageCacheInput = {
  name?: string;
  namespace?: string;
  page?: string;
  q?: string;
  source: "docker-hub" | "gitea";
};

const getImagesPageData = unstable_cache(
  async (siteSlug: string, serializedInput: string): Promise<ImagesPageData> => {
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return withSiteConfig(siteConfig, async () => {
      const input = JSON.parse(serializedInput) as ImagesPageCacheInput;

      const [templateIndex, dockerOverview, giteaOverview] = await Promise.all([
        getTemplateLibraryIndex(),
        input.source === "docker-hub"
          ? getDockerHubOverview(input)
          : Promise.resolve(null),
        input.source === "gitea" ? getGiteaOverview(input) : Promise.resolve(null),
      ]);

      return {
        dockerOverview,
        giteaOverview,
        templateIndex,
      };
    });
  },
  ["images-page-data"],
  { revalidate: 15 },
);

type ImagesPageProps = {
  params: Promise<{ siteSlug: string }>;
  searchParams: Promise<ImagesPageQuery>;
};

export default async function ImagesPage({ params, searchParams }: ImagesPageProps) {
  const { siteSlug } = await params;
  await ensureSiteConfig(siteSlug);

  const searchParamsResolved = await searchParams;
  const giteaEnabled = isGiteaConfigured();
  const source = searchParamsResolved.source === "gitea" && giteaEnabled ? "gitea" : "docker-hub";

  const { templateIndex, dockerOverview, giteaOverview } = await getImagesPageData(
    siteSlug,
    JSON.stringify({
      name: searchParamsResolved.name,
      namespace: searchParamsResolved.namespace,
      page: searchParamsResolved.page,
      q: searchParamsResolved.q,
      source,
    } satisfies ImagesPageCacheInput),
  );
  const recentTemplates = [...templateIndex.templates]
    .sort((left, right) => {
      const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;

      return rightTime - leftTime;
    })
    .slice(0, 12);

  return (
    <div className="space-y-4">

      {giteaEnabled ? (
        <div className="flex gap-1 rounded-lg border border-white/5 bg-[#111113] p-1 w-fit">
          <IntentLink
            className={cn(
              "rounded-md px-4 py-2 text-[13px] font-medium transition-colors",
              source === "docker-hub"
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200",
            )}
            href={`/sites/${siteSlug}/images?source=docker-hub`}
          >
            Docker Hub
          </IntentLink>
          <IntentLink
            className={cn(
              "rounded-md px-4 py-2 text-[13px] font-medium transition-colors",
              source === "gitea"
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200",
            )}
            href={`/sites/${siteSlug}/images?source=gitea`}
          >
            Gitea
          </IntentLink>
        </div>
      ) : null}

      {source === "docker-hub" && dockerOverview ? (
        <DockerHubView
          overview={dockerOverview}
          recentTemplates={recentTemplates}
          siteSlug={siteSlug}
          targets={templateIndex.targets}
          templateCount={templateIndex.templates.length}
          templateIssues={templateIndex.issues}
        />
      ) : null}

      {source === "gitea" && giteaOverview ? (
        <GiteaView
          overview={giteaOverview}
          recentTemplates={recentTemplates}
          siteSlug={siteSlug}
          targets={templateIndex.targets}
          templateCount={templateIndex.templates.length}
          templateIssues={templateIndex.issues}
        />
      ) : null}

      <CustomRegistryPullPanel targets={templateIndex.targets} />
    </div>
  );
}

import type { DockerHubOverview } from "@/lib/docker-hub";
import type { GiteaOverview, GiteaIssue } from "@/lib/gitea";
import type { LiveTemplate, ProxmoxIssue, TemplateTarget } from "@/lib/proxmox";

function DockerHubView({
  overview,
  recentTemplates,
  siteSlug,
  targets,
  templateCount,
  templateIssues,
}: {
  overview: DockerHubOverview;
  recentTemplates: LiveTemplate[];
  siteSlug: string;
  targets: TemplateTarget[];
  templateCount: number;
  templateIssues: ProxmoxIssue[];
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          icon={<Search className="w-3.5 h-3.5" />}
          label="Hub matches"
          value={String(overview.totalRepositories?.toLocaleString() ?? overview.repositories.length)}
          description={
            overview.searchMode === "global"
              ? `Searching all Docker Hub repositories for "${overview.nameFilter}".`
              : `Browsing namespace "${overview.namespace}" with no global search query.`
          }
        />
        <MetricCard
          icon={<FolderArchive className="w-3.5 h-3.5" />}
          label="CT templates"
          value={String(templateCount)}
          description={`Proxmox currently sees ${templateCount.toLocaleString()} CT template archives.`}
        />
        <MetricCard
          icon={<HardDriveDownload className="w-3.5 h-3.5" />}
          label="Target storage"
          value={targets.length > 0 ? "Available" : "Unavailable"}
          description={
            targets.length > 0
              ? targets.map((target) => `${target.storage} (${target.node})`).join(", ")
              : "No Proxmox storage with CT template support is available to this token."
          }
        />
      </div>

      <ProxmoxIssues
        description="These notes cover Docker Hub reads and Proxmox CT template storage visibility."
        issues={[...overview.issues, ...templateIssues]}
        title="Docker Hub & Proxmox notes"
      />

      <SectionPanel
        title="Search Docker Hub"
        description="Enter a search query to use Docker Hub's global repository search. Leave it blank to browse a specific namespace like `library`."
      >
        <form action={`/sites/${siteSlug}/images`} className="grid gap-3 sm:grid-cols-[180px_1fr_auto]">
          <input name="source" type="hidden" value="docker-hub" />
          <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <span className="text-[12px] font-medium text-zinc-500">Browse namespace</span>
            <input
              className="mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500"
              defaultValue={overview.namespace}
              name="namespace"
              type="text"
            />
          </label>

          <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <span className="text-[12px] font-medium text-zinc-500">Search query</span>
            <input
              className="mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500"
              defaultValue={overview.nameFilter}
              name="name"
              placeholder="nginx, postgres, grafana, ..."
              type="text"
            />
          </label>

          <div className="flex items-end">
            <button className={cn(buttonVariants({ size: "md", variant: "primary" }))} type="submit">
              Search
            </button>
          </div>
        </form>
      </SectionPanel>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <SectionPanel
          title="Repositories"
          description={
            overview.totalRepositories != null
              ? overview.searchMode === "global"
                ? `${overview.totalRepositories.toLocaleString()} total matches across Docker Hub.`
                : `${overview.totalRepositories.toLocaleString()} total matches in namespace ${overview.namespace}.`
              : "Repository count unavailable."
          }
          noPadding
        >
          <div className="divide-y divide-white/5">
            {overview.repositories.length === 0 ? (
              <div className="px-4 py-3 text-[13px] text-zinc-500">
                {overview.searchMode === "global"
                  ? "No repositories matched this Docker Hub search query."
                  : "No repositories matched this namespace."}
              </div>
            ) : (
              overview.repositories.map((repository) => (
                <Link
                  key={repository.fullName}
                  className="block px-4 py-3 transition-colors hover:bg-white/5"
                  href={repository.path}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-[13px] font-semibold text-zinc-100">
                          {repository.fullName}
                        </h2>
                        <Badge
                          variant={
                            repository.isOfficial
                              ? "success"
                              : repository.isPrivate
                                ? "warning"
                                : "review"
                          }
                        >
                          {repository.isOfficial
                            ? "Official"
                            : repository.isPrivate
                              ? "Private"
                              : "Public"}
                        </Badge>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-zinc-400">
                        {repository.description}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-zinc-500">
                        <span>{repository.pullCount.toLocaleString()} pulls</span>
                        <span>{repository.starCount.toLocaleString()} stars</span>
                        <span>{repository.storageSize}</span>
                        <span>
                          {repository.lastUpdated
                            ? `Updated ${new Date(repository.lastUpdated).toLocaleDateString()}`
                            : "Update date unavailable"}
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600" />
                  </div>
                </Link>
              ))
            )}
          </div>
        </SectionPanel>

        <RecentTemplatesCard siteSlug={siteSlug} templates={recentTemplates} />
      </div>
    </>
  );
}

function GiteaView({
  overview,
  recentTemplates,
  siteSlug,
  targets,
  templateCount,
  templateIssues,
}: {
  overview: GiteaOverview;
  recentTemplates: LiveTemplate[];
  siteSlug: string;
  targets: TemplateTarget[];
  templateCount: number;
  templateIssues: ProxmoxIssue[];
}) {
  const giteaIssues: ProxmoxIssue[] = overview.issues.map((issue: GiteaIssue) => ({
    endpoint: issue.endpoint,
    message: issue.message,
    requiredPrivileges: issue.requiredPrivileges,
  }));

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          icon={<Package className="w-3.5 h-3.5" />}
          label="Gitea packages"
          value={String(overview.totalPackages?.toLocaleString() ?? overview.packages.length)}
          description={
            overview.query
              ? `Searching Gitea container packages for "${overview.query}".`
              : "Browsing all container packages in Gitea."
          }
        />
        <MetricCard
          icon={<FolderArchive className="w-3.5 h-3.5" />}
          label="CT templates"
          value={String(templateCount)}
          description={`Proxmox currently sees ${templateCount.toLocaleString()} CT template archives.`}
        />
        <MetricCard
          icon={<HardDriveDownload className="w-3.5 h-3.5" />}
          label="Target storage"
          value={targets.length > 0 ? "Available" : "Unavailable"}
          description={
            targets.length > 0
              ? targets.map((target) => `${target.storage} (${target.node})`).join(", ")
              : "No Proxmox storage with CT template support is available to this token."
          }
        />
      </div>

      <ProxmoxIssues
        description="These notes cover Gitea registry reads and Proxmox CT template storage visibility."
        issues={[...giteaIssues, ...templateIssues]}
        title="Gitea & Proxmox notes"
      />

      <SectionPanel
        title="Search Gitea Packages"
        description="Search container images hosted in your Gitea registry."
      >
        <form action={`/sites/${siteSlug}/images`} className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <input name="source" type="hidden" value="gitea" />
          <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <span className="text-[12px] font-medium text-zinc-500">Search query</span>
            <input
              className="mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500"
              defaultValue={overview.query}
              name="q"
              placeholder="nexusterm, alpine, ..."
              type="text"
            />
          </label>

          <div className="flex items-end">
            <button className={cn(buttonVariants({ size: "md", variant: "primary" }))} type="submit">
              Search
            </button>
          </div>
        </form>
      </SectionPanel>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <SectionPanel
          title="Container Images"
          description={
            overview.totalPackages != null
              ? `${overview.totalPackages.toLocaleString()} container package versions in Gitea.`
              : "Package count unavailable."
          }
          noPadding
        >
          <div className="divide-y divide-white/5">
            {overview.packages.length === 0 ? (
              <div className="px-4 py-3 text-[13px] text-zinc-500">
                {overview.query
                  ? "No container packages matched this search query."
                  : "No container packages found in this Gitea organization."}
              </div>
            ) : (
              overview.packages.map((pkg) => (
                <Link
                  key={pkg.name}
                  className="block px-4 py-3 transition-colors hover:bg-white/5"
                  href={pkg.path}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-[13px] font-semibold text-zinc-100">
                          {pkg.name}
                        </h2>
                        <Badge variant="review">Gitea</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-zinc-500">
                        <span>
                          {pkg.tagCount} {pkg.tagCount === 1 ? "tag" : "tags"}:{" "}
                          {pkg.tags.slice(0, 5).join(", ")}
                          {pkg.tags.length > 5 ? `, +${pkg.tags.length - 5} more` : ""}
                        </span>
                        <span>
                          {pkg.createdAt
                            ? `Updated ${new Date(pkg.createdAt).toLocaleDateString()}`
                            : "Update date unavailable"}
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600" />
                  </div>
                </Link>
              ))
            )}
          </div>
        </SectionPanel>

        <RecentTemplatesCard siteSlug={siteSlug} templates={recentTemplates} />
      </div>
    </>
  );
}

function RecentTemplatesCard({ siteSlug, templates }: { siteSlug: string; templates: LiveTemplate[] }) {
  return (
    <SectionPanel
      title="Recent Imported CT Templates"
      description="Native OCI and classic LXC templates that Proxmox currently sees on connected storage."
      noPadding
    >
      <div className="divide-y divide-white/5">
        {templates.length === 0 ? (
          <div className="px-4 py-3 text-[13px] text-zinc-500">
            No CT templates have been imported yet.
          </div>
        ) : (
          templates.map((template) => (
            <Link
              key={template.id}
              className="block px-4 py-3 transition-colors hover:bg-white/5"
              href={`/sites/${siteSlug}/templates/${template.id}`}
            >
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-semibold text-zinc-100">
                  {template.fileName}
                </p>
                <Badge variant="review">{template.storage}</Badge>
              </div>
              <p className="mt-1 text-[12px] text-zinc-500">
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
      </div>
    </SectionPanel>
  );
}
