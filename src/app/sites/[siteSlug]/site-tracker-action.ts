"use server";

import { setLastUsedSiteCookie } from "@/lib/site-cookie";

export async function trackSiteVisit(siteSlug: string) {
  await setLastUsedSiteCookie(siteSlug);
}
