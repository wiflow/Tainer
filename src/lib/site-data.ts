import "server-only";

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { getDataDirectoryPath } from "@/lib/app-data";
import { getActiveSiteConfig } from "@/lib/proxmox";

const resolvedSiteDirCache = new Map<string, Promise<string>>();
const resolvedSiteFilePathCache = new Map<string, Promise<string>>();

export async function resolveSiteDataDir(siteId: string): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+$/.test(siteId)) {
    throw new Error(`Invalid site ID for data path: ${siteId}`);
  }

  const cached = resolvedSiteDirCache.get(siteId);
  if (cached) {
    return cached;
  }

  const resolution = (async () => {
    const dirPath = path.join(getDataDirectoryPath(), "sites", siteId);
    await mkdir(dirPath, { mode: 0o700, recursive: true });
    return dirPath;
  })().catch((error) => {
    resolvedSiteDirCache.delete(siteId);
    throw error;
  });

  resolvedSiteDirCache.set(siteId, resolution);
  return resolution;
}

export async function resolveSiteDataFilePath(
  siteId: string,
  fileName: string,
): Promise<string> {
  if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) {
    throw new Error(`Invalid data file name: ${fileName}`);
  }

  const cacheKey = `${siteId}::${fileName}`;
  const cached = resolvedSiteFilePathCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const resolution = (async () => {
    const dirPath = await resolveSiteDataDir(siteId);
    return path.join(dirPath, fileName);
  })().catch((error) => {
    resolvedSiteFilePathCache.delete(cacheKey);
    throw error;
  });

  resolvedSiteFilePathCache.set(cacheKey, resolution);
  return resolution;
}

export async function resolveSiteDataFilePathFromContext(
  fileName: string,
): Promise<string> {
  const config = getActiveSiteConfig();
  return resolveSiteDataFilePath(config.siteId, fileName);
}
