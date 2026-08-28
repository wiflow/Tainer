"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { BasicActionState } from "@/lib/action-states";
import { requirePermission, requireSession } from "@/lib/auth";
import { createStorageConfig, deleteStorageConfig, withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import {
  connectStorageBox,
  disconnectStorageBox,
  getStorageBoxConfig,
  markCifsStorageRegistered,
  retrieveArchive,
  testStorageBox,
} from "@/lib/storage-box";
import { decryptText } from "@/lib/crypto";

function actionError(message: string): BasicActionState {
  return { message, requestId: randomUUID(), status: "error" };
}

function actionSuccess(message: string): BasicActionState {
  return { message, requestId: randomUUID(), status: "success" };
}

async function withBackupPermission<T>(
  siteSlug: string,
  callback: () => Promise<T>,
): Promise<T> {
  const session = await requireSession();
  requirePermission(session, "manage-backups");
  const siteConfig = await resolveSiteConfigBySlug(siteSlug);
  return withSiteConfig(siteConfig, callback);
}

export async function connectStorageBoxAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return actionError("Missing site context.");

    return await withBackupPermission(siteSlug, async () => {
      const summary = await connectStorageBox({
        basePath: String(formData.get("basePath") ?? ""),
        host: String(formData.get("host") ?? ""),
        password: String(formData.get("password") ?? ""),
        username: String(formData.get("username") ?? ""),
      });
      revalidatePath(`/sites/${siteSlug}/backups`);
      return actionSuccess(
        summary.keyInstalled
          ? `Connected to ${summary.host} — transfer key installed.`
          : `Connected to ${summary.host}, but SSH key installation failed; check that SSH is enabled for the box.`,
      );
    });
  } catch (error) {
    return actionError(error instanceof Error ? error.message : "Failed to connect the Storage Box.");
  }
}

export async function testStorageBoxAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return actionError("Missing site context.");

    return await withBackupPermission(siteSlug, async () => {
      const result = await testStorageBox();
      revalidatePath(`/sites/${siteSlug}/backups`);
      return result.ok ? actionSuccess(result.message) : actionError(result.message);
    });
  } catch (error) {
    return actionError(error instanceof Error ? error.message : "Connection test failed.");
  }
}

export async function disconnectStorageBoxAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return actionError("Missing site context.");

    return await withBackupPermission(siteSlug, async () => {
      await disconnectStorageBox();
      revalidatePath(`/sites/${siteSlug}/backups`);
      return actionSuccess("Storage Box disconnected. Offloaded archives remain on the box.");
    });
  } catch (error) {
    return actionError(error instanceof Error ? error.message : "Failed to disconnect.");
  }
}

export async function registerCifsStorageAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return actionError("Missing site context.");

    return await withBackupPermission(siteSlug, async () => {
      const config = await getStorageBoxConfig();
      if (!config) return actionError("Connect the Storage Box first.");

      const storageId = String(formData.get("storageId") ?? "storagebox").trim() || "storagebox";
      const share = String(formData.get("share") ?? "backup").trim() || "backup";

      await createStorageConfig({
        content: "backup",
        password: await decryptText(config.passwordEncrypted),
        server: config.host,
        share,
        smbversion: "3",
        storage: storageId,
        type: "cifs",
        username: config.username,
      });
      await markCifsStorageRegistered(storageId);
      revalidatePath(`/sites/${siteSlug}/backups`);
      return actionSuccess(
        `Storage "${storageId}" registered cluster-wide — backup policies can now target it directly.`,
      );
    });
  } catch (error) {
    return actionError(
      error instanceof Error ? error.message : "Failed to register the CIFS storage.",
    );
  }
}

export async function unregisterCifsStorageAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return actionError("Missing site context.");

    return await withBackupPermission(siteSlug, async () => {
      const config = await getStorageBoxConfig();
      if (!config?.cifsStorageId) return actionError("No CIFS storage is registered.");

      await deleteStorageConfig(config.cifsStorageId);
      await markCifsStorageRegistered(null);
      revalidatePath(`/sites/${siteSlug}/backups`);
      return actionSuccess("CIFS storage removed. Data on the box is untouched.");
    });
  } catch (error) {
    return actionError(error instanceof Error ? error.message : "Failed to remove the CIFS storage.");
  }
}

export async function retrieveArchiveAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return actionError("Missing site context.");

    return await withBackupPermission(siteSlug, async () => {
      const archiveName = String(formData.get("archiveName") ?? "");
      const vmid = Number(formData.get("vmid") ?? "");
      const node = String(formData.get("node") ?? "");
      const targetStorage = String(formData.get("targetStorage") ?? "");

      if (!archiveName || !Number.isInteger(vmid) || !node || !targetStorage) {
        return actionError("Archive, VMID, node and target storage are required.");
      }

      const localPath = await retrieveArchive({ archiveName, node, targetStorage, vmid });
      revalidatePath(`/sites/${siteSlug}/backups`);
      return actionSuccess(`Archive retrieved to ${localPath} — it now appears among the storage's backups.`);
    });
  } catch (error) {
    return actionError(error instanceof Error ? error.message : "Failed to retrieve the archive.");
  }
}
