import "server-only";

import { randomBytes } from "node:crypto";

import { recordDeploymentActivity } from "@/lib/deployment-activity-log";
import { getDeploymentTemplate } from "@/lib/deployment-templates";
import {
  buildContainerNetworkConfig,
  createContainer,
  encodeDeploymentId,
  envTextToString,
  getDeploymentDetail,
  getDeploymentIndex,
  getNextId,
  parseEnvText,
  runContainerLifecycleAction,
  updateContainerConfig,
  waitForTask,
} from "@/lib/proxmox";
import { getIpPoolCatalog, resolveIpPoolSelection } from "@/lib/ip-pools";
import { logSafe } from "@/lib/log-safe";
import { buildDescription, type TainerMeta } from "@/lib/tainer-meta";
import { registerTool } from "@/lib/copilot/registry";
import {
  runInSite,
  runInSiteWithPermission,
  siteSlugSchema,
} from "@/lib/copilot/tools/helpers";
import type { ApprovalPlan } from "@/lib/copilot/types";

export const HOSTNAME_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function generatePassword(): string {
  return randomBytes(14).toString("base64url");
}

export async function assertUniqueHostname(hostname: string) {
  const target = hostname.trim().toLowerCase();
  if (!target) throw new Error("Hostname is required.");
  const { deployments } = await getDeploymentIndex();
  const existing = deployments.find((d) => d.name.trim().toLowerCase() === target);
  if (existing) {
    throw new Error(
      `Hostname "${hostname}" is already in use by ${existing.type === "qemu" ? "VM" : "CT"} ${existing.vmid} on ${existing.node}.`,
    );
  }
}

export function mergeEnvOverrides(
  baseEnvText: string,
  overrides: Record<string, string> | null,
): string {
  if (!overrides || Object.keys(overrides).length === 0) return baseEnvText;
  const pairs = parseEnvText(baseEnvText);
  const map = new Map(pairs.map((p) => [p.key, p.value] as const));
  for (const [k, v] of Object.entries(overrides)) {
    if (typeof k !== "string" || !k.trim()) continue;
    map.set(k, String(v));
  }
  return Array.from(map.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

registerTool({
  name: "launch_from_deployment_template",
  category: "Containers",
  klass: "write",
  description:
    "Create a NEW LXC container by launching one of the user-defined deployment templates (from list_deployment_templates). Picks the next free VMID, applies the template's defaults (OS image, cores, memory, rootfs storage, bridge), merges in any env overrides you pass, generates a random root password, and starts the container. Use this for 'create another grafana on port 3030', 'spin up a copy of X', or 'deploy a new container from the Y template'. By default the container gets a DHCP address. For a STATIC IP from an IP pool, pass ipPoolId (call list_ip_pools first). The pool's bridge/gateway/prefix/DNS are used and either the address you pass or the first free one in the pool is assigned. Returns the new deployment + a one-time root password.",
  input_schema: siteSlugSchema({
    templateId: {
      type: "string",
      description:
        "Deployment template id from list_deployment_templates. NOT an OS template. It must be the curated launch preset.",
    },
    hostname: {
      type: "string",
      description:
        "Unique lowercase hostname for the new container (1-63 chars, [a-z0-9-]). Must not match any existing deployment's name in this site.",
    },
    ipPoolId: {
      type: "string",
      description:
        "Optional IP pool id (from list_ip_pools) to assign a STATIC IPv4 from. When set, the container gets the pool's bridge, gateway, prefix, and DNS instead of DHCP. Omit for DHCP.",
    },
    address: {
      type: "string",
      description:
        "Optional specific IPv4 to assign from ipPoolId (must be one of the pool's available addresses). If ipPoolId is set but address is omitted, the first free address in the pool is used. Ignored without ipPoolId.",
    },
    envOverrides: {
      type: "object",
      description:
        "Optional key/value map of env vars to set on top of the template's defaults. Use this to override service-specific settings like GF_SERVER_HTTP_PORT for Grafana. Plain strings only.",
      additionalProperties: { type: "string" },
    },
    startAfterCreate: {
      type: "boolean",
      description: "Start the container once creation completes. Default true.",
    },
  }),
  describe: (args) => {
    const overrides = args.envOverrides as Record<string, string> | undefined;
    const envSummary =
      overrides && Object.keys(overrides).length
        ? ` with env ${Object.keys(overrides).join(", ")}`
        : "";
    const ipSummary = args.ipPoolId
      ? `, static IP ${args.address ? String(args.address) : "(first free)"} from pool`
      : "";
    return `Launch new container "${String(args.hostname)}" from template ${String(args.templateId)} (site ${String(args.siteSlug)})${envSummary}${ipSummary}`;
  },
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const templateId = String(args.templateId ?? "");
    const hostname = String(args.hostname ?? "")
      .trim()
      .toLowerCase();
    const envOverrides =
      (args.envOverrides && typeof args.envOverrides === "object"
        ? (args.envOverrides as Record<string, string>)
        : null);
    const startAfterCreate = args.startAfterCreate !== false;
    const ipPoolId = typeof args.ipPoolId === "string" ? args.ipPoolId.trim() : "";
    const requestedAddress = typeof args.address === "string" ? args.address.trim() : "";

    if (!HOSTNAME_REGEX.test(hostname)) {
      throw new Error(
        `Hostname must match [a-z0-9-], 1-63 chars (got "${hostname}").`,
      );
    }

    return runInSiteWithPermission(ctx.session, siteSlug, "create-deployments", async () => {
      const template = await getDeploymentTemplate(templateId);
      if (!template) throw new Error("Deployment template not found.");

      await assertUniqueHostname(hostname);

      let staticNet: { net0: string; nameserver: string; assigned: string; pool: string } | null =
        null;
      if (ipPoolId) {
        let address = requestedAddress;
        if (!address) {
          const catalog = await getIpPoolCatalog();
          const pool = catalog.find((entry) => entry.id === ipPoolId);
          if (!pool) throw new Error("IP pool not found. Use list_ip_pools for valid ids.");
          address = pool.availableAddresses[0] ?? "";
          if (!address) throw new Error(`IP pool "${pool.name}" has no free addresses.`);
        }
        const selection = await resolveIpPoolSelection(ipPoolId, address);
        staticNet = {
          net0: buildContainerNetworkConfig({
            bridge: selection.bridge,
            gateway: selection.gateway,
            ipv4Cidr: selection.ipv4Cidr,
            mode: "static",
          }),
          nameserver: selection.nameserver,
          assigned: selection.ipv4Cidr,
          pool: selection.pool.name,
        };
      }

      const vmidStr = await getNextId();
      if (!vmidStr) throw new Error("Couldn't allocate a VMID. The cluster may be exhausted.");
      const vmid = Number(vmidStr);
      if (!Number.isInteger(vmid) || vmid <= 0) {
        throw new Error("Allocated VMID is invalid.");
      }

      const password = generatePassword();

      const params = new URLSearchParams();
      params.set("vmid", vmidStr);
      params.set("ostemplate", template.sourceVolid);
      params.set("hostname", hostname);
      params.set("rootfs", `${template.rootfsStorage}:${template.rootfsSize}`);
      params.set("memory", template.memory || "512");
      params.set("cores", template.cores || "2");
      params.set("password", password);
      params.set("swap", "512");
      params.set("unprivileged", template.unprivileged ? "1" : "0");
      params.set("onboot", template.onboot ? "1" : "0");
      if (staticNet) {
        params.set("net0", staticNet.net0);
        if (staticNet.nameserver) params.set("nameserver", staticNet.nameserver);
      } else if (template.bridge) {
        params.set("net0", `name=eth0,bridge=${template.bridge},ip=dhcp`);
      }

      const meta: TainerMeta = {
        templateId: template.id,
        templateName: template.name,
        deployedAt: new Date().toISOString(),
        templateVersion: template.updatedAt,
        imageVolid: template.sourceVolid,
      };
      params.set("description", buildDescription("", meta));

      const upid = await createContainer(template.node, params);
      const deploymentId = encodeDeploymentId(template.node, vmid, "lxc");

      recordDeploymentActivity({
        action: "created",
        deploymentId,
        message: `Tainy launched CT ${vmid} (${hostname}) from template "${template.name}"${staticNet ? ` with static IP ${staticNet.assigned} (pool "${staticNet.pool}")` : ""}`,
        userEmail: ctx.session.user.email,
        userName: ctx.session.user.name,
        vmid,
      }).catch(() => {});

      const baseEnv = template.envText ?? "";
      const mergedEnv = mergeEnvOverrides(baseEnv, envOverrides);
      void waitForTask(template.node, upid)
        .then(async () => {
          if (mergedEnv.trim()) {
            const envParams = new URLSearchParams();
            envParams.set("env", envTextToString(mergedEnv));
            await updateContainerConfig(template.node, vmid, envParams).catch((err) => {
              console.error(`[copilot] env apply failed for ${logSafe(vmid)}:`, logSafe(err));
            });
          }
          if (startAfterCreate) {
            await runContainerLifecycleAction(template.node, vmid, "start").catch((err) => {
              console.error(`[copilot] start failed for ${logSafe(vmid)}:`, logSafe(err));
            });
          }
        })
        .catch((err) => console.error(`[copilot] post-create chain failed for ${vmid}:`, err));

      const deployment = await getDeploymentDetail(deploymentId).catch(() => null);

      return {
        ok: true,
        verb: "create",
        upid,
        message: `Launching ${hostname} (CT ${vmid}) on ${template.node} from template "${template.name}"${staticNet ? ` with static IP ${staticNet.assigned}` : " (DHCP)"}.`,
        network: staticNet
          ? { mode: "static" as const, address: staticNet.assigned, pool: staticNet.pool }
          : { mode: "dhcp" as const },
        deployment: deployment
          ? {
              id: deployment.id,
              vmid: deployment.vmid,
              name: deployment.name,
              node: deployment.node,
              type: deployment.type,
              status: deployment.rawStatus,
              ip: deployment.ipAddress,
            }
          : {
              id: deploymentId,
              vmid,
              name: hostname,
              node: template.node,
              type: "lxc" as const,
              status: "creating",
              ip: "—",
            },
        credentials: {
          type: "root-password" as const,
          username: "root",
          value: password,
          warning: "Save this. Tainer won't show it again.",
        },
        envApplied: envOverrides ?? null,
        willAutoStart: startAfterCreate,
      };
    });
  },
});

const MAX_BATCH = 20;

type BatchPlanRow = {
  hostname: string;
  vmid: number;
  /** "10.0.0.5/24" for static, "DHCP" otherwise. */
  ip: string;
  net0: string;
  nameserver: string;
};

type BatchPlan = {
  template: NonNullable<Awaited<ReturnType<typeof getDeploymentTemplate>>>;
  mode: "static" | "dhcp";
  poolName: string | null;
  rows: BatchPlanRow[];
};

/** Must run inside runInSite or runInSiteWithPermission. */
async function computeBatchPlan(rawArgs: Record<string, unknown>): Promise<BatchPlan> {
  const templateId = String(rawArgs.templateId ?? "");
  const prefix = String(rawArgs.hostnamePrefix ?? "").trim().toLowerCase();
  const count = Math.floor(Number(rawArgs.count));
  const startIndex = Number.isInteger(Number(rawArgs.startIndex))
    ? Number(rawArgs.startIndex)
    : 1;
  const ipPoolId = typeof rawArgs.ipPoolId === "string" ? rawArgs.ipPoolId.trim() : "";

  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH) {
    throw new Error(`count must be between 1 and ${MAX_BATCH}.`);
  }
  if (!prefix) throw new Error("hostnamePrefix is required for a batch.");

  const template = await getDeploymentTemplate(templateId);
  if (!template) throw new Error("Deployment template not found.");

  const { deployments } = await getDeploymentIndex();
  const existingNames = new Set(deployments.map((d) => d.name.trim().toLowerCase()));
  const usedVmids = new Set(deployments.map((d) => d.vmid));

  const width = Math.max(2, String(startIndex + count - 1).length);
  const hostnames: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const hostname = `${prefix}${String(startIndex + i).padStart(width, "0")}`;
    if (!HOSTNAME_REGEX.test(hostname)) {
      throw new Error(`Generated hostname "${hostname}" is invalid. Pick a simpler prefix.`);
    }
    if (existingNames.has(hostname)) {
      throw new Error(`Hostname "${hostname}" is already in use. Choose a different prefix or start index.`);
    }
    hostnames.push(hostname);
  }

  const baseStr = await getNextId();
  if (!baseStr) throw new Error("Couldn't allocate VMIDs. The cluster may be exhausted.");
  let candidate = Number(baseStr);
  const vmids: number[] = [];
  while (vmids.length < count) {
    if (!usedVmids.has(candidate)) {
      vmids.push(candidate);
      usedVmids.add(candidate);
    }
    candidate += 1;
    if (candidate > 999_999_999) throw new Error("Ran out of VMIDs while planning the batch.");
  }

  let mode: "static" | "dhcp" = "dhcp";
  let poolName: string | null = null;
  const ips: { ip: string; net0: string; nameserver: string }[] = [];
  if (ipPoolId) {
    const catalog = await getIpPoolCatalog();
    const pool = catalog.find((entry) => entry.id === ipPoolId);
    if (!pool) throw new Error("IP pool not found. Use list_ip_pools for valid ids.");
    if (pool.availableAddresses.length < count) {
      throw new Error(
        `IP pool "${pool.name}" has only ${pool.availableAddresses.length} free address(es), but ${count} are needed.`,
      );
    }
    mode = "static";
    poolName = pool.name;
    for (let i = 0; i < count; i += 1) {
      const address = pool.availableAddresses[i];
      const cidr = `${address}/${pool.hostPrefix}`;
      ips.push({
        ip: cidr,
        net0: buildContainerNetworkConfig({
          bridge: pool.bridge,
          gateway: pool.gateway,
          ipv4Cidr: cidr,
          mode: "static",
        }),
        nameserver: pool.defaultDns,
      });
    }
  } else {
    for (let i = 0; i < count; i += 1) {
      ips.push({
        ip: "DHCP",
        net0: template.bridge ? `name=eth0,bridge=${template.bridge},ip=dhcp` : "",
        nameserver: "",
      });
    }
  }

  const rows: BatchPlanRow[] = hostnames.map((hostname, i) => ({
    hostname,
    vmid: vmids[i],
    ip: ips[i].ip,
    net0: ips[i].net0,
    nameserver: ips[i].nameserver,
  }));

  return { template, mode, poolName, rows };
}

registerTool({
  name: "launch_batch_from_deployment_template",
  category: "Containers",
  klass: "write",
  description:
    "Create MULTIPLE LXC containers at once from a deployment template, with one approval for the whole set. Use this for 'create 10 from the grafana template', 'spin up 5 web servers', etc. Hostnames are generated as <prefix><zero-padded index> (e.g. prefix 'web', count 5 → web01..web05). Pass ipPoolId to give each a STATIC IP from a pool (the first N free addresses are reserved in order; fails if the pool doesn't have enough); omit it for DHCP. The approval card shows the exact hostname + IP for every container before you confirm once. Returns each new container with its own one-time root password.",
  input_schema: siteSlugSchema({
    templateId: {
      type: "string",
      description: "Deployment template id from list_deployment_templates.",
    },
    hostnamePrefix: {
      type: "string",
      description:
        "Lowercase prefix for generated hostnames ([a-z0-9-]); each container becomes <prefix><NN>, e.g. 'web' → web01, web02, …",
    },
    count: {
      type: "integer",
      minimum: 1,
      maximum: MAX_BATCH,
      description: `How many containers to create (1-${MAX_BATCH}).`,
    },
    startIndex: {
      type: "integer",
      minimum: 0,
      description: "First number in the hostname sequence. Default 1.",
    },
    ipPoolId: {
      type: "string",
      description:
        "Optional IP pool id (from list_ip_pools). When set, each container gets a static IP: the first N free addresses in the pool, in order. Omit for DHCP.",
    },
    startAfterCreate: {
      type: "boolean",
      description: "Start each container after creation. Default true.",
    },
  }),
  describe: (args) =>
    `Create ${String(args.count)} containers "${String(args.hostnamePrefix)}${"…"}" from template ${String(args.templateId)}${args.ipPoolId ? " with static IPs from pool" : " (DHCP)"} (site ${String(args.siteSlug)})`,
  plan: async (args, ctx): Promise<ApprovalPlan> => {
    const siteSlug = String(args.siteSlug ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const plan = await computeBatchPlan(args);
      return {
        summary: `${plan.rows.length} containers from template "${plan.template.name}"`,
        rows: plan.rows.map((r) => ({ hostname: r.hostname, vmid: r.vmid, ip: r.ip })),
        note:
          plan.mode === "static"
            ? `Static IPs from pool "${plan.poolName}"`
            : "DHCP addresses",
      };
    });
  },
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const startAfterCreate = args.startAfterCreate !== false;

    return runInSiteWithPermission(ctx.session, siteSlug, "create-deployments", async () => {
      const plan = await computeBatchPlan(args);
      const { template } = plan;
      const created: Array<{
        hostname: string;
        vmid: number;
        node: string;
        ip: string;
        deploymentId: string;
        password: string;
      }> = [];
      const failed: Array<{ hostname: string; error: string }> = [];

      for (const row of plan.rows) {
        try {
          const password = generatePassword();
          const params = new URLSearchParams();
          params.set("vmid", String(row.vmid));
          params.set("ostemplate", template.sourceVolid);
          params.set("hostname", row.hostname);
          params.set("rootfs", `${template.rootfsStorage}:${template.rootfsSize}`);
          params.set("memory", template.memory || "512");
          params.set("cores", template.cores || "2");
          params.set("password", password);
          params.set("swap", "512");
          params.set("unprivileged", template.unprivileged ? "1" : "0");
          params.set("onboot", template.onboot ? "1" : "0");
          if (row.net0) params.set("net0", row.net0);
          if (row.nameserver) params.set("nameserver", row.nameserver);

          const meta: TainerMeta = {
            templateId: template.id,
            templateName: template.name,
            deployedAt: new Date().toISOString(),
            templateVersion: template.updatedAt,
            imageVolid: template.sourceVolid,
          };
          params.set("description", buildDescription("", meta));

          const upid = await createContainer(template.node, params);
          const deploymentId = encodeDeploymentId(template.node, row.vmid, "lxc");
          created.push({
            hostname: row.hostname,
            vmid: row.vmid,
            node: template.node,
            ip: row.ip,
            deploymentId,
            password,
          });

          recordDeploymentActivity({
            action: "created",
            deploymentId,
            message: `Tainy batch-launched CT ${row.vmid} (${row.hostname}) from template "${template.name}"${plan.mode === "static" ? ` with static IP ${row.ip}` : ""}`,
            userEmail: ctx.session.user.email,
            userName: ctx.session.user.name,
            vmid: row.vmid,
          }).catch(() => {});

          const baseEnv = template.envText ?? "";
          void waitForTask(template.node, upid)
            .then(async () => {
              if (baseEnv.trim()) {
                const envParams = new URLSearchParams();
                envParams.set("env", envTextToString(baseEnv));
                await updateContainerConfig(template.node, row.vmid, envParams).catch((err) =>
                  console.error(`[copilot] batch env apply failed for ${logSafe(row.vmid)}:`, logSafe(err)),
                );
              }
              if (startAfterCreate) {
                await runContainerLifecycleAction(template.node, row.vmid, "start").catch((err) =>
                  console.error(`[copilot] batch start failed for ${logSafe(row.vmid)}:`, logSafe(err)),
                );
              }
            })
            .catch((err) =>
              console.error(`[copilot] batch post-create chain failed for ${row.vmid}:`, err),
            );
        } catch (err) {
          failed.push({
            hostname: row.hostname,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return {
        ok: failed.length === 0,
        verb: "batch-create",
        mode: plan.mode,
        poolName: plan.poolName,
        template: template.name,
        node: template.node,
        createdCount: created.length,
        failedCount: failed.length,
        created,
        failed,
        willAutoStart: startAfterCreate,
        message:
          failed.length === 0
            ? `Launching ${created.length} containers from "${template.name}".`
            : `Launched ${created.length} of ${plan.rows.length}; ${failed.length} failed.`,
      };
    });
  },
});
