"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { ProxmoxActionState } from "@/lib/action-states";
import { requirePermission, requireSession } from "@/lib/auth";
import { refreshNodeAptIndex, validateUpid, withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

export async function refreshAptIndexAction(
  _previousState: ProxmoxActionState,
  formData: FormData,
): Promise<ProxmoxActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-settings");

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }

    const node = String(formData.get("node") ?? "").trim();
    if (!node) {
      return { message: "Node is required.", requestId: randomUUID(), status: "error", task: null };
    }

    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return await withSiteConfig(siteConfig, async () => {
      const upid = await refreshNodeAptIndex(node);
      const validUpid = validateUpid(upid);

      revalidatePath(`/sites/${siteSlug}/updates`);

      return {
        message: `Refreshing package index on ${node}...`,
        requestId: randomUUID(),
        status: "success",
        task: {
          node,
          siteSlug,
          submittedMessage: `Refreshing apt index on ${node}...`,
          successHref: `/sites/${siteSlug}/updates`,
          successMessage: `Package index refreshed on ${node}.`,
          title: `Refreshing apt index on ${node}`,
          upid: validUpid,
        },
      };
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to refresh package index.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}
