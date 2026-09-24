import { notFound, redirect } from "next/navigation";

import { getCurrentSession, hasSiteAccess } from "@/lib/auth";
import { setSiteConfigForRequest } from "@/lib/proxmox";
import { resolveSiteConfig } from "@/lib/site-resolver";
import { getSiteBySlug, listEnabledSites } from "@/lib/site-store";
import { SiteTracker } from "./site-tracker";

export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ siteSlug: string }>;
}) {
  const { siteSlug } = await params;
  const site = await getSiteBySlug(siteSlug);

  if (!site || !site.enabled) {
    notFound();
  }

  // Check site access for non-admin users
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login");
  }
  if (!hasSiteAccess(session, site.id)) {
    // Redirect to first accessible site
    const allSites = await listEnabledSites();
    const accessible = allSites.filter((s) =>
      session.user.accessibleSiteIds.includes(s.id),
    );
    if (accessible.length > 0) {
      redirect(`/sites/${accessible[0].slug}`);
    } else {
      redirect("/");
    }
  }

  const config = await resolveSiteConfig(site);

  // Store the config in the per-request React.cache() so that all
  // downstream page components can access it via getActiveSiteConfig().
  setSiteConfigForRequest(config);

  return (
    <>
      <SiteTracker siteSlug={siteSlug} />
      {children}
    </>
  );
}
