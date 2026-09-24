"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { recordAdminAudit } from "@/lib/admin-audit-log";
import type { ApiTokenActionState } from "@/app/api-token-action-states";
import { createApiToken, revokeApiToken } from "@/lib/api-tokens";
import { requireAdminSession } from "@/lib/auth";
import { SITE_PERMISSIONS, type Permission } from "@/lib/permissions";

function errorState(message: string): ApiTokenActionState {
  return { message, requestId: randomUUID(), status: "error", createdToken: null };
}

const MAX_EXPIRY_DAYS = 3650;

export async function createApiTokenAction(
  _previousState: ApiTokenActionState,
  formData: FormData,
): Promise<ApiTokenActionState> {
  try {
    const session = await requireAdminSession();

    const name = String(formData.get("name") ?? "").trim();
    if (!name) return errorState("Token name is required.");
    if (!/^[\w .-]{1,60}$/.test(name)) {
      return errorState("Name may use letters, digits, spaces, dot, dash (max 60).");
    }

    const permissions = formData
      .getAll("permissions")
      .map(String)
      .filter((p): p is Permission => (SITE_PERMISSIONS as Permission[]).includes(p as Permission));
    if (permissions.length === 0) {
      return errorState("Select at least one permission.");
    }

    const siteIds = formData.getAll("siteIds").map(String).filter(Boolean);

    const expiresDaysRaw = String(formData.get("expiresDays") ?? "").trim();
    let expiresAt: string | null = null;
    if (expiresDaysRaw) {
      const days = Number.parseInt(expiresDaysRaw, 10);
      if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS) {
        return errorState(`Expiry must be 1-${MAX_EXPIRY_DAYS} days (or empty for no expiry).`);
      }
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    }

    const { token, record } = await createApiToken({
      name,
      permissions,
      siteIds,
      expiresAt,
      createdBy: session.user.email,
    });

    await recordAdminAudit({
      action: "api-token-created",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `API token "${record.name}" created (${record.displayPrefix}…), permissions: ${permissions.join(", ")}; sites: ${siteIds.length ? siteIds.length : "all"}${expiresAt ? `; expires ${expiresAt.slice(0, 10)}` : "; no expiry"}`,
    });

    revalidatePath("/sites");
    return {
      message: `Token "${record.name}" created. Copy it now, it won't be shown again.`,
      requestId: randomUUID(),
      status: "success",
      createdToken: token,
    };
  } catch (error) {
    return errorState(error instanceof Error ? error.message : "Failed to create token.");
  }
}

export async function revokeApiTokenAction(
  _previousState: ApiTokenActionState,
  formData: FormData,
): Promise<ApiTokenActionState> {
  try {
    const session = await requireAdminSession();
    const id = String(formData.get("id") ?? "").trim();
    if (!id) return errorState("Missing token id.");

    const revoked = await revokeApiToken(id);
    if (!revoked) return errorState("Token not found or already revoked.");

    await recordAdminAudit({
      action: "api-token-revoked",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `API token "${revoked.name}" revoked (${revoked.displayPrefix}…)`,
    });

    revalidatePath("/sites");
    return {
      message: `Token "${revoked.name}" revoked.`,
      requestId: randomUUID(),
      status: "success",
      createdToken: null,
    };
  } catch (error) {
    return errorState(error instanceof Error ? error.message : "Failed to revoke token.");
  }
}
