import "server-only";

import { decryptText } from "@/lib/crypto";
import { getDefaultSite, getSiteById, getSiteBySlug } from "@/lib/site-store";
import type { ResolvedSiteConfig, SiteRecord } from "@/lib/site-types";

const SITE_CONFIG_CACHE_TTL_MS = 30_000;
const resolvedSiteConfigCache = new Map<
  string,
  { expiresAt: number; value: ResolvedSiteConfig; version: string }
>();
const resolvedSiteConfigInflight = new Map<string, Promise<ResolvedSiteConfig>>();

function getSiteConfigVersion(site: SiteRecord) {
  return [
    site.updatedAt,
    site.payload.passwordEncrypted,
    site.payload.tlsCustomCaPem ?? "",
    site.payload.tlsFingerprint ?? "",
  ].join("::");
}

export async function resolveSiteConfig(
  site: SiteRecord,
): Promise<ResolvedSiteConfig> {
  const version = getSiteConfigVersion(site);
  const cached = resolvedSiteConfigCache.get(site.id);
  if (cached && cached.version === version && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const inflightKey = `${site.id}::${version}`;
  const inflight = resolvedSiteConfigInflight.get(inflightKey);
  if (inflight) {
    return inflight;
  }

  const request = (async () => {
    // Support both auth schemas:
    //   - New: username + passwordEncrypted
    //   - Legacy: tokenId + tokenSecretEncrypted (API token auth)
    const payload = site.payload as Record<string, unknown>;
    const encryptedField =
      (payload.passwordEncrypted as string | undefined) ??
      (payload.tokenSecretEncrypted as string | undefined);

    if (!encryptedField) {
      throw new Error(`Site "${site.name}" has no encrypted credentials.`);
    }

    const password = await decryptText(encryptedField);
    const username =
      (payload.username as string | undefined) ??
      (payload.tokenId as string | undefined) ??
      "root@pam";

    return {
      siteId: site.id,
      siteSlug: site.slug,
      siteName: site.name,

      apiUrl: site.payload.apiUrl,
      username,
      password,
      tlsInsecure: site.payload.tlsMode === "insecure",
      tlsFingerprint: site.payload.tlsFingerprint,
      tlsCustomCaPem: site.payload.tlsCustomCaPem ?? null,

      defaultNode: site.payload.defaultNode,
      defaultRootfsStorage: site.payload.defaultRootfsStorage,
      defaultVmStorage: site.payload.defaultVmStorage,
      defaultIsoStorage: site.payload.defaultIsoStorage,
      defaultBackupStorage: site.payload.defaultBackupStorage,
      defaultBackupSlaHours: site.payload.defaultBackupSlaHours,

      sshHostKeyPolicy: site.payload.sshHostKeyPolicy,
      consoleKnownHostsContent: site.payload.consoleKnownHostsContent,
    } satisfies ResolvedSiteConfig;
  })();

  resolvedSiteConfigInflight.set(inflightKey, request);

  try {
    const config = await request;
    resolvedSiteConfigCache.set(site.id, {
      expiresAt: Date.now() + SITE_CONFIG_CACHE_TTL_MS,
      value: config,
      version,
    });
    return config;
  } finally {
    resolvedSiteConfigInflight.delete(inflightKey);
  }
}

export async function resolveSiteConfigById(
  id: string,
): Promise<ResolvedSiteConfig> {
  const site = await getSiteById(id);

  if (!site) {
    throw new Error(`Site not found: ${id}`);
  }

  if (!site.enabled) {
    throw new Error(`Site is disabled: ${site.name}`);
  }

  return resolveSiteConfig(site);
}

export async function resolveSiteConfigBySlug(
  slug: string,
): Promise<ResolvedSiteConfig> {
  const site = await getSiteBySlug(slug);

  if (!site) {
    throw new Error(`Site not found: ${slug}`);
  }

  if (!site.enabled) {
    throw new Error(`Site is disabled: ${site.name}`);
  }

  return resolveSiteConfig(site);
}

export async function resolveDefaultSiteConfig(): Promise<ResolvedSiteConfig | null> {
  const site = await getDefaultSite();

  if (!site) {
    return null;
  }

  return resolveSiteConfig(site);
}
