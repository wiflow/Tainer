import "server-only";

import { access, mkdir, rename, copyFile, readFile } from "node:fs/promises";
import path from "node:path";

import { getDataDirectoryPath, resolveDataFilePath } from "@/lib/app-data";
import { encryptText } from "@/lib/crypto";
import { writeSiteStore } from "@/lib/site-store";
import type { ProxmoxSitePayload, SiteRecord, SiteStore } from "@/lib/site-types";
import { randomUUID } from "node:crypto";

const SITE_SCOPED_FILES = [
  "deployment-templates.json",
  "vm-templates.json",
  "image-env-cache.json",
  "ip-pools.json",
  "deployment-activity-log.json",
  "deployment-ssh-keys.json",
  "backup-policies.json",
  "backup-run-log.json",
  "storage-box.json",
  "storage-box-offload-log.json",
  "storage-box-index.json",
  "alert-policies.json",
  "alert-runtime-state.json",
  "notification-log.json",
  "tainer-settings.json",
  "guest-host-keys.json",
];

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function migrateLegacyEnvSite(): Promise<void> {
  const sitesPath = await resolveDataFilePath("sites.json");

  if (await pathExists(sitesPath)) {
    try {
      const raw = await readFile(sitesPath, "utf8");
      const existing = JSON.parse(raw) as Partial<SiteStore>;
      if (existing.legacyImportedEnvSiteId) {
        return;
      }
      if (Array.isArray(existing.sites) && existing.sites.length > 0) {
        return;
      }
    } catch {
    }
  }

  const apiUrl = process.env.PROXMOX_URL?.trim();
  const username = process.env.PROXMOX_USERNAME?.trim();
  const password = process.env.PROXMOX_PASSWORD?.trim();

  if (!apiUrl || !username || !password) {
    return;
  }

  console.log("[site-migration] Importing PROXMOX_* env vars into site registry...");

  const siteId = randomUUID();
  const now = new Date().toISOString();

  const passwordEncrypted = await encryptText(password);

  const payload: ProxmoxSitePayload = {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    username,
    passwordEncrypted,
    tlsMode: process.env.PROXMOX_TLS_INSECURE === "true" ? "insecure" : "full",
    tlsFingerprint: null,
    tlsCustomCaPem: null,
    defaultNode: process.env.PROXMOX_DEFAULT_NODE?.trim() ?? "",
    defaultRootfsStorage: process.env.PROXMOX_DEFAULT_ROOTFS_STORAGE?.trim() ?? "",
    defaultVmStorage: process.env.PROXMOX_DEFAULT_VM_STORAGE?.trim() ?? "",
    defaultIsoStorage: process.env.PROXMOX_DEFAULT_ISO_STORAGE?.trim() ?? "",
    defaultBackupStorage: "",
    defaultBackupSlaHours: 24,
    sshHostKeyPolicy:
      (process.env.PROXMOX_SSH_HOST_KEY_POLICY?.trim().toLowerCase() as ProxmoxSitePayload["sshHostKeyPolicy"]) || "accept-new",
    consoleKnownHostsContent: null,
  };

  let slug: string;
  try {
    const hostname = new URL(apiUrl).hostname;
    slug = hostname
      .replace(/\./g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "primary";
  } catch {
    slug = "primary";
  }

  const site: SiteRecord = {
    id: siteId,
    slug,
    name: "Primary",
    kind: "proxmox",
    enabled: true,
    createdAt: now,
    updatedAt: now,
    lastValidatedAt: null,
    lastValidationOk: null,
    location: null,
    countryCode: null,
    payload,
  };

  const store: SiteStore = {
    schemaVersion: 1,
    defaultSiteId: siteId,
    legacyImportedEnvSiteId: siteId,
    sites: [site],
  };

  await writeSiteStore(store);
  console.log(`[site-migration] Created site "${site.name}" (${site.slug}) from env vars.`);

  const dataDir = getDataDirectoryPath();
  const siteDataDir = path.join(dataDir, "sites", siteId);
  await mkdir(siteDataDir, { recursive: true });

  for (const fileName of SITE_SCOPED_FILES) {
    const sourcePath = path.join(dataDir, fileName);

    if (!(await pathExists(sourcePath))) continue;

    const targetPath = path.join(siteDataDir, fileName);

    if (await pathExists(targetPath)) continue;

    try {
      await rename(sourcePath, targetPath);
      console.log(`[site-migration] Moved ${fileName} → sites/${siteId}/`);
    } catch {
      try {
        await copyFile(sourcePath, targetPath);
        console.log(`[site-migration] Copied ${fileName} → sites/${siteId}/`);
      } catch (copyError) {
        console.error(`[site-migration] Failed to migrate ${fileName}:`, copyError);
      }
    }
  }

  console.log("[site-migration] Migration complete.");
}
