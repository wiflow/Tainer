import "server-only";

import { redirect } from "next/navigation";

import { getCurrentSession, hasSiteAccess } from "@/lib/auth";
import { getLastUsedSiteSlug } from "@/lib/site-cookie";
import { getDefaultSite, getSiteBySlug, listEnabledSites } from "@/lib/site-store";

export async function resolveRedirectSiteSlug(): Promise<string | null> {
  const session = await getCurrentSession();
  const lastSlug = await getLastUsedSiteSlug();

  if (lastSlug) {
    const site = await getSiteBySlug(lastSlug);
    if (site?.enabled) {
      if (!session || hasSiteAccess(session, site.id)) {
        return site.slug;
      }
    }
  }

  if (session && session.user.role !== "admin") {
    const allSites = await listEnabledSites();
    const accessible = allSites.filter((s) =>
      session.user.accessibleSiteIds.includes(s.id),
    );
    if (accessible.length > 0) return accessible[0].slug;
    return null;
  }

  const defaultSite = await getDefaultSite();
  return defaultSite?.slug ?? null;
}

export async function redirectToSiteRoute(segment = ""): Promise<never> {
  const siteSlug = await resolveRedirectSiteSlug();

  if (!siteSlug) {
    redirect("/setup");
  }

  const target = segment
    ? `/sites/${siteSlug}/${segment}`
    : `/sites/${siteSlug}`;

  redirect(target);
}
