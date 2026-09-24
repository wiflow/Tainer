"use server";

import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

import { revalidatePath, revalidateTag } from "next/cache";

import type { ProxmoxActionState } from "@/lib/action-states";
import { requireSession, requireSitePermission } from "@/lib/auth";
import {
  buildProvisionedDeploymentSshKey,
  saveGeneratedDeploymentSshKey,
} from "@/lib/deployment-ssh-keys";
import { getDeploymentTemplate } from "@/lib/deployment-templates";
import { buildTagsWithTag } from "@/lib/container-groups";
import { saveImageEnv } from "@/lib/image-env-cache";
import { resolveIpPoolSelection } from "@/lib/ip-pools";
import {
  clearDeploymentActivities,
  recordDeploymentActivity,
} from "@/lib/deployment-activity-log";
import { assertSafeDownloadUrl } from "@/lib/import-url";
import { buildDescription, stripTainerMeta, type TainerMeta } from "@/lib/tainer-meta";
import {
  createContainer,
  type ContainerLifecycleAction,
  decodeDeploymentId,
  deleteContainer,
  encodeDeploymentId,
  envTextToString,
  getContainerEnvText,
  getDeploymentIndex,
  getDeploymentDetail,
  getTemplateFileInfo,
  importTemplateFromUrl,
  migrateContainer,
  runContainerLifecycleAction,
  updateContainerConfig,
  updateVmConfig,
  waitForTask,
  withSiteConfig,
} from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

const NODE_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,61}[a-zA-Z0-9])?$/;
const STORAGE_REGEX = /^[a-zA-Z0-9._-]{1,63}$/;
const VMID_REGEX = /^\d{1,9}$/;
const BRIDGE_REGEX = /^[a-zA-Z0-9._-]{1,32}$/;
const HOSTNAME_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const NETWORK_MODE_VALUES = new Set(["dhcp", "static"]);
const POSIX_USERNAME_REGEX = /^[a-z_][a-z0-9_-]{0,31}$/;

function validateField(value: string, regex: RegExp, label: string): string {
  if (!regex.test(value)) {
    throw new Error(`Invalid ${label} format.`);
  }
  return value;
}

function normalizeNetworkMode(value: string) {
  const normalized = value.trim().toLowerCase();
  return NETWORK_MODE_VALUES.has(normalized) ? normalized : "dhcp";
}

async function assertUniqueDeploymentHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();

  if (!normalized) {
    return;
  }

  const { deployments } = await getDeploymentIndex();
  const existing = deployments.find(
    (deployment) => deployment.name.trim().toLowerCase() === normalized,
  );

  if (!existing) {
    return;
  }

  const label = existing.type === "qemu" ? "VM" : "CT";
  throw new Error(
    `Hostname "${hostname}" is already in use by ${label} ${existing.vmid} on ${existing.node}. Use a unique hostname to avoid downstream subdomain conflicts.`,
  );
}

function validateIpv4Address(value: string, label: string) {
  const trimmed = value.trim();

  if (!trimmed || isIP(trimmed) !== 4) {
    throw new Error(`Invalid ${label}. Use an IPv4 address.`);
  }

  return trimmed;
}

function validateIpv4Cidr(value: string) {
  const trimmed = value.trim();
  const [address = "", prefixText = ""] = trimmed.split("/", 2);
  const prefix = Number(prefixText);

  if (
    !trimmed ||
    trimmed.split("/").length !== 2 ||
    isIP(address) !== 4 ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 32
  ) {
    throw new Error("Invalid IPv4 / CIDR. Use a value like 10.0.0.50/24.");
  }

  return `${address}/${prefix}`;
}

function normalizeNameserverList(value: string) {
  const addresses = value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const address of addresses) {
    if (isIP(address) === 0) {
      throw new Error(`Invalid DNS server "${address}". Use IP addresses only.`);
    }
  }

  return addresses.join(" ");
}

function buildContainerNetworkConfig(input: {
  bridge: string;
  gateway: string;
  ipv4Cidr: string;
  mode: string;
}) {
  const parts = [`name=eth0`, `bridge=${input.bridge}`];

  if (input.mode === "static") {
    parts.push(`ip=${input.ipv4Cidr}`);

    if (input.gateway) {
      parts.push(`gw=${input.gateway}`);
    }
  } else {
    parts.push("ip=dhcp");
  }

  return parts.join(",");
}

const OPERATION_RATE_LIMIT = 10;
const OPERATION_WINDOW_MS = 5 * 60_000;
const operationCounts = new Map<string, { count: number; firstOp: number }>();

function checkOperationRateLimit(userId: string) {
  const cutoff = Date.now() - OPERATION_WINDOW_MS;
  for (const [key, entry] of operationCounts) {
    if (entry.firstOp < cutoff) operationCounts.delete(key);
  }

  const now = Date.now();
  const entry = operationCounts.get(userId);
  if (entry && now - entry.firstOp < OPERATION_WINDOW_MS) {
    if (entry.count >= OPERATION_RATE_LIMIT) {
      throw new Error("Too many operations. Please wait a few minutes.");
    }
    entry.count += 1;
  } else {
    operationCounts.set(userId, { count: 1, firstOp: now });
  }
}

function mergeEnvText(existing: string, incoming: string): string {
  const map = new Map<string, string>();

  for (const text of [existing, incoming]) {
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const sep = trimmed.indexOf("=");
      if (sep > 0) {
        map.set(trimmed.slice(0, sep).trim(), trimmed.slice(sep + 1));
      }
    }
  }

  return Array.from(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

const DEPLOYMENT_ACTION_META: Record<
  ContainerLifecycleAction,
  {
    present: string;
    past: string;
    submitted: string;
    success: string;
  }
> = {
  restart: {
    past: "restarted",
    present: "Restarting",
    submitted: "Queued restart",
    success: "Restarted",
  },
  shutdown: {
    past: "shutdown",
    present: "Shutting down",
    submitted: "Queued shutdown",
    success: "Shutdown completed for",
  },
  start: {
    past: "started",
    present: "Starting",
    submitted: "Queued start",
    success: "Started",
  },
  stop: {
    past: "stopped",
    present: "Stopping",
    submitted: "Queued force stop",
    success: "Stopped",
  },
};

export async function createLxcAction(
  _previousState: ProxmoxActionState,
  formData: FormData,
): Promise<ProxmoxActionState> {
  try {
    const session = await requireSession();
    checkOperationRateLimit(session.user.id);

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "create-deployments");
    return await withSiteConfig(siteConfig, async () => {

    const node = String(formData.get("node") ?? "").trim();
    const vmid = String(formData.get("vmid") ?? "").trim();
    const ostemplate = String(formData.get("ostemplate") ?? "").trim();
    const hostname = String(formData.get("hostname") ?? "").trim().toLowerCase();
    const rootfsStorage = String(formData.get("rootfsStorage") ?? "").trim();
    const rootfsSize = String(formData.get("rootfsSize") ?? "").trim();
    const memory = String(formData.get("memory") ?? "").trim();
    const cores = String(formData.get("cores") ?? "").trim();
    const password = String(formData.get("password") ?? "").trim();
    const bridge = String(formData.get("bridge") ?? "").trim();
    const ipPoolId = String(formData.get("ipPoolId") ?? "").trim();
    const poolIpAddress = String(formData.get("poolIpAddress") ?? "").trim();
    const networkMode = normalizeNetworkMode(
      String(formData.get("networkMode") ?? "dhcp"),
    );
    const ipv4Cidr = String(formData.get("ipv4Cidr") ?? "").trim();
    const gateway = String(formData.get("gateway") ?? "").trim();
    const nameserver = String(formData.get("nameserver") ?? "").trim();
    const envText = String(formData.get("envText") ?? "");
    const localSshMode = String(formData.get("localSshMode") ?? "").trim();
    const localSshPublicKey = String(formData.get("localSshPublicKey") ?? "");
    const localSshLoginUser = String(formData.get("localSshLoginUser") ?? "").trim() || "root";
    if (!POSIX_USERNAME_REGEX.test(localSshLoginUser)) {
      return {
        message: "SSH login user must be a valid POSIX username (lowercase, 1-32 chars, starts with letter or underscore).",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    if (!node || !vmid || !ostemplate || !hostname || !rootfsStorage || !rootfsSize) {
      return {
        message: "Node, VMID, template, hostname, rootfs storage, and rootfs size are required.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    validateField(node, NODE_REGEX, "node");
    validateField(vmid, VMID_REGEX, "VMID");
    validateField(rootfsStorage, STORAGE_REGEX, "storage");
    if (hostname) validateField(hostname, HOSTNAME_REGEX, "hostname");
    await assertUniqueDeploymentHostname(hostname);

    let effectiveBridge = bridge;
    let normalizedIpv4Cidr =
      networkMode === "static" ? validateIpv4Cidr(ipv4Cidr) : "";
    let normalizedGateway = gateway ? validateIpv4Address(gateway, "gateway") : "";
    let normalizedNameserver = nameserver
      ? normalizeNameserverList(nameserver)
      : "";
    let poolTagSlug: string | null = null;

    if (networkMode === "static" && ipPoolId) {
      const poolSelection = await resolveIpPoolSelection(ipPoolId, poolIpAddress);
      effectiveBridge = poolSelection.bridge;
      normalizedIpv4Cidr = poolSelection.ipv4Cidr;
      normalizedGateway = poolSelection.gateway;
      normalizedNameserver = poolSelection.nameserver;
      poolTagSlug = poolSelection.tagSlug;
    }

    if (effectiveBridge) validateField(effectiveBridge, BRIDGE_REGEX, "bridge");

    if (networkMode === "static" && !effectiveBridge) {
      throw new Error("Bridge is required when using static networking.");
    }

    if (!password || password.length < 8) {
      return {
        message: "A root password of at least 8 characters is required.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const params = new URLSearchParams();
    params.set("vmid", vmid);
    params.set("ostemplate", ostemplate);
    params.set("hostname", hostname);
    params.set("rootfs", `${rootfsStorage}:${rootfsSize}`);
    params.set("memory", memory || "512");
    params.set("cores", cores || "2");
    params.set("password", password);
    params.set("swap", "512");
    params.set("unprivileged", formData.get("unprivileged") ? "1" : "0");
    params.set("onboot", formData.get("onboot") ? "1" : "0");

    if (effectiveBridge) {
      params.set(
        "net0",
        buildContainerNetworkConfig({
          bridge: effectiveBridge,
          gateway: normalizedGateway,
          ipv4Cidr: normalizedIpv4Cidr,
          mode: networkMode,
        }),
      );
    }

    if (normalizedNameserver) {
      params.set("nameserver", normalizedNameserver);
    }

    if (poolTagSlug) {
      params.set("tags", buildTagsWithTag("", poolTagSlug));
    }

    const deploymentTemplateId = String(formData.get("deploymentTemplateId") ?? "").trim();
    const deploymentTemplateName = String(formData.get("deploymentTemplateName") ?? "").trim();
    const deploymentTemplateVersion = String(formData.get("deploymentTemplateVersion") ?? "").trim();
    const localSshKey = await buildProvisionedDeploymentSshKey({
      deploymentLabel: hostname || deploymentTemplateName || `ct-${vmid}`,
      loginUser: localSshLoginUser,
      mode: localSshMode,
      publicKey: localSshPublicKey,
    });

    if (localSshKey) {
      params.set("ssh-public-keys", localSshKey.publicKey);
    }

    const imageInfo = await getTemplateFileInfo(node, ostemplate).catch(() => null);

    const meta: TainerMeta = {
      templateId: deploymentTemplateId || "",
      templateName: deploymentTemplateName || hostname,
      deployedAt: new Date().toISOString(),
      templateVersion: deploymentTemplateVersion || "",
      imageVolid: ostemplate,
      imageSize: imageInfo?.size,
      imageCtime: imageInfo?.ctime,
      localSsh: localSshKey
        ? {
            createdAt: localSshKey.createdAt,
            fingerprint: localSshKey.fingerprint,
            loginUser: localSshKey.loginUser,
            mode: localSshKey.mode,
          }
        : undefined,
    };
    params.set("description", buildDescription("", meta));

    const upid = await createContainer(node, params);
    const deploymentId = encodeDeploymentId(node, Number(vmid), "lxc");

    recordDeploymentActivity({
      action: "created",
      deploymentId,
      message: `Created CT ${vmid} (${hostname || "no hostname"})`,
      userEmail: session.user.email,
      userName: session.user.name,
      vmid: Number(vmid),
    }).catch(() => {});

    if (localSshKey?.mode === "generated") {
      await saveGeneratedDeploymentSshKey({
        deploymentId,
        fileStem: hostname || deploymentTemplateName || `ct-${vmid}`,
        key: localSshKey,
      });
    }

    const shouldStart = formData.get("start");
    const hasEnv = envText.trim();
    const hasFollowUpWork = Boolean(hasEnv || shouldStart);

    waitForTask(node, upid)
      .then(async () => {
        try {
          const imageEnv = await getContainerEnvText(node, Number(vmid));

          if (imageEnv.trim()) {
            await saveImageEnv(ostemplate, imageEnv, {
              aliases: [ostemplate.split("/").at(-1) ?? ""],
            }).catch((error) => {
              console.error(`Failed to cache image env for ${ostemplate}:`, error);
            });
          }

          const merged = hasEnv ? mergeEnvText(imageEnv, envText) : imageEnv;

          if (merged.trim()) {
            const updateParams = new URLSearchParams();
            updateParams.set("env", envTextToString(merged));
            await updateContainerConfig(node, Number(vmid), updateParams);
          }
        } catch (error) {
          console.error(`Post-create env setup failed for VMID ${vmid}:`, error);
        }
      })
      .then(async () => {
        if (shouldStart) {
          await runContainerLifecycleAction(node, Number(vmid), "start");
        }
      })
      .then(async () => {
        if (shouldStart) {
          try {
            const { runNodeRootCommand } = await import("@/lib/proxmox-host");

            await new Promise((r) => setTimeout(r, 5000));

            await runNodeRootCommand(
              node,
              `pct exec ${Number(vmid)} -- sh -c "if command -v apt-get >/dev/null 2>&1; then DEBIAN_FRONTEND=noninteractive apt-get update -qq && apt-get install -y -qq debsecan 2>/dev/null; fi"`,
              { timeoutMs: 60_000 },
            );
            console.log(`[post-create] Installed debsecan in CT ${vmid}`);
          } catch (error) {
            console.error(`[post-create] debsecan install in CT ${vmid} failed:`, error instanceof Error ? error.message : error);
          }
        }
      })
      .catch((error) => {
        console.error(`Post-create actions failed for VMID ${vmid}:`, error);
      });

    revalidatePath(`/sites/${siteSlug}`);
    revalidatePath(`/sites/${siteSlug}/templates`);
    revalidatePath(`/sites/${siteSlug}/deployments`);
    revalidateTag("deployments-page-data", "max");
    revalidateTag("home-page-data", "max");

    return {
      message: `Container creation task submitted for VMID ${vmid}.`,
      requestId: randomUUID(),
      status: "success",
      task: {
        node,
        siteSlug,
        submittedMessage: `Queued container creation for VMID ${vmid}.`,
        successHref: `/sites/${siteSlug}/deployments/${deploymentId}`,
        successMessage: hasFollowUpWork
          ? `Container ${vmid} finished creating in Proxmox. Any queued post-create steps will continue in the background.`
          : `Container ${vmid} finished creating in Proxmox.`,
        title: `Creating CT ${vmid}`,
        upid,
      },
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to create container.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function updateContainerEnvAction(
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
    const digest = String(formData.get("digest") ?? "").trim();
    const envText = String(formData.get("envText") ?? "");

    if (!deploymentId) {
      return {
        message: "Missing deployment reference.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const { node, vmid } = decodeDeploymentId(deploymentId);
    const params = new URLSearchParams();

    if (digest) {
      params.set("digest", digest);
    }

    if (envText.trim()) {
      params.set("env", envTextToString(envText));
    } else {
      params.set("delete", "env");
    }

    const upid = await updateContainerConfig(node, vmid, params);

    recordDeploymentActivity({
      action: "env-updated",
      deploymentId,
      message: `Updated environment variables for CT ${vmid}`,
      userEmail: session.user.email,
      userName: session.user.name,
      vmid,
    }).catch(() => {});

    revalidatePath(`/sites/${siteSlug}`);
    revalidatePath(`/sites/${siteSlug}/deployments`);
    revalidateTag("deployments-page-data", "max");
    revalidateTag("home-page-data", "max");
    revalidatePath(`/sites/${siteSlug}/deployments/${deploymentId}`);

    return {
      message: `Environment update submitted for VMID ${vmid}.`,
      requestId: randomUUID(),
      status: "success",
      task: {
        node,
        siteSlug,
        submittedMessage: `Queued env update for VMID ${vmid}.`,
        successMessage: `Environment variables updated for VMID ${vmid}.`,
        title: `Updating env for CT ${vmid}`,
        upid,
      },
    };

    });
  } catch (error) {
    return {
      message:
        error instanceof Error ? error.message : "Failed to update environment variables.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

const HOSTNAME_EDIT_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,61}[a-zA-Z0-9])?$/;
const VM_NAME_EDIT_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{0,62}$/;
const CPU_TYPE_EDIT_REGEX = /^[a-zA-Z0-9_.\-,=+]{1,64}$/;
const MACHINE_EDIT_REGEX = /^[a-zA-Z0-9_.\-+]{1,32}$/;
const SCSIHW_EDIT_VALUES = new Set([
  "lsi",
  "lsi53c810",
  "virtio-scsi-pci",
  "virtio-scsi-single",
  "megasas",
  "pvscsi",
]);
const VGA_EDIT_REGEX = /^[a-zA-Z0-9_,=+-]{1,64}$/;

export async function updateDeploymentConfigAction(
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
    const digest = String(formData.get("digest") ?? "").trim();

    if (!deploymentId) {
      return {
        message: "Missing deployment reference.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const { node, vmid, type } = decodeDeploymentId(deploymentId);

    const parsePositiveInt = (value: string, label: string, min: number, max: number) => {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        throw new Error(`Invalid ${label}: must be an integer between ${min} and ${max}.`);
      }
      return parsed;
    };

    const getString = (key: string) => {
      const raw = formData.get(key);
      if (raw === null || raw === undefined) return "";
      return String(raw);
    };

    const cores = parsePositiveInt(getString("cores"), "CPU cores", 1, 256);
    const memoryMb = parsePositiveInt(getString("memoryMb"), "memory (MB)", 16, 1_048_576);
    const hostnameRaw = getString("hostname").trim();
    const descriptionRaw = getString("description");
    const descriptionProvided = formData.has("description");
    const hostnameProvided = formData.has("hostname");

    const params = new URLSearchParams();
    if (digest) {
      params.set("digest", digest);
    }

    const changedFields: string[] = [];

    if (cores !== null) {
      params.set("cores", String(cores));
      changedFields.push(`cores=${cores}`);
    }
    if (memoryMb !== null) {
      params.set("memory", String(memoryMb));
      changedFields.push(`memory=${memoryMb}MB`);
    }

    if (hostnameProvided && hostnameRaw) {
      const regex = type === "qemu" ? VM_NAME_EDIT_REGEX : HOSTNAME_EDIT_REGEX;
      if (!regex.test(hostnameRaw)) {
        throw new Error(
          type === "qemu"
            ? "Invalid VM name: use alphanumerics, dot, dash, or underscore."
            : "Invalid hostname: must be a valid DNS label.",
        );
      }
      if (type === "qemu") {
        params.set("name", hostnameRaw);
      } else {
        params.set("hostname", hostnameRaw);
      }
      changedFields.push(`name=${hostnameRaw}`);
    }

    if (descriptionProvided) {
      const detail = await getDeploymentDetail(deploymentId);
      const meta = detail?.tainerMeta ?? null;
      const cleanUserText = descriptionRaw.replace(/\r\n/g, "\n");
      const finalDescription = meta
        ? buildDescription(cleanUserText, meta)
        : cleanUserText.trim();
      if (finalDescription) {
        params.set("description", finalDescription);
      } else {
        params.set("delete", "description");
      }
      changedFields.push("description");
    }

    if (type === "lxc") {
      const swapMb = parsePositiveInt(getString("swapMb"), "swap (MB)", 0, 1_048_576);
      if (swapMb !== null) {
        params.set("swap", String(swapMb));
        changedFields.push(`swap=${swapMb}MB`);
      }
    } else {
      const sockets = parsePositiveInt(getString("sockets"), "CPU sockets", 1, 16);
      if (sockets !== null) {
        params.set("sockets", String(sockets));
        changedFields.push(`sockets=${sockets}`);
      }
      const cpuType = getString("cpuType").trim();
      if (formData.has("cpuType") && cpuType) {
        if (!CPU_TYPE_EDIT_REGEX.test(cpuType)) {
          throw new Error("Invalid CPU type value.");
        }
        params.set("cpu", cpuType);
        changedFields.push(`cpu=${cpuType}`);
      }
      const machine = getString("machine").trim();
      if (formData.has("machine") && machine) {
        if (!MACHINE_EDIT_REGEX.test(machine)) {
          throw new Error("Invalid machine type value.");
        }
        params.set("machine", machine);
        changedFields.push(`machine=${machine}`);
      }
      const scsihw = getString("scsihw").trim();
      if (formData.has("scsihw") && scsihw) {
        if (!SCSIHW_EDIT_VALUES.has(scsihw)) {
          throw new Error("Invalid SCSI controller selection.");
        }
        params.set("scsihw", scsihw);
        changedFields.push(`scsihw=${scsihw}`);
      }
      const vga = getString("vga").trim();
      if (formData.has("vga") && vga) {
        if (!VGA_EDIT_REGEX.test(vga)) {
          throw new Error("Invalid VGA value.");
        }
        params.set("vga", vga);
        changedFields.push(`vga=${vga}`);
      }
    }

    if (changedFields.length === 0) {
      return {
        message: "No changes to apply.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const upid = type === "qemu"
      ? await updateVmConfig(node, vmid, params)
      : await updateContainerConfig(node, vmid, params);

    const guestLabel = type === "qemu" ? "VM" : "CT";

    recordDeploymentActivity({
      action: "resources-updated",
      deploymentId,
      message: `Updated ${guestLabel} ${vmid} (${changedFields.join(", ")})`,
      userEmail: session.user.email,
      userName: session.user.name,
      vmid,
    }).catch(() => {});

    revalidatePath(`/sites/${siteSlug}`);
    revalidatePath(`/sites/${siteSlug}/deployments`);
    revalidateTag("deployments-page-data", "max");
    revalidateTag("home-page-data", "max");
    revalidatePath(`/sites/${siteSlug}/deployments/${deploymentId}`);

    return {
      message: `Update submitted for ${guestLabel} ${vmid}.`,
      requestId: randomUUID(),
      status: "success",
      task: {
        node,
        siteSlug,
        submittedMessage: `Queued config update for ${guestLabel} ${vmid}.`,
        successMessage: `Configuration updated for ${guestLabel} ${vmid}.`,
        title: `Updating ${guestLabel} ${vmid}`,
        upid,
      },
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to update deployment.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function runDeploymentLifecycleAction(
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
    const command = String(formData.get("command") ?? "").trim() as ContainerLifecycleAction;

    if (!deploymentId) {
      return {
        message: "Missing deployment reference.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    if (!(command in DEPLOYMENT_ACTION_META)) {
      return {
        message: "Unsupported deployment action.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const { node, vmid } = decodeDeploymentId(deploymentId);
    const meta = DEPLOYMENT_ACTION_META[command];
    const upid = await runContainerLifecycleAction(node, vmid, command);

    recordDeploymentActivity({
      action: command,
      deploymentId,
      message: `${meta.success} CT ${vmid}`,
      userEmail: session.user.email,
      userName: session.user.name,
      vmid,
    }).catch(() => {});

    revalidatePath(`/sites/${siteSlug}`);
    revalidatePath(`/sites/${siteSlug}/deployments`);
    revalidateTag("deployments-page-data", "max");
    revalidateTag("home-page-data", "max");
    revalidatePath(`/sites/${siteSlug}/deployments/${deploymentId}`);

    return {
      message: `${meta.present} task submitted for VMID ${vmid}.`,
      requestId: randomUUID(),
      status: "success",
      task: {
        node,
        siteSlug,
        submittedMessage: `${meta.submitted} for CT ${vmid}.`,
        successMessage: `${meta.success} CT ${vmid}.`,
        title: `${meta.present} CT ${vmid}`,
        upid,
      },
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to run deployment action.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function importUpstreamTemplateAction(
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
    requireSitePermission(session, siteConfig.siteId, "manage-templates");
    return await withSiteConfig(siteConfig, async () => {

    const node = String(formData.get("node") ?? "").trim();
    const storage = String(formData.get("storage") ?? "").trim();
    const filename = String(formData.get("filename") ?? "").trim();
    const url = await assertSafeDownloadUrl(String(formData.get("url") ?? "").trim());

    if (!node || !storage || !filename || !url) {
      return {
        message: "Node, storage, filename, and source URL are required.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    validateField(node, NODE_REGEX, "node");
    validateField(storage, STORAGE_REGEX, "storage");

    const params = new URLSearchParams();
    params.set("content", "vztmpl");
    params.set("filename", filename);
    params.set("url", url);

    const upid = await importTemplateFromUrl(node, storage, params);

    revalidatePath(`/sites/${siteSlug}`);
    revalidatePath(`/sites/${siteSlug}/templates`);

    return {
      message: `Template download submitted for ${filename} into ${storage}.`,
      requestId: randomUUID(),
      status: "success",
      task: {
        node,
        siteSlug,
        submittedMessage: `Queued template download for ${filename}.`,
        successMessage: `Imported ${filename} into ${storage}.`,
        title: `Importing ${filename}`,
        upid,
      },
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to import template.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function deleteDeploymentAction(
  _previousState: ProxmoxActionState,
  formData: FormData,
): Promise<ProxmoxActionState> {
  try {
    const session = await requireSession();
    checkOperationRateLimit(session.user.id);

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "delete-deployments");
    return await withSiteConfig(siteConfig, async () => {

    const deploymentId = String(formData.get("deploymentId") ?? "").trim();

    if (!deploymentId) {
      return {
        message: "Missing deployment reference.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const { node, vmid } = decodeDeploymentId(deploymentId);
    const upid = await deleteContainer(node, vmid);

    recordDeploymentActivity({
      action: "deleted",
      deploymentId,
      message: `Deleted CT ${vmid}`,
      userEmail: session.user.email,
      userName: session.user.name,
      vmid,
    }).catch(() => {});
    clearDeploymentActivities(deploymentId).catch(() => {});

    revalidatePath(`/sites/${siteSlug}`);
    revalidatePath(`/sites/${siteSlug}/deployments`);
    revalidateTag("deployments-page-data", "max");
    revalidateTag("home-page-data", "max");

    return {
      message: `Delete task submitted for VMID ${vmid}.`,
      requestId: randomUUID(),
      status: "success",
      task: {
        node,
        siteSlug,
        submittedMessage: `Queued deletion for CT ${vmid}.`,
        successMessage: `Deleted CT ${vmid}.`,
        title: `Deleting CT ${vmid}`,
        upid,
      },
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to delete container.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function migrateDeploymentAction(
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
    const target = String(formData.get("target") ?? "").trim();

    if (!deploymentId || !target) {
      return {
        message: "Missing deployment reference or target node.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    if (!NODE_REGEX.test(target)) {
      return {
        message: "Invalid target node format.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const { node, vmid } = decodeDeploymentId(deploymentId);

    if (target === node) {
      return {
        message: `Container is already on ${node}.`,
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const upid = await migrateContainer(node, vmid, target);

    recordDeploymentActivity({
      action: "migrated",
      deploymentId,
      message: `Migrated CT ${vmid} from ${node} to ${target}`,
      userEmail: session.user.email,
      userName: session.user.name,
      vmid,
    }).catch(() => {});

    revalidatePath(`/sites/${siteSlug}`);
    revalidatePath(`/sites/${siteSlug}/deployments`);
    revalidateTag("deployments-page-data", "max");
    revalidateTag("home-page-data", "max");
    revalidatePath(`/sites/${siteSlug}/deployments/${deploymentId}`);

    return {
      message: `Migration submitted for VMID ${vmid} from ${node} to ${target}.`,
      requestId: randomUUID(),
      status: "success",
      task: {
        node,
        siteSlug,
        submittedMessage: `Queued migration of CT ${vmid} to ${target}.`,
        successMessage: `Migrated CT ${vmid} to ${target}.`,
        title: `Migrating CT ${vmid} → ${target}`,
        upid,
      },
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to migrate container.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function recreateFromTemplateAction(
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
    requireSitePermission(session, siteConfig.siteId, "delete-deployments");
    return await withSiteConfig(siteConfig, async () => {

    const deploymentId = String(formData.get("deploymentId") ?? "").trim();
    const templateId = String(formData.get("templateId") ?? "").trim();
    const password = String(formData.get("password") ?? "").trim();

    if (!deploymentId || !templateId || !password) {
      return {
        message: "Deployment ID, template ID, and root password are required.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    if (password.length < 8) {
      return {
        message: "Root password must be at least 8 characters.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const { node, vmid } = decodeDeploymentId(deploymentId);

    const template = await getDeploymentTemplate(templateId);
    if (!template) {
      return {
        message: "Deployment template no longer exists.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const detail = await getDeploymentDetail(deploymentId);
    if (!detail) {
      return {
        message: "Container not found.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const wasRunning = detail.rawStatus === "running";

    if (wasRunning) {
      const stopUpid = await runContainerLifecycleAction(node, vmid, "stop");
      await waitForTask(node, stopUpid);
    }

    const deleteUpid = await deleteContainer(node, vmid);
    await waitForTask(node, deleteUpid);

    const params = new URLSearchParams();
    params.set("vmid", String(vmid));
    params.set("ostemplate", template.sourceVolid);
    params.set("hostname", detail.name);
    params.set("rootfs", detail.rootfs !== "Unavailable" ? detail.rootfs : `${template.rootfsStorage}:${template.rootfsSize}`);
    params.set("memory", template.memory);
    params.set("cores", template.cores);
    params.set("password", password);
    params.set("swap", "512");
    params.set("unprivileged", template.unprivileged ? "1" : "0");
    params.set("onboot", template.onboot ? "1" : "0");

    if (template.bridge) {
      params.set("net0", `name=eth0,bridge=${template.bridge},ip=dhcp`);
    }

    const meta: TainerMeta = {
      templateId: template.id,
      templateName: template.name,
      deployedAt: new Date().toISOString(),
      templateVersion: template.updatedAt,
    };
    const userDescription = stripTainerMeta(detail.description);
    params.set("description", buildDescription(userDescription, meta));

    const createUpid = await createContainer(node, params);

    waitForTask(node, createUpid)
      .then(async () => {
        try {
          if (detail.envText.trim()) {
            const updateParams = new URLSearchParams();
            updateParams.set("env", envTextToString(detail.envText));
            await updateContainerConfig(node, vmid, updateParams);
          }
        } catch (error) {
          console.error(`Post-recreate env restore failed for VMID ${vmid}:`, error);
        }
      })
      .then(async () => {
        if (wasRunning) {
          await runContainerLifecycleAction(node, vmid, "start");
        }
      })
      .catch((error) => {
        console.error(`Post-recreate actions failed for VMID ${vmid}:`, error);
      });

    revalidatePath(`/sites/${siteSlug}`);
    revalidatePath(`/sites/${siteSlug}/deployments`);
    revalidateTag("deployments-page-data", "max");
    revalidateTag("home-page-data", "max");
    revalidatePath(`/sites/${siteSlug}/deployments/${deploymentId}`);

    return {
      message: `Recreating CT ${vmid} from latest template "${template.name}".`,
      requestId: randomUUID(),
      status: "success",
      task: {
        node,
        siteSlug,
        submittedMessage: `Recreating CT ${vmid} from latest template.`,
        successHref: `/sites/${siteSlug}/deployments/${deploymentId}`,
        successMessage: `CT ${vmid} recreated from latest "${template.name}". Any queued restore/start steps will continue in the background.`,
        title: `Recreating CT ${vmid}`,
        upid: createUpid,
      },
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to recreate container.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}
