import "server-only";

import { readFile } from "node:fs/promises";

import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { writeJsonFileAtomically } from "@/lib/store-utils";

export type AppSettings = {
  defaultBackupSlaHours: number;
  defaultBackupStorage: string;
  defaultRootfsStorage: string;
  /**
   * Filesystem path (inside the container) for the local Docker image library.
   * When empty, falls back to the DOCKER_LIBRARY_PATH env var. Must be a
   * writable, container-visible directory — e.g. `/app/data/docker-library`,
   * which lives on the already-mounted data volume.
   */
  dockerLibraryPath: string;
  updatedAt: string | null;
};

type StorageLike = {
  storage: string;
};

const DEFAULT_BACKUP_SLA_HOURS = 24;

function defaultSettings(): AppSettings {
  return {
    defaultBackupSlaHours: DEFAULT_BACKUP_SLA_HOURS,
    defaultBackupStorage: "",
    defaultRootfsStorage: process.env.PROXMOX_DEFAULT_ROOTFS_STORAGE?.trim() || "",
    dockerLibraryPath: "",
    updatedAt: null,
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  try {
    const raw = await readFile(await resolveSiteDataFilePathFromContext("tainer-settings.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const fallback = defaultSettings();

    return {
      defaultBackupSlaHours:
        typeof parsed.defaultBackupSlaHours === "number" && parsed.defaultBackupSlaHours > 0
          ? parsed.defaultBackupSlaHours
          : fallback.defaultBackupSlaHours,
      defaultBackupStorage:
        typeof parsed.defaultBackupStorage === "string"
          ? parsed.defaultBackupStorage.trim()
          : fallback.defaultBackupStorage,
      defaultRootfsStorage:
        typeof parsed.defaultRootfsStorage === "string"
          ? parsed.defaultRootfsStorage.trim()
          : fallback.defaultRootfsStorage,
      dockerLibraryPath:
        typeof parsed.dockerLibraryPath === "string"
          ? parsed.dockerLibraryPath.trim()
          : fallback.dockerLibraryPath,
      updatedAt:
        typeof parsed.updatedAt === "string" ? parsed.updatedAt : fallback.updatedAt,
    };
  } catch {
    return defaultSettings();
  }
}

let settingsMutationQueue = Promise.resolve();

export async function saveAppSettings(
  input: Partial<
    Pick<
      AppSettings,
      "defaultBackupSlaHours" | "defaultBackupStorage" | "defaultRootfsStorage" | "dockerLibraryPath"
    >
  >,
): Promise<AppSettings> {
  // Serialize writes to prevent concurrent mutations from racing.
  const prev = settingsMutationQueue;
  let release!: () => void;
  settingsMutationQueue = new Promise<void>((r) => { release = r; });
  await prev.catch(() => {});

  try {
    const current = await getAppSettings();

    const nextSettings: AppSettings = {
      defaultBackupSlaHours:
        input.defaultBackupSlaHours != null && input.defaultBackupSlaHours > 0
          ? input.defaultBackupSlaHours
          : current.defaultBackupSlaHours,
      defaultBackupStorage:
        input.defaultBackupStorage != null
          ? input.defaultBackupStorage.trim()
          : current.defaultBackupStorage,
      defaultRootfsStorage:
        input.defaultRootfsStorage != null
          ? input.defaultRootfsStorage.trim()
          : current.defaultRootfsStorage,
      dockerLibraryPath:
        input.dockerLibraryPath != null
          ? input.dockerLibraryPath.trim()
          : current.dockerLibraryPath,
      updatedAt: new Date().toISOString(),
    };

    const filePath = await resolveSiteDataFilePathFromContext("tainer-settings.json");
    await writeJsonFileAtomically(filePath, nextSettings);

    return nextSettings;
  } finally {
    release();
  }
}

export function resolveDefaultRootfsStorage(
  targets: StorageLike[],
  preferredStorage: string,
) {
  const preferred = preferredStorage.trim();

  if (preferred && targets.some((target) => target.storage === preferred)) {
    return preferred;
  }

  return targets[0]?.storage ?? preferred;
}

export function resolveDefaultBackupStorage(
  targets: StorageLike[],
  preferredStorage: string,
) {
  const preferred = preferredStorage.trim();

  if (preferred && targets.some((target) => target.storage === preferred)) {
    return preferred;
  }

  return targets[0]?.storage ?? preferred;
}

export async function getAppSettingsPath() {
  return resolveSiteDataFilePathFromContext("tainer-settings.json");
}
