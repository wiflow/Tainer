"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { ProxmoxActionState } from "@/lib/action-states";
import { requireSession, requireSitePermission } from "@/lib/auth";
import { createDeploymentTemplate } from "@/lib/deployment-templates";
import { getTemplateAuthoringIndex, withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import { getSshAuthorityInfo } from "@/lib/ssh-keys";

export async function createDeploymentTemplateAction(
  _previousState: ProxmoxActionState,
  formData: FormData,
): Promise<ProxmoxActionState> {
  try {
    const session = await requireSession();

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-templates");
    return await withSiteConfig(siteConfig, async () => {

    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const sourceTemplateId = String(formData.get("sourceTemplateId") ?? "").trim();
    const hostnamePrefix = String(formData.get("hostnamePrefix") ?? "").trim();
    const rootfsStorage = String(formData.get("rootfsStorage") ?? "").trim();
    const rootfsSize = String(formData.get("rootfsSize") ?? "").trim();
    const memory = String(formData.get("memory") ?? "").trim();
    const cores = String(formData.get("cores") ?? "").trim();
    const bridge = String(formData.get("bridge") ?? "").trim();
    const envText = String(formData.get("envText") ?? "");
    const accessReady = Boolean(formData.get("accessReady"));
    const managedLoginUser = String(formData.get("managedLoginUser") ?? "").trim() || "tainer";
    const POSIX_USERNAME_REGEX = /^[a-z_][a-z0-9_-]{0,31}$/;
    if (!POSIX_USERNAME_REGEX.test(managedLoginUser)) {
      return {
        message: "Managed login user must be a valid POSIX username (lowercase, 1-32 chars).",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    if (!name || !sourceTemplateId || !rootfsStorage || !rootfsSize) {
      return {
        message: "Name, source image, rootfs storage, and rootfs size are required.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const templateIndex = await getTemplateAuthoringIndex();
    // Fall back to a volid match because the ID changes when node order differs.
    let sourceTemplate =
      templateIndex.templates.find((template) => template.id === sourceTemplateId) ?? null;

    if (!sourceTemplate) {
      try {
        const decoded = JSON.parse(
          Buffer.from(sourceTemplateId, "base64url").toString("utf8")
        ) as { volid?: string };
        if (decoded.volid && /^[a-zA-Z0-9._-]+:[a-zA-Z0-9._/-]+$/.test(decoded.volid)) {
          sourceTemplate = templateIndex.templates.find((t) => t.volid === decoded.volid) ?? null;
        }
      } catch {}
    }

    const rootfsTarget =
      templateIndex.rootfsTargets.find((target) => target.storage === rootfsStorage) ?? null;

    if (!sourceTemplate) {
      return {
        message: "The selected source image is no longer visible in Proxmox.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    if (!rootfsTarget) {
      return {
        message: "The selected rootfs storage is not currently available.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const authorityInfo = accessReady ? await getSshAuthorityInfo() : null;

    if (accessReady && !authorityInfo) {
      return {
        message: "Generate the Tainer SSH authority in Settings before saving an SSH-ready LXC template.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    await createDeploymentTemplate({
      accessReady,
      bridge: bridge || "vmbr0",
      cores: cores || "2",
      description,
      envText,
      hostnamePrefix:
        hostnamePrefix ||
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
      memory: memory || "512",
      name,
      node: sourceTemplate.node,
      onboot: Boolean(formData.get("onboot")),
      rootfsSize,
      rootfsStorage,
      sourceFileName: sourceTemplate.fileName,
      sourceName: sourceTemplate.name,
      sourceStorage: sourceTemplate.storage,
      sourceTemplateId: sourceTemplate.id,
      sourceVolid: sourceTemplate.volid,
      sshAuthorityFingerprint: authorityInfo?.fingerprint ?? null,
      startAfterCreate: Boolean(formData.get("startAfterCreate")),
      managedLoginUser,
      unprivileged: Boolean(formData.get("unprivileged")),
    });

    revalidatePath(`/sites/${siteSlug}`);
    revalidatePath(`/sites/${siteSlug}/templates`);

    return {
      message: `Saved deployment template "${name}".`,
      requestId: randomUUID(),
      status: "success",
      task: null,
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to create deployment template.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}
