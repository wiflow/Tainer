"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { BasicActionState } from "@/lib/action-states";
import {
  requirePermission,
  requireSession,
  updateUserGroups,
  type AuthSession,
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

/**
 * Operations that touch an admin group — creating one, flipping `isAdmin`
 * on / off, or assigning a user into one — are role-changes in disguise:
 * `updateUserGroups` derives `user.role` from `groups.some(g => g.isAdmin)`,
 * so anyone permitted to do these things can promote themselves (or anyone
 * else) to admin. The `manage-groups` permission is intended for shuffling
 * non-privileged group membership, so we gate the privileged shape behind
 * the admin role explicitly. Without this, an operator with `manage-groups`
 * can chain create-admin-group + assign-self into a full takeover.
 */
function requireAdminForPrivilegedGroupOp(session: AuthSession): void {
  if (session.user.role !== "admin") {
    throw new Error(
      "Only admins can create, modify, or assign users to admin groups.",
    );
  }
}

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

    if (isAdmin) {
      requireAdminForPrivilegedGroupOp(session);
    }

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

    // Either editing an existing admin group or flipping a non-admin group
    // to admin requires admin role — both shapes can promote whoever's
    // already in the group (or future members) to admin.
    if (isAdmin || existing.isAdmin) {
      requireAdminForPrivilegedGroupOp(session);
    }

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

    // Resolve the requested groups so we can check whether any of them
    // would promote the target user to admin. `updateUserGroups` derives
    // role from `groups.some(g => g.isAdmin)`, so an admin-group assignment
    // IS a role change and must be gated on admin role.
    const allGroups = await listUserGroups();
    const requestedGroups = allGroups.filter((g) => groupIds.includes(g.id));
    const wouldGrantAdmin = requestedGroups.some((g) => g.isAdmin);

    if (wouldGrantAdmin) {
      requireAdminForPrivilegedGroupOp(session);
    }

    // Defense in depth: even an admin shouldn't be able to self-promote
    // through this path (admins are already admin; non-admins are blocked
    // above). This guard catches future regressions where the role gate
    // is loosened or a new group flag is added that grants privilege.
    if (userId === session.user.id && wouldGrantAdmin && session.user.role !== "admin") {
      return errorResult("Self-promotion to admin via group assignment is not allowed.");
    }

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
