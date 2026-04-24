"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath, revalidateTag } from "next/cache";

import type { ProxmoxActionState } from "@/lib/action-states";
import { requirePermission, requireSession, requireSitePermission } from "@/lib/auth";
import { createRateLimiterOrThrow } from "@/lib/rate-limit";

const enforceRateLimit = createRateLimiterOrThrow("vm-actions", 10, 5 * 60_000);
import {
  buildDescription,
  type TainerMeta,
} from "@/lib/tainer-meta";
import {
  createVm,
  decodeDeploymentId,
  encodeDeploymentId,
  deleteVm,
  migrateVm,
  runVmLifecycleAction,
  type VmLifecycleAction,
  waitForTask,
  withSiteConfig,
} from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import {
  clearDeploymentActivities,
  recordDeploymentActivity,
} from "@/lib/deployment-activity-log";
import { getVmTemplate } from "@/lib/vm-templates";

const NODE_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,61}[a-zA-Z0-9])?$/;
const STORAGE_REGEX = /^[a-zA-Z0-9._-]{1,63}$/;
const VMID_REGEX = /^\d{1,9}$/;
const BRIDGE_REGEX = /^[a-zA-Z0-9._-]{1,32}$/;
const POSITIVE_INTEGER_REGEX = /^\d+$/;
const VOLID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9/:._-]*$/;

const ALLOWED_CPU_TYPES = new Set([
  "host",
  "kvm64",
  "qemu64",
  "x86-64-v2",
  "x86-64-v2-AES",
  "x86-64-v3",
  "x86-64-v4",
]);
const ALLOWED_OS_TYPES = new Set([
  "l24",
  "l26",
  "other",
  "solaris",
  "win10",
  "win11",
  "win7",
  "win8",
  "wxp",
]);
const ALLOWED_MACHINE_TYPES = new Set(["i440fx", "q35"]);
const ALLOWED_SCSI_CONTROLLERS = new Set([
  "lsi",
  "lsi53c810",
  "megasas",
  "pvscsi",
  "virtio-scsi-pci",
  "virtio-scsi-single",
]);
const ALLOWED_VGA_TYPES = new Set([
  "cirrus",
  "none",
  "qxl",
  "serial0",
  "std",
  "virtio",
  "virtio-gl",
  "vmware",
]);

function validateField(value: string, regex: RegExp, label: string): string {
  if (!regex.test(value)) {
    throw new Error(`Invalid ${label} format.`);
  }

  return value;
}

function validateOption(value: string, allowed: Set<string>, label: string): string {
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}.`);
  }

  return value;
}

const VM_ACTION_META: Record<
  VmLifecycleAction,
  {
    present: string;
    past: string;
    submitted: string;
    success: string;
  }
> = {
  reset: {
    past: "reset",
    present: "Resetting",
    submitted: "Queued reset",
    success: "Reset",
  },
  restart: {
    past: "restarted",
    present: "Restarting",
    submitted: "Queued restart",
    success: "Restarted",
  },
  resume: {
    past: "resumed",
    present: "Resuming",
    submitted: "Queued resume",
    success: "Resumed",
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
  suspend: {
    past: "suspended",
    present: "Suspending",
    submitted: "Queued suspend",
    success: "Suspended",
  },
};

export async function createVmAction(
  _previousState: ProxmoxActionState,
  formData: FormData,
): Promise<ProxmoxActionState> {
  try {
    const session = await requireSession();
    enforceRateLimit(session.user.id);

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "create-deployments");
    return withSiteConfig(siteConfig, async () => {

    const node = String(formData.get("node") ?? "").trim();
    const vmid = String(formData.get("vmid") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const isoVolid = String(formData.get("isoVolid") ?? "").trim();
    const diskStorage = String(formData.get("diskStorage") ?? "").trim();
    const diskSize = String(formData.get("diskSize") ?? "").trim();
    const memory = String(formData.get("memory") ?? "").trim();
    const cores = String(formData.get("cores") ?? "").trim();
    const sockets = String(formData.get("sockets") ?? "").trim();
    const cpuType = String(formData.get("cpuType") ?? "").trim();
    const bridge = String(formData.get("bridge") ?? "").trim();
    const osType = String(formData.get("osType") ?? "").trim();
    const machineType = String(formData.get("machineType") ?? "").trim();
    const scsihw = String(formData.get("scsihw") ?? "").trim();
    const vgaType = String(formData.get("vgaType") ?? "").trim();
    const vmTemplateId = String(formData.get("vmTemplateId") ?? "").trim();
    const localSshMode = String(formData.get("localSshMode") ?? "").trim();
    const vmTemplate = vmTemplateId ? await getVmTemplate(vmTemplateId) : null;

    if (!node || !vmid || !name || !diskStorage || !diskSize) {
      return {
        message: "Node, VMID, name, disk storage, and disk size are required.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const resolvedCpuType = validateOption(
      cpuType || "x86-64-v2-AES",
      ALLOWED_CPU_TYPES,
      "CPU type",
    );
    const resolvedOsType = validateOption(osType || "l26", ALLOWED_OS_TYPES, "OS type");
    const resolvedMachineType = validateOption(
      machineType || "q35",
      ALLOWED_MACHINE_TYPES,
      "machine type",
    );
    const resolvedScsiHw = validateOption(
      scsihw || "virtio-scsi-single",
      ALLOWED_SCSI_CONTROLLERS,
      "SCSI controller",
    );
    const resolvedVgaType = validateOption(vgaType || "std", ALLOWED_VGA_TYPES, "VGA type");
    const resolvedMemory = validateField(memory || "2048", POSITIVE_INTEGER_REGEX, "memory");
    const resolvedCores = validateField(cores || "2", POSITIVE_INTEGER_REGEX, "cores");
    const resolvedSockets = validateField(sockets || "1", POSITIVE_INTEGER_REGEX, "sockets");

    validateField(node, NODE_REGEX, "node");
    validateField(vmid, VMID_REGEX, "VMID");
    validateField(diskStorage, STORAGE_REGEX, "disk storage");
    validateField(diskSize, POSITIVE_INTEGER_REGEX, "disk size");
    if (bridge) validateField(bridge, BRIDGE_REGEX, "bridge");
    if (isoVolid) validateField(isoVolid, VOLID_REGEX, "ISO image");

    if (localSshMode && localSshMode !== "none") {
      return {
        message: "Verified local SSH provisioning is not available for VM creation yet. Use the Proxmox console or configure SSH inside the guest after install.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const params = new URLSearchParams();
    params.set("vmid", vmid);
    params.set("name", name);
    params.set("memory", resolvedMemory);
    params.set("cores", resolvedCores);
    params.set("sockets", resolvedSockets);
    params.set("cpu", resolvedCpuType);
    params.set("ostype", resolvedOsType);
    params.set("machine", resolvedMachineType);
    params.set("scsihw", resolvedScsiHw);
    params.set("scsi0", `${diskStorage}:${diskSize}`);
    params.set("boot", isoVolid
      ? "order=ide0;scsi0;net0"
      : "order=scsi0;net0");
    params.set("vga", resolvedVgaType);
    // Always enable the QEMU guest agent — required for CVE scanning
    // and other guest management features.
    params.set("agent", "1");
    params.set("onboot", formData.get("onboot") ? "1" : "0");

    if (isoVolid) {
      params.set("ide2", `${isoVolid},media=cdrom`);
    }

    if (bridge) {
      params.set("net0", `virtio,bridge=${bridge}`);
    }

    const meta: TainerMeta = {
      deployedAt: new Date().toISOString(),
      templateId: vmTemplate?.id ?? "",
      templateName: vmTemplate?.name ?? name,
      templateVersion: vmTemplate?.updatedAt ?? "",
    };
    params.set("description", buildDescription("", meta));

    const upid = await createVm(node, params);
    const deploymentId = encodeDeploymentId(node, Number(vmid), "qemu");

    const shouldStart = formData.get("start");

    if (shouldStart) {
      waitForTask(node, upid)
        .then(async () => {
          await runVmLifecycleAction(node, Number(vmid), "start");
        })
        .catch((error) => {
          console.error(`Post-create start failed for VM ${vmid}:`, error);
        });
    }

    revalidatePath(`/sites/${siteSlug}`);
    revalidatePath(`/sites/${siteSlug}/deployments`);
    revalidateTag("deployments-page-data", "max");
    revalidateTag("home-page-data", "max");

    return {
      message: `VM creation task submitted for VMID ${vmid}.`,
      requestId: randomUUID(),
      status: "success",
      task: {
        node,
        siteSlug,
        submittedMessage: `Queued VM creation for VMID ${vmid}.`,
        successHref: `/sites/${siteSlug}/deployments/${deploymentId}`,
        successMessage: `VM ${vmid} finished creating in Proxmox.`,
        title: `Creating VM ${vmid}`,
        upid,
      },
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to create VM.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function runVmLifecycleActionServer(
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
    return withSiteConfig(siteConfig, async () => {

    const deploymentId = String(formData.get("deploymentId") ?? "").trim();
    const command = String(formData.get("command") ?? "").trim() as VmLifecycleAction;

    if (!deploymentId) {
      return {
        message: "Missing deployment reference.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    if (!(command in VM_ACTION_META)) {
      return {
        message: "Unsupported VM action.",
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const { node, vmid } = decodeDeploymentId(deploymentId);
    const meta = VM_ACTION_META[command];
    const upid = await runVmLifecycleAction(node, vmid, command);

    recordDeploymentActivity({
      action: command as "start" | "stop" | "restart" | "shutdown",
      deploymentId,
      message: `${meta.success} VM ${vmid}`,
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
      message: `${meta.present} task submitted for VM ${vmid}.`,
      requestId: randomUUID(),
      status: "success",
      task: {
        node,
        siteSlug,
        submittedMessage: `${meta.submitted} for VM ${vmid}.`,
        successMessage: `${meta.success} VM ${vmid}.`,
        title: `${meta.present} VM ${vmid}`,
        upid,
      },
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to run VM action.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function deleteVmAction(
  _previousState: ProxmoxActionState,
  formData: FormData,
): Promise<ProxmoxActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-deployments");

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return withSiteConfig(siteConfig, async () => {

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
    const upid = await deleteVm(node, vmid);

    recordDeploymentActivity({
      action: "deleted",
      deploymentId,
      message: `Deleted VM ${vmid}`,
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
      message: `Delete task submitted for VM ${vmid}.`,
      requestId: randomUUID(),
      status: "success",
      task: {
        node,
        siteSlug,
        submittedMessage: `Queued deletion for VM ${vmid}.`,
        successMessage: `Deleted VM ${vmid}.`,
        title: `Deleting VM ${vmid}`,
        upid,
      },
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to delete VM.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}

export async function migrateVmAction(
  _previousState: ProxmoxActionState,
  formData: FormData,
): Promise<ProxmoxActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-deployments");

    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return { message: "Missing site context.", requestId: randomUUID(), status: "error", task: null };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return withSiteConfig(siteConfig, async () => {

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

    if (!/^[a-zA-Z0-9._-]{1,63}$/.test(target)) {
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
        message: `VM is already on ${node}.`,
        requestId: randomUUID(),
        status: "error",
        task: null,
      };
    }

    const upid = await migrateVm(node, vmid, target);

    recordDeploymentActivity({
      action: "migrated",
      deploymentId,
      message: `Migrated VM ${vmid} from ${node} to ${target}`,
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
      message: `Migration submitted for VM ${vmid} from ${node} to ${target}.`,
      requestId: randomUUID(),
      status: "success",
      task: {
        node,
        siteSlug,
        submittedMessage: `Queued migration of VM ${vmid} to ${target}.`,
        successMessage: `Migrated VM ${vmid} to ${target}.`,
        title: `Migrating VM ${vmid} → ${target}`,
        upid,
      },
    };

    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to migrate VM.",
      requestId: randomUUID(),
      status: "error",
      task: null,
    };
  }
}
