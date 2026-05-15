"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { BasicActionState } from "@/lib/action-states";
import { requirePermission, requireSession } from "@/lib/auth";
import { withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import { deleteSshAccessAuthority, generateSshAccessAuthority } from "@/lib/ssh-keys";

export async function generateSshKeyAction(
  previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  void previousState;

  try {
    const session = await requireSession();
    requirePermission(session, "manage-settings");

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return await withSiteConfig(siteConfig, async () => {

    const info = await generateSshAccessAuthority();

    revalidatePath(`/sites/${siteSlug}/settings`);

    return {
      message: `SSH authority generated. Fingerprint: ${info.fingerprint}`,
      requestId: randomUUID(),
      status: "success",
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to generate the SSH authority.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function deleteSshKeyAction(
  previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  void previousState;

  try {
    const session = await requireSession();
    requirePermission(session, "manage-settings");

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return await withSiteConfig(siteConfig, async () => {

    await deleteSshAccessAuthority();

    revalidatePath(`/sites/${siteSlug}/settings`);

    return {
      message: "SSH authority deleted.",
      requestId: randomUUID(),
      status: "success",
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to delete the SSH authority.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}
