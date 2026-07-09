import "server-only";

import {
  decodeDeploymentId,
  deleteContainer,
  deleteVm,
  envTextToString,
  getContainerEnvText,
  getDeploymentDetail,
  getDeploymentIndex,
  parseEnvText,
  runContainerLifecycleAction,
  runVmLifecycleAction,
  updateContainerConfig,
  updateVmConfig,
  waitForTask,
} from "@/lib/proxmox";
import { recordDeploymentActivity } from "@/lib/deployment-activity-log";
import { registerTool } from "@/lib/copilot/registry";
import {
  runInSite,
  runInSiteWithPermission,
  siteSlugSchema,
  type LeanDeployment,
} from "@/lib/copilot/tools/helpers";
import type { ApprovalPlan } from "@/lib/copilot/types";

/** Await a Proxmox task but give up after `ms` so a stuck stop can't hang the turn. */
async function waitForTaskBounded(node: string, upid: string, ms: number): Promise<boolean> {
  try {
    await Promise.race([
      waitForTask(node, upid),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), ms),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

function leanDeployment(d: import("@/lib/proxmox").LiveDeployment): LeanDeployment {
  return {
    id: d.id,
    vmid: d.vmid,
    name: d.name,
    node: d.node,
    type: d.type,
    status: d.rawStatus,
    ip: d.ipAddress,
    cpu: d.cpu,
    memory: d.memory,
    disk: d.disk,
    uptime: d.uptime,
    cpuUsage: d.cpuUsage,
    memUsedBytes: d.memUsedBytes,
    memTotalBytes: d.memTotalBytes,
    tags: d.tagList,
  };
}

/**
 * Fetch the (post-action) deployment summary so the client can render a
 * LifecycleResultCard with the real name/node/IP. Failures are non-fatal —
 * the tool result still carries the task UPID and a message, the card just
 * falls back to a plain success block.
 */
async function safeDeploymentSummary(deploymentId: string): Promise<LeanDeployment | null> {
  try {
    const detail = await getDeploymentDetail(deploymentId);
    return detail ? leanDeployment(detail) : null;
  } catch {
    return null;
  }
}

registerTool({
  name: "list_containers",
  category: "Containers",
  klass: "read",
  description:
    "List all containers and VMs in a site. Returns deployment id (use for other tools), vmid, name, node, type (lxc/qemu), status, IP, and resource usage.",
  input_schema: siteSlugSchema({
    status: {
      type: "string",
      enum: ["all", "running", "stopped"],
      description: "Filter by status. Defaults to 'all'.",
    },
  }),
  describe: (args) => `List containers in site ${args.siteSlug}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const status = String(args.status ?? "all");
    return runInSite(ctx.session, siteSlug, async () => {
      const { deployments } = await getDeploymentIndex();
      let filtered = deployments;
      if (status === "running") filtered = deployments.filter((d) => d.rawStatus === "running");
      else if (status === "stopped") filtered = deployments.filter((d) => d.rawStatus === "stopped");
      return filtered.map(leanDeployment);
    });
  },
});

registerTool({
  name: "get_container",
  category: "Containers",
  klass: "read",
  description:
    "Get detailed info for a single container/VM: full resource usage, configured cores/memory/swap, env-var count, network config, and any issues.",
  input_schema: siteSlugSchema({
    deploymentId: {
      type: "string",
      description: "The deployment id returned by list_containers (a base64url blob).",
    },
  }),
  describe: (args) => `Read deployment ${args.deploymentId} in site ${args.siteSlug}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const deploymentId = String(args.deploymentId ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const detail = await getDeploymentDetail(deploymentId);
      if (!detail) return { error: "Deployment not found." };
      return {
        ...leanDeployment(detail),
        coresConfigured: detail.coresConfigured,
        memoryConfiguredMb: detail.memoryConfiguredMb,
        swapConfiguredMb: detail.swapConfiguredMb,
        description: detail.description,
        envCount: detail.envCount,
        rootfs: detail.rootfs,
        ostemplate: detail.ostemplate,
        guestOsType: detail.guestOsType,
        resourceUsage: detail.resourceUsage,
        networkInfo: detail.networkInfo,
        issues: detail.issues,
      };
    });
  },
});

// -- Lifecycle actions (write) ---------------------------------------------

type LifecycleVerb = "start" | "stop" | "shutdown" | "restart";

function lifecycleTool(verb: LifecycleVerb, description: string) {
  registerTool({
    name: `${verb}_deployment`,
    category: "Containers",
    klass: "write",
    description,
    input_schema: siteSlugSchema({
      deploymentId: {
        type: "string",
        description: "The deployment id returned by list_containers.",
      },
    }),
    describe: (args) =>
      `${verb[0].toUpperCase()}${verb.slice(1)} deployment ${String(args.deploymentId)} (site ${String(args.siteSlug)})`,
    execute: async (args, ctx) => {
      const siteSlug = String(args.siteSlug ?? "");
      const deploymentId = String(args.deploymentId ?? "");
      return runInSiteWithPermission(
        ctx.session,
        siteSlug,
        "manage-deployments",
        async () => {
          const { node, vmid, type } = decodeDeploymentId(deploymentId);
          const upid =
            type === "qemu"
              ? await runVmLifecycleAction(node, vmid, verb)
              : await runContainerLifecycleAction(node, vmid, verb);
          recordDeploymentActivity({
            action: verb,
            deploymentId,
            message: `Tainy ${verb} ${type === "qemu" ? "VM" : "CT"} ${vmid}`,
            userEmail: ctx.session.user.email,
            userName: ctx.session.user.name,
            vmid,
          }).catch(() => {});
          const deployment = await safeDeploymentSummary(deploymentId);
          return {
            ok: true,
            verb,
            upid,
            message: `${verb} task submitted for ${type === "qemu" ? "VM" : "CT"} ${vmid}.`,
            deployment,
          };
        },
      );
    },
  });
}

lifecycleTool("start", "Start a stopped container or VM.");
lifecycleTool("stop", "Hard-stop a container or VM (immediate, no graceful shutdown).");
lifecycleTool("shutdown", "Gracefully shut down a container or VM.");
lifecycleTool("restart", "Restart a container or VM (reboot).");

// -- Resource updates (write) ----------------------------------------------

registerTool({
  name: "update_deployment_resources",
  category: "Containers",
  klass: "write",
  description:
    "Update the configured CPU cores, memory, and/or swap for a container or VM. Values that aren't passed are left untouched. For LXC containers, this writes the lxc config; for QEMU VMs, the vm config. Some changes (memory growth on a running container) require a restart to take effect.",
  input_schema: siteSlugSchema({
    deploymentId: {
      type: "string",
      description: "The deployment id returned by list_containers.",
    },
    cores: {
      type: "integer",
      minimum: 1,
      maximum: 256,
      description: "Number of CPU cores. Omit to leave unchanged.",
    },
    memoryMb: {
      type: "integer",
      minimum: 16,
      description: "Memory in megabytes. Omit to leave unchanged.",
    },
    swapMb: {
      type: "integer",
      minimum: 0,
      description: "Swap in megabytes (LXC only). Omit to leave unchanged.",
    },
  }),
  describe: (args) => {
    const parts: string[] = [];
    if (args.cores != null) parts.push(`cores=${args.cores}`);
    if (args.memoryMb != null) parts.push(`memory=${args.memoryMb}MB`);
    if (args.swapMb != null) parts.push(`swap=${args.swapMb}MB`);
    return `Update ${args.deploymentId} → ${parts.join(", ") || "(no changes)"} (site ${args.siteSlug})`;
  },
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const deploymentId = String(args.deploymentId ?? "");
    const cores = typeof args.cores === "number" ? args.cores : null;
    const memoryMb = typeof args.memoryMb === "number" ? args.memoryMb : null;
    const swapMb = typeof args.swapMb === "number" ? args.swapMb : null;

    if (cores === null && memoryMb === null && swapMb === null) {
      throw new Error("At least one of cores, memoryMb, or swapMb must be provided.");
    }

    return runInSiteWithPermission(ctx.session, siteSlug, "manage-deployments", async () => {
      const { node, vmid, type } = decodeDeploymentId(deploymentId);
      const params = new URLSearchParams();
      if (cores !== null) params.set("cores", String(cores));
      if (memoryMb !== null) params.set("memory", String(memoryMb));
      if (swapMb !== null && type === "lxc") params.set("swap", String(swapMb));

      if (type === "qemu") {
        await updateVmConfig(node, vmid, params);
      } else {
        await updateContainerConfig(node, vmid, params);
      }

      recordDeploymentActivity({
        action: "resources-updated",
        deploymentId,
        message: `Tainy updated resources for ${type === "qemu" ? "VM" : "CT"} ${vmid}`,
        userEmail: ctx.session.user.email,
        userName: ctx.session.user.name,
        vmid,
      }).catch(() => {});

      const deployment = await safeDeploymentSummary(deploymentId);
      return {
        ok: true,
        verb: "update-resources",
        applied: { cores, memoryMb, swapMb: type === "lxc" ? swapMb : null },
        deployment,
      };
    });
  },
});

// -- Env vars (write) ------------------------------------------------------

registerTool({
  name: "update_container_env",
  category: "Containers",
  klass: "write",
  description:
    "Update environment variables on an existing LXC container. Merges the provided key/value pairs into the container's current env (overrides existing keys, leaves untouched keys alone). Use this for 'change Grafana's port' (GF_SERVER_HTTP_PORT), 'set a feature flag', 'update a DB connection string', etc. Most env-driven services need a restart_deployment afterwards to pick up changes — ask the user first.",
  input_schema: siteSlugSchema({
    deploymentId: {
      type: "string",
      description: "Deployment id from list_containers (LXC only).",
    },
    env: {
      type: "object",
      description:
        "Key/value map of env vars to set. Existing keys not in this map are preserved. To DELETE a key, pass it with value null.",
      additionalProperties: { type: ["string", "null"] },
    },
  }),
  describe: (args) => {
    const env = (args.env as Record<string, unknown> | undefined) ?? {};
    const keys = Object.keys(env).slice(0, 4);
    const more = Object.keys(env).length - keys.length;
    return `Update env on ${String(args.deploymentId)} (${keys.join(", ")}${more > 0 ? `, +${more} more` : ""})`;
  },
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const deploymentId = String(args.deploymentId ?? "");
    const envInput = (args.env as Record<string, unknown> | undefined) ?? {};
    if (!envInput || Object.keys(envInput).length === 0) {
      throw new Error("env map cannot be empty.");
    }

    return runInSiteWithPermission(ctx.session, siteSlug, "manage-deployments", async () => {
      const { node, vmid, type } = decodeDeploymentId(deploymentId);
      if (type !== "lxc") {
        throw new Error("update_container_env supports LXC containers only.");
      }

      const currentText = await getContainerEnvText(node, vmid);
      const merged = new Map<string, string>(
        parseEnvText(currentText).map((p) => [p.key, p.value] as const),
      );
      const applied: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(envInput)) {
        if (!k.trim()) continue;
        if (v === null || v === undefined) {
          merged.delete(k);
          applied[k] = null;
        } else {
          const str = String(v);
          merged.set(k, str);
          applied[k] = str;
        }
      }

      const params = new URLSearchParams();
      if (merged.size === 0) {
        params.set("delete", "env");
      } else {
        const newText = Array.from(merged.entries())
          .map(([k, v]) => `${k}=${v}`)
          .join("\n");
        params.set("env", envTextToString(newText));
      }
      await updateContainerConfig(node, vmid, params);

      recordDeploymentActivity({
        action: "env-updated",
        deploymentId,
        message: `Tainy updated env on CT ${vmid} (${Object.keys(applied).join(", ")})`,
        userEmail: ctx.session.user.email,
        userName: ctx.session.user.name,
        vmid,
      }).catch(() => {});

      const deployment = await safeDeploymentSummary(deploymentId);
      return {
        ok: true,
        verb: "env-updated",
        applied,
        deployment,
      };
    });
  },
});

// -- Destroy (destructive) -------------------------------------------------

registerTool({
  name: "destroy_deployment",
  category: "Containers",
  klass: "destructive",
  description:
    "PERMANENTLY DELETE a container or VM. This destroys the rootfs/disks. There is no undo. Use only when the user has clearly asked for deletion.",
  input_schema: siteSlugSchema({
    deploymentId: {
      type: "string",
      description: "The deployment id returned by list_containers.",
    },
    confirmName: {
      type: "string",
      description:
        "Pass the container/VM name from get_container as confirmation. Server will reject if it doesn't match.",
    },
  }),
  describe: (args) => `DESTROY deployment ${args.deploymentId} (site ${args.siteSlug})`,
  // The container's own name is the typed-confirmation string. Reuses
  // existing get_container result rather than asking the user to type it
  // again — but the server still validates that confirmName matches what
  // Proxmox actually reports for that VMID, so a hallucinated name fails.
  confirmString: (args) => String(args.confirmName ?? ""),
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const deploymentId = String(args.deploymentId ?? "");
    const confirmName = String(args.confirmName ?? "");
    return runInSiteWithPermission(ctx.session, siteSlug, "delete-deployments", async () => {
      const detail = await getDeploymentDetail(deploymentId);
      if (!detail) throw new Error("Deployment not found.");
      if (detail.name !== confirmName) {
        throw new Error(
          `confirmName mismatch — expected "${detail.name}", got "${confirmName}". Refusing to delete.`,
        );
      }

      const { node, vmid, type } = decodeDeploymentId(deploymentId);
      const upid = type === "qemu" ? await deleteVm(node, vmid) : await deleteContainer(node, vmid);

      recordDeploymentActivity({
        action: "deleted",
        deploymentId,
        message: `Tainy destroyed ${type === "qemu" ? "VM" : "CT"} ${vmid} (${detail.name})`,
        userEmail: ctx.session.user.email,
        userName: ctx.session.user.name,
        vmid,
      }).catch(() => {});

      return {
        ok: true,
        verb: "destroy",
        upid,
        message: `Destroy task submitted for ${detail.name} (${type === "qemu" ? "VM" : "CT"} ${vmid}).`,
        deployment: leanDeployment(detail),
      };
    });
  },
});

// -- Batch destroy (destructive, one confirmation for the whole set) --------

const MAX_BATCH_DESTROY = 30;
const STOP_WAIT_MS = 25_000;

type ResolvedTarget = {
  deploymentId: string;
  node: string;
  vmid: number;
  type: "lxc" | "qemu";
  name: string;
  running: boolean;
};

/**
 * Resolve + validate the deployment ids for a batch destroy. Throws if any id
 * is unknown so the user never confirms a set that can't be fully actioned.
 */
async function resolveDestroyTargets(deploymentIds: string[]): Promise<ResolvedTarget[]> {
  const seen = new Set<string>();
  const targets: ResolvedTarget[] = [];
  for (const rawId of deploymentIds) {
    const deploymentId = String(rawId ?? "").trim();
    if (!deploymentId || seen.has(deploymentId)) continue;
    seen.add(deploymentId);
    const detail = await getDeploymentDetail(deploymentId);
    if (!detail) throw new Error(`Deployment ${deploymentId} not found — refusing the batch.`);
    const { node, vmid, type } = decodeDeploymentId(deploymentId);
    targets.push({
      deploymentId,
      node,
      vmid,
      type,
      name: detail.name,
      running: detail.rawStatus === "running",
    });
  }
  if (targets.length === 0) throw new Error("No valid deployments to destroy.");
  return targets;
}

registerTool({
  name: "destroy_batch_deployments",
  category: "Containers",
  klass: "destructive",
  description:
    "PERMANENTLY DELETE several containers/VMs in one action, with a single confirmation. Pass the deployment ids (from list_containers). Running guests are hard-stopped first automatically (in parallel, with a bounded wait) — you do NOT need to stop them yourself. The approval card lists every guest that will be destroyed. There is no undo. Use this for 'delete ignition-02 through ignition-10', 'remove all the temp containers', etc. — do NOT loop destroy_deployment.",
  input_schema: siteSlugSchema({
    deploymentIds: {
      type: "array",
      items: { type: "string" },
      description: `The deployment ids to destroy (from list_containers). Max ${MAX_BATCH_DESTROY}.`,
    },
  }),
  describe: (args) => {
    const ids = Array.isArray(args.deploymentIds) ? (args.deploymentIds as unknown[]) : [];
    return `DESTROY ${ids.length} deployments (site ${String(args.siteSlug)})`;
  },
  // Single typed confirmation for the whole batch — "delete N" matches the
  // count shown on the plan card.
  confirmString: (args) => {
    const ids = Array.isArray(args.deploymentIds) ? (args.deploymentIds as unknown[]) : [];
    return `delete ${ids.length}`;
  },
  plan: async (args, ctx): Promise<ApprovalPlan> => {
    const siteSlug = String(args.siteSlug ?? "");
    const ids = Array.isArray(args.deploymentIds) ? (args.deploymentIds as unknown[]).map(String) : [];
    return runInSite(ctx.session, siteSlug, async () => {
      const targets = await resolveDestroyTargets(ids);
      const runningCount = targets.filter((t) => t.running).length;
      return {
        summary: `Permanently destroy ${targets.length} deployment${targets.length === 1 ? "" : "s"}`,
        rows: targets.map((t) => ({
          hostname: t.name,
          vmid: t.vmid,
          ip: t.running ? "running → stop+delete" : "stopped → delete",
        })),
        note:
          (runningCount > 0
            ? `${runningCount} running guest${runningCount === 1 ? "" : "s"} will be hard-stopped first. `
            : "") + "No undo.",
      };
    });
  },
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const ids = Array.isArray(args.deploymentIds) ? (args.deploymentIds as unknown[]).map(String) : [];
    if (ids.length === 0) throw new Error("deploymentIds is required.");
    if (ids.length > MAX_BATCH_DESTROY) {
      throw new Error(`Too many at once — cap is ${MAX_BATCH_DESTROY}.`);
    }

    return runInSiteWithPermission(ctx.session, siteSlug, "delete-deployments", async () => {
      const targets = await resolveDestroyTargets(ids);

      // Phase 1: hard-stop every running guest in parallel, then wait (bounded)
      // for those stop tasks so the subsequent delete isn't rejected for a
      // still-running guest.
      const stops = await Promise.all(
        targets
          .filter((t) => t.running)
          .map(async (t) => {
            try {
              const upid =
                t.type === "qemu"
                  ? await runVmLifecycleAction(t.node, t.vmid, "stop")
                  : await runContainerLifecycleAction(t.node, t.vmid, "stop");
              const ok = await waitForTaskBounded(t.node, upid, STOP_WAIT_MS);
              return { vmid: t.vmid, ok };
            } catch {
              return { vmid: t.vmid, ok: false };
            }
          }),
      );
      const stoppedOk = new Set(stops.filter((s) => s.ok).map((s) => s.vmid));

      // Phase 2: delete each guest that is now stopped. A guest whose stop
      // timed out is reported as failed rather than force-deleted.
      const destroyed: Array<{ name: string; vmid: number }> = [];
      const failed: Array<{ name: string; vmid: number; error: string }> = [];
      for (const t of targets) {
        if (t.running && !stoppedOk.has(t.vmid)) {
          failed.push({ name: t.name, vmid: t.vmid, error: "Stop didn't finish in time — skipped." });
          continue;
        }
        try {
          if (t.type === "qemu") await deleteVm(t.node, t.vmid);
          else await deleteContainer(t.node, t.vmid);
          destroyed.push({ name: t.name, vmid: t.vmid });
          recordDeploymentActivity({
            action: "deleted",
            deploymentId: t.deploymentId,
            message: `Tainy batch-destroyed ${t.type === "qemu" ? "VM" : "CT"} ${t.vmid} (${t.name})`,
            userEmail: ctx.session.user.email,
            userName: ctx.session.user.name,
            vmid: t.vmid,
          }).catch(() => {});
        } catch (err) {
          failed.push({
            name: t.name,
            vmid: t.vmid,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return {
        ok: failed.length === 0,
        verb: "batch-destroy",
        destroyedCount: destroyed.length,
        failedCount: failed.length,
        destroyed,
        failed,
        message:
          failed.length === 0
            ? `Destroyed ${destroyed.length} deployment${destroyed.length === 1 ? "" : "s"}.`
            : `Destroyed ${destroyed.length}; ${failed.length} failed.`,
      };
    });
  },
});
