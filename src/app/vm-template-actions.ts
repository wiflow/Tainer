"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { BasicActionState } from "@/lib/action-states";
import { requireSession, requireSitePermission } from "@/lib/auth";
import { withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import { createVmTemplate, deleteVmTemplate, type VmTemplateInput } from "@/lib/vm-templates";

export async function createVmTemplateAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-templates");
    return await withSiteConfig(siteConfig, async () => {

    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const hostnamePrefix = String(formData.get("hostnamePrefix") ?? "").trim();
    const node = String(formData.get("node") ?? "").trim();
    const isoVolid = String(formData.get("isoVolid") ?? "").trim();
    const isoFileName = String(formData.get("isoFileName") ?? "").trim();
    const isoStorage = String(formData.get("isoStorage") ?? "").trim();
    const diskStorage = String(formData.get("diskStorage") ?? "").trim();
    const diskSize = String(formData.get("diskSize") ?? "").trim();
    const memory = String(formData.get("memory") ?? "").trim();
    const cores = String(formData.get("cores") ?? "").trim();
    const sockets = String(formData.get("sockets") ?? "").trim();
    const cpuType = String(formData.get("cpuType") ?? "").trim();
    const bridge = String(formData.get("bridge") ?? "").trim();
    const osType = String(formData.get("osType") ?? "").trim();
    const machineType = String(formData.get("machineType") ?? "").trim();
    const scsihw = String(formData.get("scsihw") ?? "").trim();
    const vgaType = String(formData.get("vgaType") ?? "").trim();
    const accessReady = Boolean(formData.get("accessReady"));
    const cloudInitCapable = Boolean(formData.get("cloudInitCapable"));
    const managedLoginUser = String(formData.get("managedLoginUser") ?? "").trim() || "tainer";
    const POSIX_USERNAME_REGEX = /^[a-z_][a-z0-9_-]{0,31}$/;
    if (!POSIX_USERNAME_REGEX.test(managedLoginUser)) {
      return {
        message: "Managed login user must be a valid POSIX username (lowercase, 1-32 chars).",
        requestId: randomUUID(),
        status: "error",
      };
    }

    if (!name) {
      return {
        message: "Template name is required.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    if (accessReady && !cloudInitCapable) {
      return {
        message: "Managed SSH-ready VM templates must also be marked cloud-init capable.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    if (accessReady && !(osType || "l26").startsWith("l")) {
      return {
        message: "Managed in-app SSH is currently Linux-only.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    const input: VmTemplateInput = {
      accessReady,
      bridge: bridge || "vmbr0",
      cloudInitCapable,
      cores: cores || "2",
      cpuType: cpuType || "x86-64-v2-AES",
      description,
      diskSize: diskSize || "32",
      diskStorage,
      enableQemuAgent: Boolean(formData.get("enableQemuAgent")),
      hostnamePrefix,
      isoFileName,
      isoStorage,
      isoVolid,
      machineType: machineType || "q35",
      managedLoginUser,
      memory: memory || "2048",
      name,
      node,
      onboot: Boolean(formData.get("onboot")),
      osType: osType || "l26",
      scsihw: scsihw || "virtio-scsi-single",
      sockets: sockets || "1",
      startAfterCreate: Boolean(formData.get("startAfterCreate")),
      vgaType: vgaType || "std",
    };

    await createVmTemplate(input);

    revalidatePath(`/sites/${siteSlug}/templates`);

    return {
      message: `VM template "${name}" created.`,
      requestId: randomUUID(),
      status: "success",
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to create VM template.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function deleteVmTemplateAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-templates");
    return await withSiteConfig(siteConfig, async () => {

    const id = String(formData.get("id") ?? "").trim();

    if (!id) {
      return {
        message: "Missing template reference.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    const removed = await deleteVmTemplate(id);

    if (!removed) {
      return {
        message: "Template not found.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    revalidatePath(`/sites/${siteSlug}/templates`);

    return {
      message: `VM template "${removed.name}" deleted.`,
      requestId: randomUUID(),
      status: "success",
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to delete VM template.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}
