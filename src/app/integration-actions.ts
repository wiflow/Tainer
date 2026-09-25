"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { recordAdminAudit } from "@/lib/admin-audit-log";
import type { BasicActionState } from "@/lib/action-states";
import { requireAdminSession } from "@/lib/auth";
import {
  deleteIpamIntegration,
  getIpamIntegration,
  upsertIpamIntegration,
  type PhpIpamIntegrationInput,
} from "@/lib/integrations";
import { testPhpIpamConnection } from "@/lib/ipam";

function parseIpamInput(formData: FormData): PhpIpamIntegrationInput {
  const timeoutRaw = String(formData.get("timeoutMs") ?? "").trim();
  const timeoutParsed = Number.parseInt(timeoutRaw, 10);
  return {
    enabled: formData.get("enabled") === "on",
    serverUrl: String(formData.get("serverUrl") ?? ""),
    appId: String(formData.get("appId") ?? ""),
    token: String(formData.get("token") ?? ""),
    tlsInsecure: formData.get("tlsInsecure") === "on",
    timeoutMs: Number.isFinite(timeoutParsed) ? timeoutParsed : 0,
  };
}

export async function upsertIpamIntegrationAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireAdminSession();
    const existed = (await getIpamIntegration()) !== null;
    const input = parseIpamInput(formData);
    await upsertIpamIntegration(input, session.user.email);

    recordAdminAudit({
      action: existed ? "integration-updated" : "integration-configured",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: existed
        ? `Updated phpIPAM integration (server=${input.serverUrl}, app=${input.appId})`
        : `Configured phpIPAM integration (server=${input.serverUrl}, app=${input.appId})`,
    }).catch(() => {});

    revalidatePath("/integrations");
    revalidatePath("/sites/[siteSlug]/network", "page");
    return {
      message: existed ? "IPAM integration updated." : "IPAM integration configured.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to save IPAM integration.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function deleteIpamIntegrationAction(
  _previousState: BasicActionState,
  _formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireAdminSession();
    const removed = await deleteIpamIntegration();
    if (!removed) {
      return {
        message: "No IPAM integration to remove.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    recordAdminAudit({
      action: "integration-removed",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: "Removed phpIPAM integration",
    }).catch(() => {});

    revalidatePath("/integrations");
    revalidatePath("/sites/[siteSlug]/network", "page");
    return {
      message: "IPAM integration removed.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to remove IPAM integration.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function testIpamIntegrationAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    await requireAdminSession();
    const input = parseIpamInput(formData);
    const result = await testPhpIpamConnection(input);
    if (!result.ok) {
      return {
        message: `Connection failed: ${result.error}`,
        requestId: randomUUID(),
        status: "error",
      };
    }
    return {
      message: "Connection succeeded. phpIPAM responded.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Test failed.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}
