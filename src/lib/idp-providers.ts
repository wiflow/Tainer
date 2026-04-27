import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import { decryptText, encryptText } from "@/lib/crypto";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

/**
 * Identity-provider configuration is global (not per-site). A single login
 * grants access to whatever sites the resulting Tainer user has permissions
 * for — identity is system-wide, sites are Proxmox clusters.
 *
 * Client secrets are encrypted at rest using the same AES-256-GCM helpers
 * that protect 2FA secrets.
 */

export type IdpProviderType = "oidc";

export type IdpProvider = {
  /** UI-friendly slug used in the callback path: /auth/callback/{slug}. */
  slug: string;
  /** Human label shown on the Sign-in-with-X button. */
  name: string;
  /** Currently only "oidc". SAML reserved for a follow-up. */
  type: IdpProviderType;
  enabled: boolean;
  /**
   * OIDC issuer URL — the ID token's `iss` claim. For Microsoft Entra:
   *   https://login.microsoftonline.com/{tenant-id}/v2.0
   * For Google: https://accounts.google.com
   * Used to fetch the discovery document at `${issuer}/.well-known/openid-configuration`.
   */
  issuer: string;
  clientId: string;
  /** Encrypted with `encryptText` from crypto.ts; never returned in plaintext. */
  encryptedClientSecret: string;
  /**
   * Comma-separated email-domain allowlist (e.g. "example.com,subsidiary.com").
   * Empty string = no restriction (use with care + auto-provisioning OFF).
   */
  allowedEmailDomains: string;
  /**
   * If true, sign in for unknown users auto-creates a Tainer account with
   * `defaultRole`. If false, unknown users are rejected with an error.
   */
  autoProvision: boolean;
  /** Role assigned to auto-provisioned users. */
  defaultRole: "admin" | "operator";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  id: string;
};

/** Shape returned to the UI — never includes the encrypted secret blob. */
export type IdpProviderPublic = Omit<IdpProvider, "encryptedClientSecret"> & {
  hasClientSecret: boolean;
};

export type IdpProviderInput = {
  slug: string;
  name: string;
  issuer: string;
  clientId: string;
  /** Plaintext — encrypted before storage. Empty string = unchanged. */
  clientSecret: string;
  allowedEmailDomains: string;
  autoProvision: boolean;
  defaultRole: "admin" | "operator";
  enabled: boolean;
};

type IdpProviderStore = {
  providers: IdpProvider[];
};

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,32}$/;

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 33);
}

function validateProviderInput(input: IdpProviderInput, isCreate: boolean): void {
  const slug = normalizeSlug(input.slug);
  if (!SLUG_REGEX.test(slug)) {
    throw new Error("Provider slug must be lowercase letters, numbers, and dashes (max 33 chars).");
  }
  if (!input.name.trim()) throw new Error("Provider name is required.");
  if (!input.issuer.trim() || !/^https?:\/\//.test(input.issuer.trim())) {
    throw new Error("Issuer must be a URL starting with http:// or https://.");
  }
  if (!input.clientId.trim()) throw new Error("Client ID is required.");
  if (isCreate && !input.clientSecret) {
    throw new Error("Client secret is required when creating a provider.");
  }
  if (!["admin", "operator"].includes(input.defaultRole)) {
    throw new Error("Default role must be admin or operator.");
  }
}

async function readStore(): Promise<IdpProviderStore> {
  try {
    const raw = await readFile(await resolveDataFilePath("idp-providers.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<IdpProviderStore>;
    return {
      providers: Array.isArray(parsed.providers) ? parsed.providers : [],
    };
  } catch {
    return { providers: [] };
  }
}

async function writeStore(store: IdpProviderStore) {
  const filePath = await resolveDataFilePath("idp-providers.json");
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("idp-providers", readStore, writeStore);

function toPublic(provider: IdpProvider): IdpProviderPublic {
  // Strip the encrypted secret blob — it's never useful to the UI and we
  // don't want it ending up in client bundles or logs.
  const { encryptedClientSecret: _omit, ...rest } = provider;
  return {
    ...rest,
    hasClientSecret: Boolean(provider.encryptedClientSecret),
  };
}

export async function listIdpProviders(): Promise<IdpProvider[]> {
  const store = await readStore();
  return [...store.providers].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listIdpProvidersPublic(): Promise<IdpProviderPublic[]> {
  return (await listIdpProviders()).map(toPublic);
}

/**
 * Lightweight public listing for the login page — only enabled providers,
 * only fields needed to render a button. Safe to call from anywhere.
 */
export async function listLoginIdpButtons(): Promise<
  { slug: string; name: string }[]
> {
  return (await listIdpProviders())
    .filter((p) => p.enabled)
    .map((p) => ({ slug: p.slug, name: p.name }));
}

export async function getIdpProviderBySlug(slug: string): Promise<IdpProvider | null> {
  const store = await readStore();
  return store.providers.find((p) => p.slug === slug) ?? null;
}

export async function getIdpProviderById(id: string): Promise<IdpProvider | null> {
  const store = await readStore();
  return store.providers.find((p) => p.id === id) ?? null;
}

export async function getDecryptedClientSecret(provider: IdpProvider): Promise<string> {
  if (!provider.encryptedClientSecret) {
    throw new Error("Provider has no client secret configured.");
  }
  return decryptText(provider.encryptedClientSecret);
}

export async function createIdpProvider(
  input: IdpProviderInput,
  createdBy: string,
): Promise<IdpProvider> {
  validateProviderInput(input, true);
  const slug = normalizeSlug(input.slug);
  const encryptedClientSecret = await encryptText(input.clientSecret);

  return mutateStore((store) => {
    if (store.providers.some((p) => p.slug === slug)) {
      throw new Error(`A provider with slug "${slug}" already exists.`);
    }
    const timestamp = new Date().toISOString();
    const provider: IdpProvider = {
      id: randomUUID(),
      slug,
      name: input.name.trim(),
      type: "oidc",
      enabled: input.enabled,
      issuer: input.issuer.trim().replace(/\/+$/, ""),
      clientId: input.clientId.trim(),
      encryptedClientSecret,
      allowedEmailDomains: input.allowedEmailDomains.trim(),
      autoProvision: input.autoProvision,
      defaultRole: input.defaultRole,
      createdAt: timestamp,
      createdBy,
      updatedAt: timestamp,
    };
    store.providers.push(provider);
    return provider;
  });
}

export async function updateIdpProvider(
  id: string,
  input: IdpProviderInput,
): Promise<IdpProvider | null> {
  validateProviderInput(input, false);
  const slug = normalizeSlug(input.slug);
  const newSecret = input.clientSecret
    ? await encryptText(input.clientSecret)
    : null;

  return mutateStore(async (store) => {
    const index = store.providers.findIndex((p) => p.id === id);
    if (index === -1) return null;
    if (store.providers.some((p) => p.id !== id && p.slug === slug)) {
      throw new Error(`A provider with slug "${slug}" already exists.`);
    }
    const existing = store.providers[index];
    const updated: IdpProvider = {
      ...existing,
      slug,
      name: input.name.trim(),
      issuer: input.issuer.trim().replace(/\/+$/, ""),
      clientId: input.clientId.trim(),
      encryptedClientSecret: newSecret ?? existing.encryptedClientSecret,
      allowedEmailDomains: input.allowedEmailDomains.trim(),
      autoProvision: input.autoProvision,
      defaultRole: input.defaultRole,
      enabled: input.enabled,
      updatedAt: new Date().toISOString(),
    };
    store.providers[index] = updated;
    return updated;
  });
}

export async function deleteIdpProvider(id: string): Promise<boolean> {
  return mutateStore((store) => {
    const index = store.providers.findIndex((p) => p.id === id);
    if (index === -1) return false;
    store.providers.splice(index, 1);
    return true;
  });
}

/** Returns the list of allowed domains, lowercased + de-duplicated, or `null` for "unrestricted". */
export function parseAllowedDomains(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return Array.from(
    new Set(
      trimmed
        .split(/[,\s]+/)
        .map((s) => s.toLowerCase().trim())
        .filter((s) => s.length > 0),
    ),
  );
}

/** Returns true if `email`'s domain is permitted by `allowedEmailDomains`. */
export function isEmailAllowed(email: string, allowedEmailDomains: string): boolean {
  const list = parseAllowedDomains(allowedEmailDomains);
  if (list === null) return true; // unrestricted
  const domain = email.toLowerCase().split("@")[1] ?? "";
  return list.includes(domain);
}
