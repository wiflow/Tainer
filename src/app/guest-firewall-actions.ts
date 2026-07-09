"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import type { BasicActionState } from "@/lib/action-states";
import { requireSession, requireSitePermission } from "@/lib/auth";
import { recordDeploymentActivity } from "@/lib/deployment-activity-log";
import {
  createGuestFirewallRule,
  decodeDeploymentId,
  deleteGuestFirewallRule,
  setGuestFirewallEnabled,
  withSiteConfig,
} from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

function errorState(message: string): BasicActionState {
  return { message, requestId: randomUUID(), status: "error" };
}

// Conservative charsets for values that end up in Proxmox API params. The
// API validates semantics; these stop obviously hostile input early.
const PROTO_RX = /^[a-z0-9-]{1,20}$/;
const PORT_RX = /^\d{1,5}(:\d{1,5})?(,\d{1,5}(:\d{1,5})?)*$/;
const ADDR_RX = /^[0-9a-fA-F.:/,+-]{1,120}$/;
const COMMENT_RX = /^[\w .,:;@()\[\]/-]{0,120}$/;

type GuestRef = { siteSlug: string; deploymentId: string };

async function resolveGuest(formData: FormData): Promise<
  | { ok: true; ref: GuestRef; node: string; vmid: number; type: "lxc" | "qemu" }
  | { ok: false; state: BasicActionState }
> {
  const siteSlug = String(formData.get("siteSlug") ?? "").trim();
  const deploymentId = String(formData.get("deploymentId") ?? "").trim();
  if (!siteSlug) return { ok: false, state: errorState("Missing site context.") };
  if (!deploymentId) return { ok: false, state: errorState("Missing deployment reference.") };

  const session = await requireSession();
  const siteConfig = await resolveSiteConfigBySlug(siteSlug);
  requireSitePermission(session, siteConfig.siteId, "manage-security");

  const { node, vmid, type } = decodeDeploymentId(deploymentId);
  return { ok: true, ref: { siteSlug, deploymentId }, node, vmid, type };
}

async function recordAndRevalidate(
  ref: GuestRef,
  vmid: number,
  message: string,
) {
  const session = await requireSession();
  recordDeploymentActivity({
    action: "firewall-updated",
    deploymentId: ref.deploymentId,
    message,
    userEmail: session.user.email,
    userName: session.user.name,
    vmid,
  }).catch(() => {});
  revalidatePath(`/sites/${ref.siteSlug}/deployments/${ref.deploymentId}`);
}

export async function setGuestFirewallEnabledAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const guest = await resolveGuest(formData);
    if (!guest.ok) return guest.state;
    const enable = String(formData.get("enable")) === "1";

    const siteConfig = await resolveSiteConfigBySlug(guest.ref.siteSlug);
    await withSiteConfig(siteConfig, () =>
      setGuestFirewallEnabled(guest.node, guest.vmid, guest.type, enable),
    );

    const guestLabel = guest.type === "qemu" ? "VM" : "CT";
    await recordAndRevalidate(
      guest.ref,
      guest.vmid,
      `Firewall ${enable ? "enabled" : "disabled"} on ${guestLabel} ${guest.vmid}`,
    );
    return {
      message: `Firewall ${enable ? "enabled" : "disabled"}. Remember each NIC also needs its firewall flag on.`,
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return errorState(
      error instanceof Error ? error.message : "Failed to update firewall state.",
    );
  }
}

export async function addGuestFirewallRuleAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const guest = await resolveGuest(formData);
    if (!guest.ok) return guest.state;

    const type = String(formData.get("type") ?? "").trim();
    const action = String(formData.get("action") ?? "").trim();
    if (!["in", "out"].includes(type)) return errorState("Direction must be in or out.");
    if (!["ACCEPT", "DROP", "REJECT"].includes(action)) {
      return errorState("Action must be ACCEPT, DROP, or REJECT.");
    }

    const rule: Record<string, unknown> = { type, action, enable: 1 };
    const proto = String(formData.get("proto") ?? "").trim().toLowerCase();
    const dport = String(formData.get("dport") ?? "").trim();
    const source = String(formData.get("source") ?? "").trim();
    const comment = String(formData.get("comment") ?? "").trim();
    if (proto) {
      if (!PROTO_RX.test(proto)) return errorState("Invalid protocol.");
      rule.proto = proto;
    }
    if (dport) {
      if (!PORT_RX.test(dport)) return errorState("Invalid port (use 443, 8000:8100, or a comma list).");
      rule.dport = dport;
    }
    if (source) {
      if (!ADDR_RX.test(source)) return errorState("Invalid source address/CIDR.");
      rule.source = source;
    }
    if (comment) {
      if (!COMMENT_RX.test(comment)) return errorState("Comment contains unsupported characters.");
      rule.comment = comment;
    }

    const siteConfig = await resolveSiteConfigBySlug(guest.ref.siteSlug);
    await withSiteConfig(siteConfig, () =>
      createGuestFirewallRule(guest.node, guest.vmid, guest.type, rule),
    );

    const guestLabel = guest.type === "qemu" ? "VM" : "CT";
    const summary = `${type} ${action}${proto ? ` ${proto}` : ""}${dport ? ` dport ${dport}` : ""}${source ? ` from ${source}` : ""}`;
    await recordAndRevalidate(
      guest.ref,
      guest.vmid,
      `Firewall rule added on ${guestLabel} ${guest.vmid}: ${summary}`,
    );
    return { message: `Rule added: ${summary}.`, requestId: randomUUID(), status: "success" };
  } catch (error) {
    return errorState(
      error instanceof Error ? error.message : "Failed to add firewall rule.",
    );
  }
}

export async function deleteGuestFirewallRuleAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const guest = await resolveGuest(formData);
    if (!guest.ok) return guest.state;
    const pos = Number.parseInt(String(formData.get("pos") ?? ""), 10);
    if (!Number.isInteger(pos) || pos < 0) return errorState("Invalid rule position.");

    const siteConfig = await resolveSiteConfigBySlug(guest.ref.siteSlug);
    await withSiteConfig(siteConfig, () =>
      deleteGuestFirewallRule(guest.node, guest.vmid, guest.type, pos),
    );

    const guestLabel = guest.type === "qemu" ? "VM" : "CT";
    await recordAndRevalidate(
      guest.ref,
      guest.vmid,
      `Firewall rule #${pos} deleted on ${guestLabel} ${guest.vmid}`,
    );
    return { message: `Rule #${pos} deleted.`, requestId: randomUUID(), status: "success" };
  } catch (error) {
    return errorState(
      error instanceof Error ? error.message : "Failed to delete firewall rule.",
    );
  }
}
