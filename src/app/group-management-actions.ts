"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { BasicActionState } from "@/lib/action-states";
import {
  requirePermission,
  requireSession,
  updateUserGroups,
} from "@/lib/auth";
import { recordAdminAudit } from "@/lib/admin-audit-log";
import type { Permission } from "@/lib/permissions";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { createRateLimiterOrThrow } from "@/lib/rate-limit";
import {
  createUserGroup,
  deleteUserGroup,
  getUserGroup,
  listUserGroups,
  updateUserGroup,
  type SiteAccessEntry,
} from "@/lib/user-groups";

const enforceRateLimit = createRateLimiterOrThrow("group-management", 20, 5 * 60_000);

function errorResult(message: string): BasicActionState {
  return { message, requestId: randomUUID(), status: "error" };
}

function successResult(message: string): BasicActionState {
  return { message, requestId: randomUUID(), status: "success" };
}

export async function createGroupAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-groups");
    enforceRateLimit(session.user.id);

    const name = String(formData.get("name") ?? "").trim();
    if (!name) return errorResult("Group name is required.");

    const description = String(formData.get("description") ?? "").trim();
    const isAdmin = formData.get("isAdmin") === "true";

    const globalPermsRaw = String(formData.get("globalPermissions") ?? "");
    const globalPermissions = globalPermsRaw
      .split(",")
      .map((p) => p.trim())
      .filter((p): p is Permission => ALL_PERMISSIONS.includes(p as Permission));

    const siteAccess = parseSiteAccessFromFormData(formData);

    const existing = await listUserGroups();
    if (existing.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      return errorResult("A group with that name already exists.");
    }

    const group = await createUserGroup({
      name,
      slug: "",
      description,
      isAdmin,
      globalPermissions: isAdmin ? [] : globalPermissions,
      siteAccess: isAdmin ? [] : siteAccess,
    });

    await recordAdminAudit({
      action: "group-created",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Created group "${group.name}"${isAdmin ? " (admin)" : ""}.`,
    });

    revalidatePath("/groups");

    return successResult(`Group "${group.name}" created.`);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "Failed to create group.");
  }
}

export async function updateGroupAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-groups");
    enforceRateLimit(session.user.id);

    const groupId = String(formData.get("groupId") ?? "").trim();
    if (!groupId) return errorResult("Group ID is required.");

    const existing = await getUserGroup(groupId);
    if (!existing) return errorResult("Group not found.");

    const name = String(formData.get("name") ?? "").trim();
    if (!name) return errorResult("Group name is required.");

    const description = String(formData.get("description") ?? "").trim();
    const isAdmin = formData.get("isAdmin") === "true";

    const globalPermsRaw = String(formData.get("globalPermissions") ?? "");
    const globalPermissions = globalPermsRaw
      .split(",")
      .map((p) => p.trim())
      .filter((p): p is Permission => ALL_PERMISSIONS.includes(p as Permission));

    const siteAccess = parseSiteAccessFromFormData(formData);

    const allGroups = await listUserGroups();
    if (allGroups.some((g) => g.id !== groupId && g.name.toLowerCase() === name.toLowerCase())) {
      return errorResult("A group with that name already exists.");
    }

    const updated = await updateUserGroup(groupId, {
      name,
      description,
      isAdmin,
      globalPermissions: isAdmin ? [] : globalPermissions,
      siteAccess: isAdmin ? [] : siteAccess,
    });

    if (!updated) return errorResult("Failed to update group.");

    await recordAdminAudit({
      action: "group-updated",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Updated group "${updated.name}".`,
    });

    revalidatePath("/groups");
    revalidatePath(`/groups/${groupId}`);

    return successResult(`Group "${updated.name}" updated.`);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "Failed to update group.");
  }
}

export async function deleteGroupAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-groups");
    enforceRateLimit(session.user.id);

    const groupId = String(formData.get("groupId") ?? "").trim();
    if (!groupId) return errorResult("Group ID is required.");

    const group = await getUserGroup(groupId);
    if (!group) return errorResult("Group not found.");

    const deleted = await deleteUserGroup(groupId);
    if (!deleted) return errorResult("Failed to delete group.");

    await recordAdminAudit({
      action: "group-deleted",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Deleted group "${group.name}".`,
    });

    revalidatePath("/groups");
    revalidatePath("/users");

    return successResult(`Group "${group.name}" deleted.`);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "Failed to delete group.");
  }
}

export async function updateUserGroupsAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-groups");
    enforceRateLimit(session.user.id);

    const userId = String(formData.get("userId") ?? "").trim();
    if (!userId) return errorResult("User ID is required.");

    const groupIdsRaw = String(formData.get("groupIds") ?? "");
    const groupIds = groupIdsRaw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    await updateUserGroups(userId, groupIds);

    await recordAdminAudit({
      action: "user-groups-updated",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Updated group assignments for user ${userId}. Groups: ${groupIds.length > 0 ? groupIds.join(", ") : "(none)"}.`,
    });

    revalidatePath("/users");

    return successResult("User groups updated.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "Failed to update user groups.");
  }
}

function parseSiteAccessFromFormData(formData: FormData): SiteAccessEntry[] {
  const entries: SiteAccessEntry[] = [];

  // Site access is encoded as:
  // site-{siteId}-enabled = "true"
  // site-{siteId}-permissions = "create-deployments,manage-deployments,..."
  const siteIds = new Set<string>();

  for (const [key] of formData.entries()) {
    const enabledMatch = key.match(/^site-(.+)-enabled$/);
    if (enabledMatch) {
      siteIds.add(enabledMatch[1]);
    }
  }

  for (const siteId of siteIds) {
    if (formData.get(`site-${siteId}-enabled`) !== "true") continue;

    const permsRaw = String(formData.get(`site-${siteId}-permissions`) ?? "");
    const permissions = permsRaw
      .split(",")
      .map((p) => p.trim())
      .filter((p): p is Permission => ALL_PERMISSIONS.includes(p as Permission));

    if (permissions.length > 0) {
      entries.push({ siteId, permissions });
    }
  }

  return entries;
}
