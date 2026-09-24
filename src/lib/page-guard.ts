import "server-only";

import { notFound, redirect } from "next/navigation";

import { getCurrentSession, hasSiteAccess, type AuthSession } from "@/lib/auth";
import { getSiteBySlug, listEnabledSites } from "@/lib/site-store";
import type { SiteRecord } from "@/lib/site-types";

export async function requirePageSession(): Promise<AuthSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireSitePageAccess(
  siteSlug: string,
): Promise<{ session: AuthSession; site: SiteRecord }> {
  const session = await requirePageSession();
  const site = await getSiteBySlug(siteSlug);
  if (!site || !site.enabled) notFound();
  if (!hasSiteAccess(session, site.id)) {
    const fallback = (await listEnabledSites()).find((s) =>
      session.user.accessibleSiteIds.includes(s.id),
    );
    redirect(fallback ? `/sites/${fallback.slug}` : "/");
  }
  return { session, site };
}
