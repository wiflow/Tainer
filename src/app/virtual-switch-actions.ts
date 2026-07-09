"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";

import type { BasicActionState } from "@/lib/action-states";
import { requireSession, requireSitePermission } from "@/lib/auth";
import { recordDeploymentActivity } from "@/lib/deployment-activity-log";
import { parseNetSpec } from "@/lib/lldp-deployment-path";
import {
  decodeDeploymentId,
  getDeploymentNetSpecs,
  updateContainerConfig,
  updateVmConfig,
  withSiteConfig,
} from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

function errorState(message: string): BasicActionState {
  return { message, requestId: randomUUID(), status: "error" };
}

/**
 * Rebuild a `netN` spec string with a set of key overrides. Existing keys not
 * being changed (ip, gw, hwaddr, mtu, trunks, …) are preserved verbatim and
 * in their original order; an override of `null` deletes the key.
 */
function rebuildNetSpec(
  rawSpec: string,
  overrides: Record<string, string | null>,
): string {
  const spec = parseNetSpec(rawSpec);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      delete spec[key];
    } else {
      spec[key] = value;
    }
  }
  return Object.entries(spec)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

/**
 * Update switching-level settings on a single guest NIC: link up/down, VLAN
 * tag, rate limit, and the Proxmox firewall flag. Applies live to running
 * guests (Proxmox hot-applies `netN` config on both LXC and QEMU). The
 * bridge, MAC, and IP configuration are deliberately not editable here —
 * moving a port to another bridge belongs in the deployment's own settings
 * where IP implications are visible.
 */
export async function updateDeploymentNicAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();

    const siteSlug = String(formData.get("siteSlug") ?? "").trim();
    if (!siteSlug) return errorState("Missing site context.");
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-deployments");

    const deploymentId = String(formData.get("deploymentId") ?? "").trim();
    const netKey = String(formData.get("netKey") ?? "").trim();
    if (!deploymentId) return errorState("Missing deployment reference.");
    if (!/^net\d+$/.test(netKey)) return errorState("Invalid network interface key.");

    const overrides: Record<string, string | null> = {};
    const changedFields: string[] = [];

    if (formData.has("linkDown")) {
      const linkDown = String(formData.get("linkDown")) === "1";
      overrides.link_down = linkDown ? "1" : null;
      changedFields.push(linkDown ? "link down" : "link up");
    }

    if (formData.has("vlanTag")) {
      const raw = String(formData.get("vlanTag") ?? "").trim();
      if (!raw) {
        overrides.tag = null;
        changedFields.push("VLAN cleared");
      } else {
        const tag = Number.parseInt(raw, 10);
        if (!Number.isInteger(tag) || tag < 1 || tag > 4094 || String(tag) !== raw) {
          return errorState("Invalid VLAN tag: must be an integer between 1 and 4094.");
        }
        overrides.tag = String(tag);
        changedFields.push(`VLAN ${tag}`);
      }
    }

    if (formData.has("rateMbps")) {
      const raw = String(formData.get("rateMbps") ?? "").trim();
      if (!raw) {
        overrides.rate = null;
        changedFields.push("rate limit cleared");
      } else {
        const rate = Number.parseFloat(raw);
        if (!Number.isFinite(rate) || rate <= 0 || rate > 100_000) {
          return errorState("Invalid rate limit: must be a positive number (MB/s).");
        }
        overrides.rate = String(rate);
        changedFields.push(`rate ${rate} MB/s`);
      }
    }

    if (formData.has("firewall")) {
      const firewall = String(formData.get("firewall")) === "1";
      overrides.firewall = firewall ? "1" : null;
      changedFields.push(firewall ? "firewall on" : "firewall off");
    }

    if (changedFields.length === 0) return errorState("No changes to apply.");

    return await withSiteConfig(siteConfig, async () => {
      const { node, vmid, type } = decodeDeploymentId(deploymentId);

      // Re-read the current spec at apply time so unrelated keys (ip, gw,
      // hwaddr, mtu, …) survive even if the view was stale.
      const current = await getDeploymentNetSpecs(deploymentId);
      const rawSpec = current?.specs[netKey];
      if (!rawSpec) {
        return errorState(`Interface ${netKey} no longer exists on this deployment.`);
      }

      const nextSpec = rebuildNetSpec(rawSpec, overrides);
      const params = new URLSearchParams();
      params.set(netKey, nextSpec);

      if (type === "qemu") {
        await updateVmConfig(node, vmid, params);
      } else {
        await updateContainerConfig(node, vmid, params);
      }

      const guestLabel = type === "qemu" ? "VM" : "CT";
      recordDeploymentActivity({
        action: "network-updated",
        deploymentId,
        message: `Updated ${guestLabel} ${vmid} ${netKey} (${changedFields.join(", ")})`,
        userEmail: session.user.email,
        userName: session.user.name,
        vmid,
      }).catch(() => {});

      revalidatePath(`/sites/${siteSlug}/network`);
      revalidatePath(`/sites/${siteSlug}/deployments/${deploymentId}`);
      revalidateTag("virtual-switching", "max");
      revalidateTag("deployments-page-data", "max");

      return {
        message: `${guestLabel} ${vmid} ${netKey}: ${changedFields.join(", ")}.`,
        requestId: randomUUID(),
        status: "success",
      };
    });
  } catch (error) {
    return errorState(
      error instanceof Error ? error.message : "Failed to update network interface.",
    );
  }
}
