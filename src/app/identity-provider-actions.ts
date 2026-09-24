"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { TestIdpActionState } from "@/app/identity-provider-action-states";
import { recordAdminAudit } from "@/lib/admin-audit-log";
import type { BasicActionState } from "@/lib/action-states";
import { requireAdminSession } from "@/lib/auth";
import {
  createIdpProvider,
  deleteIdpProvider,
  getIdpProviderById,
  updateIdpProvider,
  type IdpProviderInput,
} from "@/lib/idp-providers";
import { invalidateOidcDiscoveryCache, testOidcDiscovery } from "@/lib/oidc";

function parseInput(formData: FormData): IdpProviderInput {
  return {
    slug: String(formData.get("slug") ?? ""),
    name: String(formData.get("name") ?? ""),
    issuer: String(formData.get("issuer") ?? ""),
    clientId: String(formData.get("clientId") ?? ""),
    clientSecret: String(formData.get("clientSecret") ?? ""),
    allowedEmailDomains: String(formData.get("allowedEmailDomains") ?? ""),
    autoProvision: formData.get("autoProvision") === "on",
    defaultRole:
      String(formData.get("defaultRole") ?? "operator") === "admin"
        ? "admin"
        : "operator",
    trustEmailWithoutVerifiedClaim: formData.get("trustEmailWithoutVerifiedClaim") === "on",
    enabled: formData.get("enabled") === "on",
  };
}

export async function createIdpProviderAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireAdminSession();
    const input = parseInput(formData);
    const provider = await createIdpProvider(input, session.user.email);

    recordAdminAudit({
      action: "sso-provider-created",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Created OIDC provider "${provider.name}" (slug=${provider.slug})`,
    }).catch(() => {});

    revalidatePath("/identity-providers");
    return {
      message: `Provider "${provider.name}" created.`,
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to create provider.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function updateIdpProviderAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireAdminSession();
    const id = String(formData.get("providerId") ?? "");
    if (!id) {
      return {
        message: "Provider ID is required.",
        requestId: randomUUID(),
        status: "error",
      };
    }
    const input = parseInput(formData);
    const previous = await getIdpProviderById(id);
    const provider = await updateIdpProvider(id, input);
    if (!provider) {
      return {
        message: "Provider not found.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    invalidateOidcDiscoveryCache(id);

    const changes = [
      `slug=${provider.slug}`,
      previous && previous.issuer !== provider.issuer
        ? `issuer ${previous.issuer} -> ${provider.issuer}`
        : null,
      previous && previous.clientId !== provider.clientId
        ? `clientId ${previous.clientId} -> ${provider.clientId}`
        : null,
    ].filter(Boolean);
    recordAdminAudit({
      action: "sso-provider-updated",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Updated OIDC provider "${provider.name}" (${changes.join(", ")})`,
    }).catch(() => {});

    revalidatePath("/identity-providers");
    return {
      message: `Provider "${provider.name}" updated.`,
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to update provider.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function deleteIdpProviderAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireAdminSession();
    const id = String(formData.get("providerId") ?? "");
    if (!id) {
      return {
        message: "Provider ID is required.",
        requestId: randomUUID(),
        status: "error",
      };
    }
    const provider = await getIdpProviderById(id);
    const deleted = await deleteIdpProvider(id);
    if (!deleted) {
      return {
        message: "Provider not found.",
        requestId: randomUUID(),
        status: "error",
      };
    }

    invalidateOidcDiscoveryCache(id);
    recordAdminAudit({
      action: "sso-provider-deleted",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Deleted OIDC provider "${provider?.name ?? id}"`,
    }).catch(() => {});

    revalidatePath("/identity-providers");
    return {
      message: "Provider deleted.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to delete provider.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}

export async function testIdpProviderAction(
  _previousState: TestIdpActionState,
  formData: FormData,
): Promise<TestIdpActionState> {
  try {
    await requireAdminSession();
    const id = String(formData.get("providerId") ?? "");
    if (!id) {
      return {
        authorizationEndpoint: null,
        message: "Provider ID is required.",
        requestId: randomUUID(),
        status: "error",
      };
    }
    const provider = await getIdpProviderById(id);
    if (!provider) {
      return {
        authorizationEndpoint: null,
        message: "Provider not found.",
        requestId: randomUUID(),
        status: "error",
      };
    }
    const result = await testOidcDiscovery(provider);
    if (!result.ok) {
      return {
        authorizationEndpoint: null,
        message: `Discovery failed: ${result.error}`,
        requestId: randomUUID(),
        status: "error",
      };
    }
    return {
      authorizationEndpoint: result.authorizationEndpoint,
      message: "Discovery succeeded — provider looks good.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return {
      authorizationEndpoint: null,
      message: error instanceof Error ? error.message : "Test failed.",
      requestId: randomUUID(),
      status: "error",
    };
  }
}
