"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { recordAdminAudit } from "@/lib/admin-audit-log";
import type { BasicActionState } from "@/lib/action-states";
import { requireSession, requireSitePermission } from "@/lib/auth";
import {
  deleteLldpAnnotation,
  upsertLldpAnnotation,
} from "@/lib/lldp-annotations";
import {
  issueLldpToken,
  revokeLldpToken,
} from "@/lib/lldp-credentials";
import { clearLldpSnapshotsForSite } from "@/lib/lldp-snapshots";
import {
  getSnmpCommunityForSite,
  saveAgentBaseUrlForSite,
  saveSnmpConfigForSite,
} from "@/lib/lldp-snmp-config";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

import type { LldpIssueTokenActionState } from "@/app/network-action-states";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function issueLldpTokenAction(
  _previousState: LldpIssueTokenActionState,
  formData: FormData,
): Promise<LldpIssueTokenActionState> {
  try {
    const session = await requireSession();
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return {
        message: "Missing site context.",
        requestId: randomUUID(),
        status: "error",
        plaintext: "",
        label: "",
        snmpCommunity: "",
      };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-security");

    const label = String(formData.get("label") ?? "").trim();

    const { token, plaintext } = await issueLldpToken({
      siteId: siteConfig.siteId,
      label,
      actorEmail: session.user.email,
    });

    // An empty community in the snippet makes the poll script skip SNMP polling.
    const snmpCommunity = (await getSnmpCommunityForSite(siteConfig.siteId)) ?? "";

    recordAdminAudit({
      action: "lldp-token-issued",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Issued LLDP agent token "${token.label}" for site ${siteSlug}.`,
    }).catch(() => {});

    revalidatePath(`/sites/${siteSlug}/network`);

    return {
      message: `Token issued. Copy it now — it will not be shown again.`,
      requestId: randomUUID(),
      status: "success",
      plaintext,
      label: token.label,
      snmpCommunity,
    };
  } catch (error) {
    return {
      message: errorMessage(error, "Failed to issue token."),
      requestId: randomUUID(),
      status: "error",
      plaintext: "",
      label: "",
      snmpCommunity: "",
    };
  }
}

export async function revokeLldpTokenAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    const siteSlug = String(formData.get("siteSlug") ?? "");
    const tokenId = String(formData.get("tokenId") ?? "");
    if (!siteSlug || !tokenId) {
      return {
        message: "Missing site or token reference.",
        requestId: randomUUID(),
        status: "error",
      };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-security");

    const token = await revokeLldpToken({
      tokenId,
      siteId: siteConfig.siteId,
      actorEmail: session.user.email,
    });
    if (!token) {
      return {
        message: "Token not found.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    recordAdminAudit({
      action: "lldp-token-revoked",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Revoked LLDP agent token "${token.label}" for site ${siteSlug}.`,
    }).catch(() => {});

    revalidatePath(`/sites/${siteSlug}/network`);

    return {
      message: "Token revoked.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      message: errorMessage(error, "Failed to revoke token."),
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function upsertLldpAnnotationAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    const siteSlug = String(formData.get("siteSlug") ?? "");
    const chassisId = String(formData.get("chassisId") ?? "");
    if (!siteSlug || !chassisId) {
      return {
        message: "Missing site or chassis reference.",
        requestId: randomUUID(),
        status: "error",
      };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-security");

    const updated = await upsertLldpAnnotation({
      siteId: siteConfig.siteId,
      chassisId,
      friendlyName: String(formData.get("friendlyName") ?? ""),
      portCountOverride: String(formData.get("portCountOverride") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      actorEmail: session.user.email,
    });

    recordAdminAudit({
      action: "lldp-annotation-updated",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Updated LLDP annotation for ${updated.friendlyName ?? chassisId} on site ${siteSlug}.`,
    }).catch(() => {});

    revalidatePath(`/sites/${siteSlug}/network`);
    revalidatePath(
      `/sites/${siteSlug}/network/devices/${encodeURIComponent(chassisId)}`,
    );

    return {
      message: "Annotations saved.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      message: errorMessage(error, "Failed to save annotations."),
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function deleteLldpAnnotationAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    const siteSlug = String(formData.get("siteSlug") ?? "");
    const chassisId = String(formData.get("chassisId") ?? "");
    if (!siteSlug || !chassisId) {
      return {
        message: "Missing site or chassis reference.",
        requestId: randomUUID(),
        status: "error",
      };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-security");

    const removed = await deleteLldpAnnotation({
      siteId: siteConfig.siteId,
      chassisId,
    });
    if (!removed) {
      return {
        message: "No annotation to clear.",
        requestId: randomUUID(),
        status: "success",
      };
    }

    recordAdminAudit({
      action: "lldp-annotation-removed",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Cleared LLDP annotation for chassis ${chassisId} on site ${siteSlug}.`,
    }).catch(() => {});

    revalidatePath(`/sites/${siteSlug}/network`);
    revalidatePath(
      `/sites/${siteSlug}/network/devices/${encodeURIComponent(chassisId)}`,
    );

    return {
      message: "Annotations cleared. Device falls back to LLDP-advertised values.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      message: errorMessage(error, "Failed to clear annotations."),
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function clearLldpSnapshotsAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return {
        message: "Missing site context.",
        requestId: randomUUID(),
        status: "error",
      };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-security");

    await clearLldpSnapshotsForSite(siteConfig.siteId);

    recordAdminAudit({
      action: "lldp-snapshots-cleared",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Cleared all LLDP topology snapshots for site ${siteSlug}.`,
    }).catch(() => {});

    revalidatePath(`/sites/${siteSlug}/network`);

    return {
      message: "All discovered devices cleared. Agents will repopulate on next push.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      message: errorMessage(error, "Failed to clear snapshots."),
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function saveSnmpConfigAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return {
        message: "Missing site context.",
        requestId: randomUUID(),
        status: "error",
      };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-security");

    const rawCommunity = formData.get("community");
    const clear = formData.get("clear") === "1";
    const community = clear || rawCommunity === null ? null : String(rawCommunity);
    const intervalRaw = String(formData.get("pollIntervalSeconds") ?? "").trim();
    const pollIntervalSeconds = intervalRaw ? Number(intervalRaw) : undefined;

    const result = await saveSnmpConfigForSite({
      siteId: siteConfig.siteId,
      community,
      pollIntervalSeconds,
      actor: { email: session.user.email, name: session.user.name },
    });

    const cleared = clear || !community?.trim();
    recordAdminAudit({
      action: cleared ? "lldp-token-revoked" : "lldp-token-issued",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: cleared
        ? `Cleared SNMP community for site ${siteSlug}.`
        : `Updated SNMP community for site ${siteSlug} (poll every ${result.pollIntervalSeconds}s).`,
    }).catch(() => {});

    revalidatePath(`/sites/${siteSlug}/network`);

    return {
      message: cleared
        ? "SNMP polling disabled. Agents will stop polling at their next interval."
        : `SNMP community saved. Agents will pick it up at their next polling interval (${result.pollIntervalSeconds}s).`,
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      message: errorMessage(error, "Failed to save SNMP config."),
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function saveAgentEndpointAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    const siteSlug = String(formData.get("siteSlug") ?? "");
    if (!siteSlug) {
      return {
        message: "Missing site context.",
        requestId: randomUUID(),
        status: "error",
      };
    }
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    requireSitePermission(session, siteConfig.siteId, "manage-security");

    const rawUrl = formData.get("agentBaseUrl");
    const clear = formData.get("clear") === "1";
    const agentBaseUrl = clear || rawUrl === null ? null : String(rawUrl);

    const result = await saveAgentBaseUrlForSite({
      siteId: siteConfig.siteId,
      agentBaseUrl,
      actor: { email: session.user.email, name: session.user.name },
    });

    recordAdminAudit({
      action: "integration-updated",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: result.agentBaseUrl
        ? `Set agent ingest URL for site ${siteSlug} to ${result.agentBaseUrl}.`
        : `Cleared agent ingest URL override for site ${siteSlug} (back to APP_URL/env).`,
    }).catch(() => {});

    revalidatePath(`/sites/${siteSlug}/network`);

    return {
      message: result.agentBaseUrl
        ? `Agent ingest URL set to ${result.agentBaseUrl}. Re-issue a token (or edit /etc/tainer-lldp.env) on each node to pick it up.`
        : "Agent ingest URL override cleared — falls back to APP_URL / TAINER_AGENT_BASE_URL.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      message: errorMessage(error, "Failed to save agent ingest URL."),
      requestId: randomUUID(),
      status: "error",
    };
  }
}
