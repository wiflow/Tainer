import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import { decryptText, encryptText } from "@/lib/crypto";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

export type IdpProviderType = "oidc";

export type IdpProvider = {
  slug: string;
  name: string;
  type: IdpProviderType;
  enabled: boolean;
  issuer: string;
  clientId: string;
  encryptedClientSecret: string;
  /** Comma-separated domains; an empty string means unrestricted. */
  allowedEmailDomains: string;
  autoProvision: boolean;
  defaultRole: "admin" | "operator";
  trustEmailWithoutVerifiedClaim?: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  id: string;
};

export type IdpProviderPublic = Omit<IdpProvider, "encryptedClientSecret"> & {
  hasClientSecret: boolean;
};

export type IdpProviderInput = {
  slug: string;
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  allowedEmailDomains: string;
  autoProvision: boolean;
  defaultRole: "admin" | "operator";
  trustEmailWithoutVerifiedClaim: boolean;
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

  const issuer = input.issuer.trim();
  if (!issuer || !/^https?:\/\//.test(issuer)) {
    throw new Error("Issuer must be a URL starting with http:// or https://.");
  }
  if (
    issuer.startsWith("http://") &&
    process.env.TAINER_OIDC_ALLOW_INSECURE_ISSUER !== "true"
  ) {
    throw new Error(
      "Issuer must use https:// in production. Set TAINER_OIDC_ALLOW_INSECURE_ISSUER=true to allow http:// for local development.",
    );
  }

  if (!input.clientId.trim()) throw new Error("Client ID is required.");
  if (isCreate && !input.clientSecret) {
    throw new Error("Client secret is required when creating a provider.");
  }
  if (!["admin", "operator"].includes(input.defaultRole)) {
    throw new Error("Default role must be admin or operator.");
  }

  // Admin auto-provisioning without a domain allowlist would make any IdP user an admin.
  if (input.autoProvision && input.defaultRole === "admin") {
    const domains = parseAllowedDomains(input.allowedEmailDomains ?? "");
    if (domains === null || domains.length === 0) {
      throw new Error(
        "Auto-provisioning admin users requires at least one allowed email domain. " +
          "Set allowedEmailDomains to a comma-separated list of trusted domains.",
      );
    }
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

export async function listLoginIdpButtons(): Promise<
  { slug: string; name: string; brand: IdpBrand | null }[]
> {
  return (await listIdpProviders())
    .filter((p) => p.enabled)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      brand: detectIdpBrand(p.issuer),
    }));
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
      trustEmailWithoutVerifiedClaim: input.trustEmailWithoutVerifiedClaim,
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
    const issuer = input.issuer.trim().replace(/\/+$/, "");
    const clientId = input.clientId.trim();
    if (!newSecret && (issuer !== existing.issuer || clientId !== existing.clientId)) {
      throw new Error("Re-enter the client secret when changing the issuer URL or client ID.");
    }
    const updated: IdpProvider = {
      ...existing,
      slug,
      name: input.name.trim(),
      issuer,
      clientId,
      encryptedClientSecret: newSecret ?? existing.encryptedClientSecret,
      allowedEmailDomains: input.allowedEmailDomains.trim(),
      autoProvision: input.autoProvision,
      defaultRole: input.defaultRole,
      trustEmailWithoutVerifiedClaim: input.trustEmailWithoutVerifiedClaim,
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

export type IdpBrand = "microsoft";

export function detectIdpBrand(issuer: string): IdpBrand | null {
  let hostname: string;
  try {
    hostname = new URL(issuer).hostname.toLowerCase();
  } catch {
    return null;
  }

  // Exact hostnames, so an issuer merely containing "microsoft" cannot claim the brand.
  const microsoftHosts = new Set([
    "login.microsoftonline.com",
    "login.microsoftonline.us",
    "login.microsoftonline.de",
    "login.partner.microsoftonline.cn",
    "sts.windows.net",
  ]);
  if (microsoftHosts.has(hostname)) return "microsoft";

  return null;
}

export function isEmailAllowed(email: string, allowedEmailDomains: string): boolean {
  const list = parseAllowedDomains(allowedEmailDomains);
  if (list === null) return true;
  // The domain is the part after the last @, not split("@")[1].
  const lower = email.toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at === -1) return false;
  const domain = lower.slice(at + 1);
  if (!domain) return false;
  return list.includes(domain);
}
