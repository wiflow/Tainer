"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { DockerHubActionState } from "@/lib/action-states";
import { requireSession } from "@/lib/auth";
import { buildGiteaOciReference, buildGiteaTemplateFileName } from "@/lib/gitea";
import { pullOciRegistryTemplate, withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

export async function pullGiteaImageAction(
  _previousState: DockerHubActionState,
  formData: FormData,
): Promise<DockerHubActionState> {
  try {
    await requireSession();

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return withSiteConfig(siteConfig, async () => {

    const name = String(formData.get("name") ?? "").trim();
    const tag = String(formData.get("tag") ?? "").trim();
    const target = String(formData.get("target") ?? "").trim();

    if (!name || !tag || !target) {
      return {
        message: "Package name, tag, and target storage are required.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const [node, storage] = target.split("::");

    if (!node || !storage) {
      return {
        message: "Invalid Proxmox storage target.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const reference = buildGiteaOciReference(name, tag);
    const fileName = buildGiteaTemplateFileName(name, tag);

    try {
      const upid = await pullOciRegistryTemplate(node, storage, reference);

      revalidatePath(`/sites/${siteSlug}/templates`);
      revalidatePath(`/sites/${siteSlug}/images`);

      return {
        message: `Submitted OCI pull for ${reference} into ${storage}.`,
        requestId: randomUUID(),
        status: "success",
        task: {
          node,
          siteSlug,
          submittedMessage: `Queued ${fileName} for Proxmox import.`,
          successMessage: `Pulled ${fileName} into ${storage}.`,
          title: `Pulling ${fileName}`,
          upid,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to pull image.";

      if (message.includes("refusing to override existing file")) {
        revalidatePath(`/sites/${siteSlug}/templates`);

        return {
          message: `${fileName} already exists in ${storage}. Open Templates to deploy it.`,
          requestId: randomUUID(),
          status: "success",
          task: null,
        };
      }

      throw error;
    }

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to pull Gitea image.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}
