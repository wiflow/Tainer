"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { BasicActionState } from "@/lib/action-states";
import { recordAdminAudit } from "@/lib/admin-audit-log";
import { requireAdminSession } from "@/lib/auth";
import {
  deleteLdapConfig,
  getLdapConfig,
  saveLdapConfig,
  type LdapConfigInput,
} from "@/lib/ldap-config";
import { testLdapConnection } from "@/lib/ldap";

function parseInput(formData: FormData): LdapConfigInput {
  return {
    url: String(formData.get("url") ?? ""),
    bindDN: String(formData.get("bindDN") ?? ""),
    bindPassword: String(formData.get("bindPassword") ?? ""),
    searchBase: String(formData.get("searchBase") ?? ""),
    userFilter: String(formData.get("userFilter") ?? ""),
    emailAttribute: String(formData.get("emailAttribute") ?? "mail"),
    nameAttribute: String(formData.get("nameAttribute") ?? "displayName"),
    autoProvision: formData.get("autoProvision") === "on",
    defaultRole:
      String(formData.get("defaultRole") ?? "operator") === "admin"
        ? "admin"
        : "operator",
    allowedEmailDomains: String(formData.get("allowedEmailDomains") ?? ""),
    enabled: formData.get("enabled") === "on",
  };
}

export async function saveLdapConfigAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireAdminSession();
    const input = parseInput(formData);
    const previous = await getLdapConfig();
    const config = await saveLdapConfig(input);

    const changes = [
      previous && previous.url !== config.url ? `url ${previous.url} -> ${config.url}` : `url=${config.url}`,
      previous && previous.bindDN !== config.bindDN ? `bindDN ${previous.bindDN} -> ${config.bindDN}` : null,
      `autoProvision=${config.autoProvision}`,
      `enabled=${config.enabled}`,
    ].filter(Boolean);
    await recordAdminAudit({
      action: "ldap-config-updated",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `LDAP config updated: ${changes.join(", ")}`,
    });

    revalidatePath("/identity-providers");

    return {
      message: "LDAP configuration saved.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to save LDAP config.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function deleteLdapConfigAction(
  _previousState: BasicActionState,
  _formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireAdminSession();
    const deleted = await deleteLdapConfig();
    if (!deleted) {
      return {
        message: "No LDAP configuration to delete.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    await recordAdminAudit({
      action: "ldap-config-deleted",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: "LDAP configuration removed",
    });

    revalidatePath("/identity-providers");

    return {
      message: "LDAP configuration removed.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to delete LDAP config.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

/**
 * Test the saved LDAP configuration by connecting and binding as the
 * service account, then probing the root DSE. Does NOT attempt a user
 * search (that would require knowing a real user's identifier) — just
 * verifies the configured URL, bind DN, and password.
 */
export async function testLdapConnectionAction(
  _previousState: BasicActionState,
  _formData: FormData,
): Promise<BasicActionState> {
  try {
    await requireAdminSession();
    const config = await getLdapConfig();
    if (!config || !config.encryptedBindPassword) {
      return {
        message: "Save the LDAP configuration before running a connection test.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    const result = await testLdapConnection(config);
    if (!result.ok) {
      return {
        message: `Connection failed: ${result.error}`,
        requestId: randomUUID(),
        status: "error",
      };
    }

    return {
      message: `Connected successfully${result.rootDseSubschema ? ` (root DSE: ${result.rootDseSubschema})` : ""}.`,
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Connection test failed.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}
