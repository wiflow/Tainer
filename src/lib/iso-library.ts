import "server-only";

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { formatBytes } from "@/lib/utils";

export type LocalIsoFile = {
  fileName: string;
  filePath: string;
  modifiedAt: string;
  sizeBytes: number;
  sizeLabel: string;
};

const ISO_LIBRARY_TTL_MS = 10_000;
let localIsoCache:
  | {
      expiresAt: number;
      path: string;
      value: LocalIsoFile[];
    }
  | null = null;
let localIsoInflight: Promise<LocalIsoFile[]> | null = null;
let localIsoInflightPath = "";

function getIsoLibraryPath(): string | null {
  return process.env.ISO_LIBRARY_PATH?.trim() || null;
}

export function isIsoLibraryConfigured(): boolean {
  return Boolean(getIsoLibraryPath());
}

async function scanLocalIsoFiles(libraryPath: string): Promise<LocalIsoFile[]> {
  try {
    const entries = await readdir(libraryPath, { withFileTypes: true });
    const isoFiles = await Promise.all(
      entries
        .filter((entry) => entry.name.toLowerCase().endsWith(".iso"))
        .map(async (entry) => {
          const filePath = path.join(libraryPath, entry.name);

          try {
            const info = await stat(filePath);
            if (!info.isFile()) return null;

            return {
              fileName: entry.name,
              filePath,
              modifiedAt: info.mtime.toISOString(),
              sizeBytes: info.size,
              sizeLabel: formatBytes(info.size),
            } satisfies LocalIsoFile;
          } catch {
            return null;
          }
        }),
    );

    return isoFiles
      .filter((entry): entry is LocalIsoFile => Boolean(entry))
      .sort((a, b) => a.fileName.localeCompare(b.fileName));
  } catch {
    return [];
  }
}

export async function listLocalIsoFiles(): Promise<LocalIsoFile[]> {
  const libraryPath = getIsoLibraryPath();
  if (!libraryPath) return [];

  if (
    localIsoCache &&
    localIsoCache.path === libraryPath &&
    localIsoCache.expiresAt > Date.now()
  ) {
    return localIsoCache.value;
  }

  if (localIsoInflight && localIsoInflightPath === libraryPath) {
    return localIsoInflight;
  }

  localIsoInflightPath = libraryPath;
  localIsoInflight = scanLocalIsoFiles(libraryPath)
    .then((value) => {
      localIsoCache = {
        expiresAt: Date.now() + ISO_LIBRARY_TTL_MS,
        path: libraryPath,
        value,
      };
      return value;
    })
    .finally(() => {
      localIsoInflight = null;
      localIsoInflightPath = "";
    });

  return localIsoInflight;
}
