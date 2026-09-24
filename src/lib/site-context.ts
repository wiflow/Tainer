import "server-only";

import { setSiteConfigForRequest, getActiveSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import type { ResolvedSiteConfig } from "@/lib/site-types";

export async function ensureSiteConfig(siteSlug: string): Promise<ResolvedSiteConfig> {
  try {
    const existing = getActiveSiteConfig();
    if (existing.siteSlug === siteSlug) return existing;
  } catch {}

  const config = await resolveSiteConfigBySlug(siteSlug);
  setSiteConfigForRequest(config);
  return config;
}
