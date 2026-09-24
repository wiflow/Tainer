"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { ProxmoxActionState } from "@/lib/action-states";
import { requireSession, requireSitePermission } from "@/lib/auth";
import { assertSafeDownloadUrl } from "@/lib/import-url";
import { importTemplateFromUrl, withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

export async function downloadIsoFromUrlAction(
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
    requireSitePermission(session, siteConfig.siteId, "manage-settings");
    return await withSiteConfig(siteConfig, async () => {

    const node = String(formData.get("node") ?? "").trim();
    const storage = String(formData.get("storage") ?? "").trim();
    const url = await assertSafeDownloadUrl(String(formData.get("url") ?? "").trim());
    const filename = String(formData.get("filename") ?? "").trim();

    if (!node || !storage || !url) {
      return {
        message: "Node, storage, and URL are required.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    // Auto-derive filename from URL if not provided
    const resolvedFilename = filename || url.split("/").pop() || "download.iso";

    // Ensure filename ends with .iso
    const finalFilename = resolvedFilename.endsWith(".iso")
      ? resolvedFilename
      : `${resolvedFilename}.iso`;

    const params = new URLSearchParams();
    params.set("content", "iso");
    params.set("filename", finalFilename);
    params.set("url", url);

    const upid = await importTemplateFromUrl(node, storage, params);

    revalidatePath(`/sites/${siteSlug}/iso-images`);

    return {
      message: `ISO download submitted for ${finalFilename} into ${storage}.`,
      requestId: randomUUID(),
      status: "success",
      task: {
        node,
        siteSlug,
        submittedMessage: `Queued ISO download for ${finalFilename}.`,
        successMessage: `Downloaded ${finalFilename} into ${storage}.`,
        title: `Downloading ${finalFilename}`,
        upid,
      },
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to download ISO.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}
