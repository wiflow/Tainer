import "server-only";

import { randomUUID } from "node:crypto";

import { resolveDataFilePath } from "@/lib/app-data";
import { normalizeCountryCode } from "@/lib/countries";
import { encryptText } from "@/lib/crypto";
import type {
  ProxmoxSitePayload,
  SiteInput,
  SiteLocation,
  SiteRecord,
  SiteStore,
} from "@/lib/site-types";
import {
  createStoreMutator,
  readDataJsonFileCached,
  writeJsonFileAtomically,
} from "@/lib/store-utils";

const STORE_FILE = "sites.json";
const DEFAULT_BACKUP_SLA_HOURS = 24;

function emptySiteStore(): SiteStore {
  return {
    schemaVersion: 1,
    defaultSiteId: null,
    legacyImportedEnvSiteId: null,
    sites: [],
  };
}

async function readStore(): Promise<SiteStore> {
  return readDataJsonFileCached(STORE_FILE, {
    fallback: emptySiteStore,
    normalize: (parsed) => {
      const store = parsed as Partial<SiteStore>;
      const sites = Array.isArray(store.sites) ? store.sites : [];
      // Backfill optional fields for sites created before each was added.
      for (const site of sites) {
        if (!site.location) site.location = null;
        if (site.countryCode === undefined) site.countryCode = null;
      }
      return {
        schemaVersion: 1,
        defaultSiteId: store.defaultSiteId ?? null,
        legacyImportedEnvSiteId: store.legacyImportedEnvSiteId ?? null,
        sites,
      };
    },
  });
}

async function writeStore(store: SiteStore): Promise<void> {
  const filePath = await resolveDataFilePath(STORE_FILE);
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("site-store", readStore, writeStore);

function generateSlug(name: string, existingSlugs: Set<string>): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  if (!base) {
    base = "site";
  }

  let slug = base;
  let counter = 2;

  while (existingSlugs.has(slug)) {
    slug = `${base}-${counter}`;
    counter++;
  }

  return slug;
}

export async function getSiteStore(): Promise<SiteStore> {
  return readStore();
}

export async function listSites(): Promise<SiteRecord[]> {
  const store = await readStore();
  return store.sites;
}

export async function listEnabledSites(): Promise<SiteRecord[]> {
  const store = await readStore();
  return store.sites.filter((s) => s.enabled);
}

export async function getSiteById(id: string): Promise<SiteRecord | null> {
  const store = await readStore();
  return store.sites.find((s) => s.id === id) ?? null;
}

export async function getSiteBySlug(slug: string): Promise<SiteRecord | null> {
  const store = await readStore();
  return store.sites.find((s) => s.slug === slug) ?? null;
}

export async function getDefaultSite(): Promise<SiteRecord | null> {
  const store = await readStore();

  if (store.defaultSiteId) {
    const site = store.sites.find(
      (s) => s.id === store.defaultSiteId && s.enabled,
    );
    if (site) return site;
  }

  // Fallback: first enabled site.
  return store.sites.find((s) => s.enabled) ?? null;
}

export async function getSiteCount(): Promise<number> {
  const store = await readStore();
  return store.sites.length;
}

export async function getLegacyImportedEnvSiteId(): Promise<string | null> {
  const store = await readStore();
  return store.legacyImportedEnvSiteId;
}

function buildLocation(
  input: Pick<SiteInput, "latitude" | "longitude" | "address">,
): SiteLocation | null {
  if (
    input.latitude != null &&
    input.longitude != null &&
    isFinite(input.latitude) &&
    isFinite(input.longitude)
  ) {
    return {
      address: input.address?.trim() || null,
      latitude: input.latitude,
      longitude: input.longitude,
    };
  }
  return null;
}

async function buildEncryptedPayload(
  input: SiteInput,
): Promise<ProxmoxSitePayload> {
  const passwordEncrypted = await encryptText(input.password);

  return {
    apiUrl: input.apiUrl.trim().replace(/\/+$/, ""),
    username: input.username.trim(),
    passwordEncrypted,
    tlsMode: input.tlsMode,
    tlsFingerprint: input.tlsFingerprint?.trim() || null,
    tlsCustomCaPem: input.tlsCustomCaPem?.trim() || null,
    defaultNode: input.defaultNode.trim(),
    defaultRootfsStorage: input.defaultRootfsStorage?.trim() ?? "",
    defaultVmStorage: input.defaultVmStorage?.trim() ?? "",
    defaultIsoStorage: input.defaultIsoStorage?.trim() ?? "",
    defaultBackupStorage: input.defaultBackupStorage?.trim() ?? "",
    defaultBackupSlaHours:
      input.defaultBackupSlaHours != null && input.defaultBackupSlaHours > 0
        ? input.defaultBackupSlaHours
        : DEFAULT_BACKUP_SLA_HOURS,
    sshHostKeyPolicy: input.sshHostKeyPolicy ?? "accept-new",
    consoleKnownHostsContent: input.consoleKnownHostsContent?.trim() || null,
  };
}

export async function createSite(
  input: SiteInput,
  nodeFingerprints?: string[],
): Promise<SiteRecord> {
  const payload = await buildEncryptedPayload(input);

  return mutateStore(async (store) => {
    const existingSlugs = new Set(store.sites.map((s) => s.slug));
    const now = new Date().toISOString();

    const site: SiteRecord = {
      id: randomUUID(),
      slug: generateSlug(input.name, existingSlugs),
      name: input.name.trim(),
      kind: input.kind,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastValidatedAt: null,
      lastValidationOk: null,
      ...(nodeFingerprints && nodeFingerprints.length > 0 ? { nodeFingerprints } : {}),
      location: buildLocation(input),
      countryCode: normalizeCountryCode(input.countryCode ?? null),
      payload,
    };

    store.sites.push(site);

    // First site becomes the default automatically.
    if (store.sites.length === 1) {
      store.defaultSiteId = site.id;
    }

    return site;
  });
}

export async function updateSite(
  id: string,
  input: Partial<SiteInput>,
): Promise<SiteRecord | null> {
  return mutateStore(async (store) => {
    const site = store.sites.find((s) => s.id === id);
    if (!site) return null;

    const now = new Date().toISOString();

    if (input.name != null) site.name = input.name.trim();

    if (input.password != null) {
      site.payload.passwordEncrypted = await encryptText(input.password);
    }

    if (input.apiUrl != null) site.payload.apiUrl = input.apiUrl.trim().replace(/\/+$/, "");
    if (input.username != null) site.payload.username = input.username.trim();
    if (input.tlsMode != null) site.payload.tlsMode = input.tlsMode;
    if (input.tlsFingerprint !== undefined) site.payload.tlsFingerprint = input.tlsFingerprint?.trim() || null;
    if (input.tlsCustomCaPem !== undefined) site.payload.tlsCustomCaPem = input.tlsCustomCaPem?.trim() || null;
    if (input.defaultNode != null) site.payload.defaultNode = input.defaultNode.trim();
    if (input.defaultRootfsStorage != null) site.payload.defaultRootfsStorage = input.defaultRootfsStorage.trim();
    if (input.defaultVmStorage != null) site.payload.defaultVmStorage = input.defaultVmStorage.trim();
    if (input.defaultIsoStorage != null) site.payload.defaultIsoStorage = input.defaultIsoStorage.trim();
    if (input.defaultBackupStorage != null) site.payload.defaultBackupStorage = input.defaultBackupStorage.trim();
    if (input.defaultBackupSlaHours != null) site.payload.defaultBackupSlaHours = input.defaultBackupSlaHours;
    if (input.sshHostKeyPolicy != null) site.payload.sshHostKeyPolicy = input.sshHostKeyPolicy;
    if (input.consoleKnownHostsContent !== undefined) {
      site.payload.consoleKnownHostsContent = input.consoleKnownHostsContent?.trim() || null;
    }

    if (
      input.latitude !== undefined ||
      input.longitude !== undefined ||
      input.address !== undefined
    ) {
      const lat = input.latitude ?? site.location?.latitude;
      const lng = input.longitude ?? site.location?.longitude;
      site.location = buildLocation({
        address: input.address ?? site.location?.address,
        latitude: lat,
        longitude: lng,
      });
    }

    // `countryCode === ""` is the explicit "clear it" signal from the form;
    // `undefined` means the field wasn't submitted (partial update) and we
    // leave the existing value alone.
    if (input.countryCode !== undefined) {
      site.countryCode = normalizeCountryCode(input.countryCode);
    }

    site.updatedAt = now;
    return site;
  });
}

export async function disableSite(id: string): Promise<boolean> {
  return mutateStore((store) => {
    const site = store.sites.find((s) => s.id === id);
    if (!site) return false;
    site.enabled = false;
    site.updatedAt = new Date().toISOString();
    return true;
  });
}

export async function enableSite(id: string): Promise<boolean> {
  return mutateStore((store) => {
    const site = store.sites.find((s) => s.id === id);
    if (!site) return false;
    site.enabled = true;
    site.updatedAt = new Date().toISOString();
    return true;
  });
}

export async function setDefaultSite(id: string): Promise<boolean> {
  return mutateStore((store) => {
    const site = store.sites.find((s) => s.id === id);
    if (!site || !site.enabled) return false;
    store.defaultSiteId = id;
    return true;
  });
}

export async function updateSiteValidation(
  id: string,
  ok: boolean,
  nodeFingerprints?: string[],
): Promise<boolean> {
  return mutateStore((store) => {
    const site = store.sites.find((s) => s.id === id);
    if (!site) return false;
    site.lastValidatedAt = new Date().toISOString();
    site.lastValidationOk = ok;
    if (nodeFingerprints && nodeFingerprints.length > 0) {
      site.nodeFingerprints = nodeFingerprints;
    }
    return true;
  });
}

/**
 * Check if any existing site shares node fingerprints with the given set.
 * Returns the overlapping site name and node name, or null if no overlap.
 */
export async function findOverlappingSite(
  fingerprints: string[],
  excludeSiteId?: string,
): Promise<{ siteName: string; nodeName?: string } | null> {
  const store = await getSiteStore();
  const fpSet = new Set(fingerprints);

  for (const site of store.sites) {
    if (excludeSiteId && site.id === excludeSiteId) continue;
    if (!site.nodeFingerprints || site.nodeFingerprints.length === 0) continue;

    for (const fp of site.nodeFingerprints) {
      if (fpSet.has(fp)) {
        return { siteName: site.name };
      }
    }
  }
  return null;
}

export async function deleteSite(id: string): Promise<boolean> {
  return mutateStore((store) => {
    const idx = store.sites.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    if (store.defaultSiteId === id) {
      store.defaultSiteId = store.sites.find((s, i) => i !== idx && s.enabled)?.id ?? null;
    }
    store.sites.splice(idx, 1);
    return true;
  });
}

// Used only during migration — writes the entire store directly.
export async function writeSiteStore(store: SiteStore): Promise<void> {
  await writeStore(store);
}
