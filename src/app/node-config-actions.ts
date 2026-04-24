"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { BasicActionState } from "@/lib/action-states";
import { requirePermission, requireSession } from "@/lib/auth";
import { deleteConfigSnapshot, takeConfigSnapshot } from "@/lib/node-config-backup";
import { withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

export async function takeConfigSnapshotAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-settings");
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };

    const node = String(formData.get("node") ?? "").trim();
    if (!node) return { message: "Node is required.", requestId: randomUUID(), status: "error" };

    const label = String(formData.get("label") ?? "").trim();

    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return withSiteConfig(siteConfig, async () => {
      const snapshot = await takeConfigSnapshot(node, session.user.name, label);

      revalidatePath(`/sites/${siteSlug}/node-configs`);

      return {
        message: `Configuration snapshot "${snapshot.label}" saved.`,
        requestId: randomUUID(),
        status: "success",
      };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to take config snapshot.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function deleteConfigSnapshotAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-settings");
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };

    const snapshotId = String(formData.get("snapshotId") ?? "");
    if (!snapshotId) return { message: "Snapshot ID is required.", requestId: randomUUID(), status: "error" };

    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return withSiteConfig(siteConfig, async () => {
      const deleted = await deleteConfigSnapshot(snapshotId);
      if (!deleted) return { message: "Snapshot not found.", requestId: randomUUID(), status: "error" };

      revalidatePath(`/sites/${siteSlug}/node-configs`);

      return {
        message: "Config snapshot deleted.",
        requestId: randomUUID(),
        status: "success",
      };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to delete snapshot.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}
