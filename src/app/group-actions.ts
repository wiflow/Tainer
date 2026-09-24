"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { BasicActionState, BulkActionState, ProxmoxActionState } from "@/lib/action-states";
import { requireAdminSession, requireSession, requireSitePermission } from "@/lib/auth";
import { createRateLimiterOrThrow } from "@/lib/rate-limit";

const enforceRateLimit = createRateLimiterOrThrow("group-actions", 20, 5 * 60_000);
import {
  buildTagsWithTag,
  createContainerTag,
  deleteContainerTag,
  getContainerTag,
  getContainerTagBySlug,
  removeTagFromTags,
  updateContainerTag,
} from "@/lib/container-groups";
import {
  decodeDeploymentId,
  envTextToString,
  getContainerEnvText,
  getDeploymentDetail,
  getDeploymentIndex,
  removeProxmoxManagedTagColor,
  runContainerLifecycleAction,
  runVmLifecycleAction,
  syncProxmoxManagedTagColor,
  updateContainerConfig,
  updateVmConfig,
  withSiteConfig,
} from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import { getManagedTagValue, hasManagedTag, isTagColor } from "@/lib/tag-utils";

export async function createTagAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    enforceRateLimit(session.user.id);

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-deployments");
    return await withSiteConfig(siteConfig, async () => {

    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const colorValue = String(formData.get("color") ?? "zinc").trim();
    const color = isTagColor(colorValue) ? colorValue : "zinc";

    if (!name) {
      return {
        message: "Tag name is required.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (!slug) {
      return {
        message: "Tag name must contain at least one alphanumeric character.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    const existing = await getContainerTagBySlug(slug);
    if (existing) {
      return {
        message: `A tag with the slug "${slug}" already exists.`,
        requestId: randomUUID(),
        status: "error",
      };
    }

    await createContainerTag({ name, slug, description, color });

    try {
      await syncProxmoxManagedTagColor(getManagedTagValue(slug), color);
    } catch {
      // Non-fatal: tag is created locally even if Proxmox color sync fails
    }

    revalidatePath(`/sites/${siteSlug}/tags`);
    revalidatePath(`/sites/${siteSlug}/deployments`);

    return {
      message: `Tag "${name}" created.`,
      requestId: randomUUID(),
      status: "success",
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to create tag.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function updateTagAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    enforceRateLimit(session.user.id);

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-deployments");
    return await withSiteConfig(siteConfig, async () => {

    const tagId = String(formData.get("groupId") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const colorValue = String(formData.get("color") ?? "").trim();
    const color = isTagColor(colorValue) ? colorValue : "zinc";

    if (!tagId) {
      return {
        message: "Missing tag reference.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    const tag = await getContainerTag(tagId);
    if (!tag) {
      return {
        message: "Tag not found.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    await updateContainerTag(tagId, { description, color });

    try {
      await syncProxmoxManagedTagColor(getManagedTagValue(tag.slug), color);
    } catch {
      // Non-fatal: tag is updated locally even if Proxmox color sync fails
    }

    revalidatePath(`/sites/${siteSlug}/tags`);
    revalidatePath(`/sites/${siteSlug}/deployments`);

    return {
      message: `Tag "${tag.name}" updated.`,
      requestId: randomUUID(),
      status: "success",
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to update tag.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function deleteTagAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    await requireAdminSession();

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return await withSiteConfig(siteConfig, async () => {

    const tagId = String(formData.get("groupId") ?? "").trim();

    if (!tagId) {
      return {
        message: "Missing tag reference.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    const tag = await getContainerTag(tagId);
    if (!tag) {
      return {
        message: "Tag not found.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    const { deployments } = await getDeploymentIndex();
    const members = deployments.filter((deployment) => hasManagedTag(deployment.tagList, tag.slug));

    for (const deployment of members) {
      const nextTags = removeTagFromTags(deployment.tagList.join(";"), tag.slug);
      const params = new URLSearchParams();

      if (nextTags) {
        params.set("tags", nextTags);
      } else {
        params.set("delete", "tags");
      }

      if (deployment.type === "qemu") {
        await updateVmConfig(deployment.node, deployment.vmid, params);
      } else {
        await updateContainerConfig(deployment.node, deployment.vmid, params);
      }

      revalidatePath(`/sites/${siteSlug}/deployments/${deployment.id}`);
    }

    try {
      await removeProxmoxManagedTagColor(getManagedTagValue(tag.slug));
    } catch {
      // Non-fatal: tag is deleted locally even if Proxmox color cleanup fails
    }
    const deleted = await deleteContainerTag(tagId);
    if (!deleted) {
      return {
        message: "Tag not found.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    revalidatePath(`/sites/${siteSlug}/tags`);
    revalidatePath(`/sites/${siteSlug}/deployments`);
    revalidatePath(`/sites/${siteSlug}/tags/${tag.slug}`);

    return {
      message: members.length > 0
        ? `Tag "${tag.name}" deleted and removed from ${members.length} deployment(s).`
        : `Tag "${tag.name}" deleted.`,
      requestId: randomUUID(),
      status: "success",
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to delete tag.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function assignContainerToTagAction(
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
    requireSitePermission(session, siteConfig.siteId, "manage-deployments");
    return await withSiteConfig(siteConfig, async () => {

    const deploymentId = String(formData.get("deploymentId") ?? "").trim();
    const tagSlug = String(formData.get("groupSlug") ?? "").trim();
    const removeTagSlug = String(formData.get("removeGroupSlug") ?? "").trim();

    if (!deploymentId) {
      return {
        message: "Missing deployment reference.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const { node, vmid, type } = decodeDeploymentId(deploymentId);

    const detail = await getDeploymentDetail(deploymentId);
    if (!detail) {
      return {
        message: "Container not found.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const existingTags = detail.tagList.join(";");
    const newTags = removeTagSlug
      ? removeTagFromTags(existingTags, removeTagSlug)
      : tagSlug
        ? buildTagsWithTag(existingTags, tagSlug)
        : existingTags;

    const params = new URLSearchParams();
    if (newTags) {
      params.set("tags", newTags);
    } else {
      params.set("delete", "tags");
    }

    if (type === "qemu") {
      await updateVmConfig(node, vmid, params);
    } else {
      await updateContainerConfig(node, vmid, params);
    }

    revalidatePath(`/sites/${siteSlug}/tags`);
    revalidatePath(`/sites/${siteSlug}/deployments`);
    revalidatePath(`/sites/${siteSlug}/deployments/${deploymentId}`);

    return {
      message: removeTagSlug
        ? `Removed ${type === "qemu" ? "VM" : "CT"} ${vmid} from tag "${removeTagSlug}".`
        : `Assigned ${type === "qemu" ? "VM" : "CT"} ${vmid} to tag "${tagSlug}".`,
      requestId: randomUUID(),
      status: "success",
      task: null,
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to assign to tag.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function bulkTagLifecycleAction(
  _previousState: BulkActionState,
  formData: FormData,
): Promise<BulkActionState> {
  try {
    const session = await requireSession();
    enforceRateLimit(session.user.id);

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", tasks: [] };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-deployments");
    return await withSiteConfig(siteConfig, async () => {

    const tagSlug = String(formData.get("groupSlug") ?? "").trim();
    const command = String(formData.get("command") ?? "").trim() as
      | "start"
      | "stop"
      | "restart"
      | "shutdown";

    if (!tagSlug) {
      return {
        message: "Missing tag reference.",
        requestId: randomUUID(),
        status: "error",
        tasks: [],
      };
    }

    const validCommands = ["start", "stop", "restart", "shutdown"];
    if (!validCommands.includes(command)) {
      return {
        message: "Unsupported lifecycle command.",
        requestId: randomUUID(),
        status: "error",
        tasks: [],
      };
    }

    const { deployments } = await getDeploymentIndex();
    const deploymentIds = String(formData.get("deploymentIds") ?? "").trim();

    let members;
    if (tagSlug === "__bulk_ids__" && deploymentIds) {
      const idSet = new Set(deploymentIds.split(",").filter(Boolean));
      members = deployments.filter((d) => idSet.has(d.id));
    } else {
      members = deployments.filter(
        (d) => hasManagedTag(d.tagList, tagSlug),
      );
    }

    if (members.length === 0) {
      return {
        message: "No deployments found in this tag.",
        requestId: randomUUID(),
        status: "error",
        tasks: [],
      };
    }

    const commandLabels: Record<string, { present: string; submitted: string; success: string }> = {
      restart: { present: "Restarting", submitted: "Queued restart", success: "Restarted" },
      shutdown: { present: "Shutting down", submitted: "Queued shutdown", success: "Shutdown" },
      start: { present: "Starting", submitted: "Queued start", success: "Started" },
      stop: { present: "Stopping", submitted: "Queued stop", success: "Stopped" },
    };

    const meta = commandLabels[command];
    const tasks = await Promise.all(
      members.map(async (deployment) => {
        const upid = deployment.type === "qemu"
          ? await runVmLifecycleAction(deployment.node, deployment.vmid, command)
          : await runContainerLifecycleAction(deployment.node, deployment.vmid, command);
        const label = deployment.type === "qemu" ? "VM" : "CT";

        return {
          node: deployment.node,
          submittedMessage: `${meta.submitted} for ${label} ${deployment.vmid}.`,
          successMessage: `${meta.success} ${label} ${deployment.vmid}.`,
          title: `${meta.present} ${label} ${deployment.vmid}`,
          upid,
        };
      }),
    );

    revalidatePath(`/sites/${siteSlug}/tags`);
    revalidatePath(`/sites/${siteSlug}/deployments`);

    return {
      message: `${meta.present} ${members.length} deployment(s) in tag "${tagSlug}".`,
      requestId: randomUUID(),
      status: "success",
      tasks,
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to run bulk lifecycle action.",
      requestId: randomUUID(),
      status: "error",
      tasks: [],
    };
  }
}

export async function bulkSetEnvAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    await requireAdminSession();

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) return { message: "Missing site context.", requestId: randomUUID(), status: "error" };
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return await withSiteConfig(siteConfig, async () => {

    const tagSlug = String(formData.get("tagSlug") ?? "").trim();
    const envKey = String(formData.get("envKey") ?? "").trim();
    const envValue = String(formData.get("envValue") ?? "");
    const existingOnly = formData.get("existingOnly") === "true";
    const imageFilter = String(formData.get("imageFilter") ?? "").trim();

    if (!tagSlug || !envKey) {
      return {
        message: "Tag and environment variable key are required.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envKey)) {
      return {
        message: "Invalid key format. Use letters, numbers, and underscores only.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    const { deployments } = await getDeploymentIndex();
    const deploymentIds = String(formData.get("deploymentIds") ?? "").trim();

    let members;
    if (tagSlug === "__bulk_ids__" && deploymentIds) {
      // Bulk operations panel passes explicit IDs
      const idSet = new Set(deploymentIds.split(",").filter(Boolean));
      members = deployments.filter((d) => idSet.has(d.id));
    } else {
      members = deployments.filter(
        (d) => hasManagedTag(d.tagList, tagSlug),
      );
      // Filter by image if specified
      if (imageFilter) {
        members = members.filter((d) => d.templateName === imageFilter);
      }
    }

    // Environment variables are only supported on LXC containers
    const lxcMembers = members.filter((d) => d.type !== "qemu");
    const vmSkipped = members.length - lxcMembers.length;

    if (lxcMembers.length === 0) {
      return {
        message: vmSkipped > 0
          ? "All matching deployments are VMs. Environment variables are only supported on LXC containers."
          : "No containers found in this tag.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    let updated = 0;
    let skipped = 0;

    for (const member of lxcMembers) {
      try {
        const { node, vmid } = decodeDeploymentId(member.id);
        const currentEnv = await getContainerEnvText(node, vmid);

        // Parse current env into a map
        const envMap = new Map<string, string>();
        for (const line of currentEnv.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const sep = trimmed.indexOf("=");
          if (sep > 0) {
            envMap.set(trimmed.slice(0, sep).trim(), trimmed.slice(sep + 1));
          }
        }

        // If "existing only" mode, skip containers that don't have this key
        if (existingOnly && !envMap.has(envKey)) {
          skipped++;
          continue;
        }

        // Set/update the key
        envMap.set(envKey, envValue);

        // Write back
        const newEnvText = Array.from(envMap)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n");

        const params = new URLSearchParams();
        params.set("env", envTextToString(newEnvText));
        await updateContainerConfig(node, vmid, params);
        updated++;
      } catch {
        skipped++;
      }
    }

    revalidatePath(`/sites/${siteSlug}/tags`);
    revalidatePath(`/sites/${siteSlug}/deployments`);

    return {
      message: `Set ${envKey} on ${updated} container(s)${skipped > 0 ? `, skipped ${skipped}` : ""}${vmSkipped > 0 ? ` (${vmSkipped} VMs excluded)` : ""}.`,
      requestId: randomUUID(),
      status: "success",
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to set environment variable.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}
