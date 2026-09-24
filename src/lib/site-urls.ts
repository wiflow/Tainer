export function siteUrl(siteSlug: string, segment = "") {
  const base = `/sites/${siteSlug}`;
  return segment ? `${base}/${segment.replace(/^\//, "")}` : base;
}

export const siteOverviewUrl = (slug: string) => siteUrl(slug);
export const siteDeploymentsUrl = (slug: string) => siteUrl(slug, "deployments");
export const siteDeploymentDetailUrl = (slug: string, id: string) => siteUrl(slug, `deployments/${id}`);
export const siteCreateContainerUrl = (slug: string) => siteUrl(slug, "deployments/create-container");
export const siteCreateVmUrl = (slug: string) => siteUrl(slug, "deployments/create-vm");
export const siteCreateVmFromTemplateUrl = (slug: string) => siteUrl(slug, "deployments/create-vm-from-template");
export const siteTemplatesUrl = (slug: string) => siteUrl(slug, "templates");
export const siteTemplateDetailUrl = (slug: string, templateSlug: string) => siteUrl(slug, `templates/${templateSlug}`);
export const siteTemplateCreateUrl = (slug: string) => siteUrl(slug, "templates/create");
export const siteTemplateCreateVmUrl = (slug: string) => siteUrl(slug, "templates/create-vm");
export const siteVmTemplateDetailUrl = (slug: string, id: string) => siteUrl(slug, `templates/vm/${id}`);
export const siteImagesUrl = (slug: string) => siteUrl(slug, "images");
export const siteImageDetailUrl = (slug: string, namespace: string, repo: string) => siteUrl(slug, `images/${namespace}/${repo}`);
export const siteGiteaImageDetailUrl = (slug: string, name: string) => siteUrl(slug, `images/gitea-registry/${name}`);
export const siteIsoImagesUrl = (slug: string) => siteUrl(slug, "iso-images");
export const siteBackupsUrl = (slug: string) => siteUrl(slug, "backups");
export const siteAlertsUrl = (slug: string) => siteUrl(slug, "alerts");
export const siteSettingsUrl = (slug: string) => siteUrl(slug, "settings");

export function analogousRouteForSite(
  currentPath: string,
  targetSlug: string,
): string {
  const siteRouteMatch = currentPath.match(/^\/sites\/[^/]+(\/.*)?$/);

  if (siteRouteMatch) {
    const rest = siteRouteMatch[1] ?? "";
    return `/sites/${targetSlug}${rest}`;
  }

  return siteOverviewUrl(targetSlug);
}

export function revalidateSitePath(siteSlug: string, segment: string) {
  return siteUrl(siteSlug, segment);
}

export function extractSiteSlugFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/sites\/([^/]+)/);
  return match?.[1] ?? null;
}
