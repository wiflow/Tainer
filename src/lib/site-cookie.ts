import "server-only";

import { cookies } from "next/headers";

const COOKIE_NAME = "tainer_last_site";
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // 1 year

export async function getLastUsedSiteSlug(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

export async function setLastUsedSiteCookie(siteSlug: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, siteSlug, {
    httpOnly: true,
    maxAge: MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
