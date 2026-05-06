"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import {
  beginLogin,
  createInitialAdministrator,
  requirePermission,
  requireSession,
} from "@/lib/auth";
import type { BasicActionState } from "@/lib/action-states";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import {
  createSite,
  deleteSite,
  disableSite,
  enableSite,
  findOverlappingSite,
  setDefaultSite,
  updateSite,
  updateSiteValidation,
} from "@/lib/site-store";
import type { ResolvedSiteConfig, SiteInput } from "@/lib/site-types";
import { validateSiteConnection } from "@/lib/site-validation";

import { getClientIpForRateLimit } from "@/lib/proxy-trust";

function errorState(prev: BasicActionState, message: string): BasicActionState {
  return { message, requestId: randomUUID(), status: "error" };
}

export async function bootstrapWorkspaceAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (!name || !email || !password) {
      return errorState(_previousState, "Name, email, and password are required.");
    }
    if (password !== confirmPassword) {
      return errorState(_previousState, "Passwords do not match.");
    }

    const siteName = String(formData.get("siteName") ?? "").trim();
    const apiUrl = String(formData.get("apiUrl") ?? "").trim();
    const username = String(formData.get("username") ?? "").trim();
    const pvePassword = String(formData.get("pvePassword") ?? "").trim();
    const tlsMode = formData.get("tlsMode") === "insecure" ? "insecure" as const : "full" as const;
    const tlsCustomCaPem = String(formData.get("tlsCustomCaPem") ?? "").trim() || null;
    const defaultNode = String(formData.get("defaultNode") ?? "").trim();

    if (!siteName || !apiUrl || !username || !pvePassword) {
      return errorState(
        _previousState,
        "Site name, API URL, username, and password are required.",
      );
    }

    await createInitialAdministrator({ email, name, password });

    const tempConfig: ResolvedSiteConfig = {
      siteId: "__bootstrap__",
      siteSlug: "__bootstrap__",
      siteName,
      apiUrl,
      username,
      password: pvePassword,
      tlsInsecure: tlsMode === "insecure",
      tlsFingerprint: null,
      tlsCustomCaPem,
      defaultNode,
      defaultRootfsStorage: "",
      defaultVmStorage: "",
      defaultIsoStorage: "",
      defaultBackupStorage: "",
      defaultBackupSlaHours: 24,
      sshHostKeyPolicy: "accept-new",
      consoleKnownHostsContent: null,
    };
    const validation = await validateSiteConnection(tempConfig);
    const fingerprints = validation.ok
      ? (validation.nodes?.map((n) => n.fingerprint) ?? [])
      : [];

    const siteInput: SiteInput = {
      name: siteName,
      kind: "proxmox",
      apiUrl,
      username,
      password: pvePassword,
      tlsMode,
      tlsCustomCaPem,
      defaultNode,
    };

    const site = await createSite(siteInput, fingerprints);

    await beginLogin(email, password, await getClientIpForRateLimit());

    return {
      message: site.slug,
      requestId: randomUUID(),
      status: "redirect",
    };
  } catch (error) {
    return errorState(
      _previousState,
      error instanceof Error ? error.message : "Failed to initialize workspace.",
    );
  }
}

export async function validateSiteConnectionAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-sites");

    const apiUrl = String(formData.get("apiUrl") ?? "").trim();
    const username = String(formData.get("username") ?? "").trim();
    const pvePassword = String(formData.get("password") ?? "").trim();
    const tlsMode = formData.get("tlsMode") === "insecure" ? "insecure" as const : "full" as const;

    if (!apiUrl || !username || !pvePassword) {
      return errorState(_previousState, "API URL, username, and password are required.");
    }

    const result = await validateSiteConnection({
      siteId: "__test__",
      siteSlug: "__test__",
      siteName: "Test",
      apiUrl,
      username,
      password: pvePassword,
      tlsInsecure: tlsMode === "insecure",
      tlsFingerprint: null,
      tlsCustomCaPem: null,
      defaultNode: "",
      defaultRootfsStorage: "",
      defaultVmStorage: "",
      defaultIsoStorage: "",
      defaultBackupStorage: "",
      defaultBackupSlaHours: 24,
      sshHostKeyPolicy: "accept-new",
      consoleKnownHostsContent: null,
    });

    if (!result.ok) {
      return errorState(_previousState, result.message ?? "Connection failed.");
    }

    return {
      message: `Connected successfully. Proxmox VE ${result.version ?? "unknown"} (${result.latencyMs}ms).`,
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return errorState(
      _previousState,
      error instanceof Error ? error.message : "Connection test failed.",
    );
  }
}

export async function createSiteAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-sites");

    const siteName = String(formData.get("siteName") ?? "").trim();
    const apiUrl = String(formData.get("apiUrl") ?? "").trim();
    const username = String(formData.get("username") ?? "").trim();
    const pvePassword = String(formData.get("password") ?? "").trim();
    const tlsModeValues = formData.getAll("tlsMode").map(String);
    const tlsMode = tlsModeValues[tlsModeValues.length - 1] === "insecure" ? "insecure" as const : "full" as const;
    const tlsCustomCaPem = String(formData.get("tlsCustomCaPem") ?? "").trim() || null;
    const defaultNode = String(formData.get("defaultNode") ?? "").trim();

    if (!siteName || !apiUrl || !username || !pvePassword) {
      return errorState(_previousState, "Site name, API URL, username, and password are required.");
    }

    const tempConfig: ResolvedSiteConfig = {
      siteId: "__pending__",
      siteSlug: "__pending__",
      siteName,
      apiUrl,
      username,
      password: pvePassword,
      tlsInsecure: tlsMode === "insecure",
      tlsFingerprint: null,
      tlsCustomCaPem,
      defaultNode,
      defaultRootfsStorage: "",
      defaultVmStorage: "",
      defaultIsoStorage: "",
      defaultBackupStorage: "",
      defaultBackupSlaHours: 24,
      sshHostKeyPolicy: "accept-new",
      consoleKnownHostsContent: null,
    };

    const validation = await validateSiteConnection(tempConfig);
    if (!validation.ok) {
      return errorState(_previousState, validation.message ?? "Connection failed — check credentials and API URL.");
    }

    const fingerprints = validation.nodes?.map((n) => n.fingerprint) ?? [];
    if (fingerprints.length > 0) {
      const overlap = await findOverlappingSite(fingerprints);
      if (overlap) {
        return errorState(
          _previousState,
          `This Proxmox cluster is already registered as "${overlap.siteName}". Each cluster should only be added once.`,
        );
      }
    }

    const latRaw = String(formData.get("latitude") ?? "").trim();
    const lngRaw = String(formData.get("longitude") ?? "").trim();
    const latitude = latRaw ? parseFloat(latRaw) : null;
    const longitude = lngRaw ? parseFloat(lngRaw) : null;
    const countryCodeRaw = String(formData.get("countryCode") ?? "").trim();

    await createSite({
      name: siteName,
      kind: "proxmox",
      apiUrl,
      username,
      password: pvePassword,
      tlsMode,
      tlsCustomCaPem,
      defaultNode,
      latitude: latitude != null && isFinite(latitude) ? latitude : null,
      longitude: longitude != null && isFinite(longitude) ? longitude : null,
      countryCode: countryCodeRaw || null,
    }, fingerprints);

    revalidatePath("/sites");
    return { message: "Site created.", requestId: randomUUID(), status: "success" };
  } catch (error) {
    return errorState(
      _previousState,
      error instanceof Error ? error.message : "Failed to create site.",
    );
  }
}

export async function disableSiteAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-sites");
    const siteId = String(formData.get("siteId") ?? "");
    await disableSite(siteId);
    revalidatePath("/sites");
    return { message: "Site disabled.", requestId: randomUUID(), status: "success" };
  } catch (error) {
    return errorState(_previousState, error instanceof Error ? error.message : "Failed to disable site.");
  }
}

export async function deleteSiteAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-sites");
    const siteId = String(formData.get("siteId") ?? "");
    const ok = await deleteSite(siteId);
    if (!ok) return errorState(_previousState, "Site not found.");
    revalidatePath("/sites");
    return { message: "Site deleted.", requestId: randomUUID(), status: "success" };
  } catch (error) {
    return errorState(_previousState, error instanceof Error ? error.message : "Failed to delete site.");
  }
}

export async function enableSiteAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-sites");
    const siteId = String(formData.get("siteId") ?? "");
    await enableSite(siteId);
    revalidatePath("/sites");
    return { message: "Site enabled.", requestId: randomUUID(), status: "success" };
  } catch (error) {
    return errorState(_previousState, error instanceof Error ? error.message : "Failed to enable site.");
  }
}

export async function setDefaultSiteAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-sites");
    const siteId = String(formData.get("siteId") ?? "");
    await setDefaultSite(siteId);
    revalidatePath("/sites");
    return { message: "Default site updated.", requestId: randomUUID(), status: "success" };
  } catch (error) {
    return errorState(_previousState, error instanceof Error ? error.message : "Failed to update default site.");
  }
}

export async function validateExistingSiteAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-sites");
    const siteSlug = String(formData.get("siteSlug") ?? "");
    const config = await resolveSiteConfigBySlug(siteSlug);
    const result = await validateSiteConnection(config);

    const fingerprints = result.nodes?.map((n) => n.fingerprint) ?? [];
    await updateSiteValidation(config.siteId, result.ok, fingerprints.length > 0 ? fingerprints : undefined);
    revalidatePath("/sites");

    if (!result.ok) {
      return errorState(_previousState, result.message ?? "Validation failed.");
    }

    return {
      message: `Connected. Proxmox VE ${result.version ?? "unknown"} (${result.latencyMs}ms).`,
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return errorState(
      _previousState,
      error instanceof Error ? error.message : "Validation failed.",
    );
  }
}

export async function updateSiteAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireSession();
    requirePermission(session, "manage-sites");

    const siteId = String(formData.get("siteId") ?? "");
    const siteName = String(formData.get("siteName") ?? "").trim();
    const apiUrl = String(formData.get("apiUrl") ?? "").trim();
    const username = String(formData.get("username") ?? "").trim();
    const pvePassword = String(formData.get("password") ?? "").trim();
    // Checkbox with hidden fallback: getAll returns ["full"] or ["full","insecure"].
    // The last value is the effective one.
    const tlsModeValues = formData.getAll("tlsMode").map(String);
    const tlsMode = tlsModeValues[tlsModeValues.length - 1] === "insecure" ? "insecure" as const : "full" as const;
    const tlsCustomCaPem = String(formData.get("tlsCustomCaPem") ?? "").trim() || null;
    const defaultNode = String(formData.get("defaultNode") ?? "").trim();

    if (!siteId) {
      return errorState(_previousState, "Missing site ID.");
    }

    const latRaw = String(formData.get("latitude") ?? "").trim();
    const lngRaw = String(formData.get("longitude") ?? "").trim();

    const updates: Record<string, unknown> = {};
    if (siteName) updates.name = siteName;
    if (apiUrl) updates.apiUrl = apiUrl;
    if (username) updates.username = username;
    if (pvePassword) updates.password = pvePassword;
    // Always send tlsMode since the checkbox hidden field guarantees a value
    updates.tlsMode = tlsMode;
    updates.tlsCustomCaPem = tlsCustomCaPem;
    if (defaultNode) updates.defaultNode = defaultNode;

    if (latRaw || lngRaw) {
      const lat = latRaw ? parseFloat(latRaw) : null;
      const lng = lngRaw ? parseFloat(lngRaw) : null;
      updates.latitude = lat != null && isFinite(lat) ? lat : null;
      updates.longitude = lng != null && isFinite(lng) ? lng : null;
    }

    // The country select always submits a value (even if empty for "—").
    // formData.has() distinguishes "field absent" from "field cleared".
    if (formData.has("countryCode")) {
      updates.countryCode = String(formData.get("countryCode") ?? "").trim() || null;
    }

    const result = await updateSite(siteId, updates);

    if (!result) {
      return errorState(_previousState, "Site not found.");
    }

    revalidatePath("/sites");
    return { message: "Site updated.", requestId: randomUUID(), status: "success" };
  } catch (error) {
    return errorState(
      _previousState,
      error instanceof Error ? error.message : "Failed to update site.",
    );
  }
}
