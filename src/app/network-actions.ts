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
    };
  } catch (error) {
    return {
      message: errorMessage(error, "Failed to issue token."),
      requestId: randomUUID(),
      status: "error",
      plaintext: "",
      label: "",
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
