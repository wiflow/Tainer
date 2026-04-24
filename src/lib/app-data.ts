import "server-only";

import path from "node:path";
import { access, copyFile, lstat, mkdir, rename } from "node:fs/promises";

const LEGACY_DATA_DIRECTORY = path.join(process.cwd(), "data");
const resolvedDataFilePathCache = new Map<string, Promise<string>>();

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function getDataDirectoryPath() {
  const explicitPath = process.env.TAINER_DATA_DIR?.trim();

  if (explicitPath) {
    return explicitPath;
  }

  if (process.env.NODE_ENV === "production") {
    return path.join(process.env.HOME ?? process.cwd(), ".tainer");
  }

  return LEGACY_DATA_DIRECTORY;
}

export async function resolveDataFilePath(fileName: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) {
    throw new Error(`Invalid data file name: ${fileName}`);
  }

  const cacheKey = `${getDataDirectoryPath()}::${fileName}`;
  const cached = resolvedDataFilePathCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const resolution = (async () => {
    const directoryPath = getDataDirectoryPath();
    const targetPath = path.join(directoryPath, fileName);
    const legacyPath = path.join(LEGACY_DATA_DIRECTORY, fileName);

    await mkdir(directoryPath, { recursive: true });

    if (
      targetPath !== legacyPath &&
      !(await pathExists(targetPath)) &&
      (await pathExists(legacyPath))
    ) {
      try {
        const stats = await lstat(legacyPath);
        if (stats.isSymbolicLink()) {
          console.warn(`[app-data] Skipping migration of symlink: ${legacyPath}`);
          return targetPath;
        }
      } catch {
        return targetPath;
      }

      try {
        await rename(legacyPath, targetPath);
      } catch {
        await copyFile(legacyPath, targetPath);
      }
    }

    return targetPath;
  })().catch((error) => {
    resolvedDataFilePathCache.delete(cacheKey);
    throw error;
  });

  resolvedDataFilePathCache.set(cacheKey, resolution);
  return resolution;
}
