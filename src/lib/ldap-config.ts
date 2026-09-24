import "server-only";

import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import { decryptText, encryptText } from "@/lib/crypto";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

export type LdapConfig = {
  url: string;
  bindDN: string;
  encryptedBindPassword: string;
  searchBase: string;
  userFilter: string;
  emailAttribute: string;
  nameAttribute: string;
  autoProvision: boolean;
  defaultRole: "admin" | "operator";
  allowedEmailDomains: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LdapConfigPublic = Omit<LdapConfig, "encryptedBindPassword"> & {
  hasBindPassword: boolean;
};

export type LdapConfigInput = {
  url: string;
  bindDN: string;
  bindPassword: string;
  searchBase: string;
  userFilter: string;
  emailAttribute: string;
  nameAttribute: string;
  autoProvision: boolean;
  defaultRole: "admin" | "operator";
  allowedEmailDomains: string;
  enabled: boolean;
};

type LdapConfigStore = {
  config: LdapConfig | null;
};

const DATA_FILE = "ldap-config.json";

const DEFAULT_USER_FILTER = "(&(objectClass=user)(mail={email}))";

async function readStore(): Promise<LdapConfigStore> {
  try {
    const raw = await readFile(await resolveDataFilePath(DATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<LdapConfigStore>;
    return { config: parsed.config ?? null };
  } catch {
    return { config: null };
  }
}

async function writeStore(store: LdapConfigStore) {
  const filePath = await resolveDataFilePath(DATA_FILE);
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("ldap-config", readStore, writeStore);

function toPublic(config: LdapConfig): LdapConfigPublic {
  const { encryptedBindPassword: _omit, ...rest } = config;
  return {
    ...rest,
    hasBindPassword: Boolean(config.encryptedBindPassword),
  };
}

export async function getLdapConfig(): Promise<LdapConfig | null> {
  const store = await readStore();
  return store.config;
}

export async function getLdapConfigPublic(): Promise<LdapConfigPublic | null> {
  const config = await getLdapConfig();
  return config ? toPublic(config) : null;
}

export async function isLdapEnabled(): Promise<boolean> {
  const config = await getLdapConfig();
  return Boolean(config?.enabled && config.url && config.bindDN && config.encryptedBindPassword);
}

export async function getDecryptedLdapBindPassword(config: LdapConfig): Promise<string> {
  if (!config.encryptedBindPassword) {
    throw new Error("LDAP bind password is not configured.");
  }
  return decryptText(config.encryptedBindPassword);
}

function validateInput(input: LdapConfigInput, isCreate: boolean): void {
  const url = input.url.trim();
  if (!url || !/^ldaps?:\/\//.test(url)) {
    throw new Error("LDAP URL must start with ldaps:// or ldap://.");
  }
  if (
    url.toLowerCase().startsWith("ldap://") &&
    process.env.TAINER_LDAP_ALLOW_INSECURE !== "true"
  ) {
    throw new Error(
      "LDAP URL must use ldaps:// — plaintext LDAP exposes the bind password to anyone on the network path. Set TAINER_LDAP_ALLOW_INSECURE=true only for closed-network development.",
    );
  }

  if (!input.bindDN.trim()) throw new Error("Bind DN is required.");
  if (isCreate && !input.bindPassword) {
    throw new Error("Bind password is required when configuring LDAP.");
  }
  if (!input.searchBase.trim()) throw new Error("Search base is required.");
  if (!input.userFilter.trim()) throw new Error("User filter is required.");
  if (!input.userFilter.includes("{email}") && !input.userFilter.includes("{user}")) {
    throw new Error(
      "User filter must contain {email} or {user} so the supplied identifier is substituted in.",
    );
  }
  if (!["admin", "operator"].includes(input.defaultRole)) {
    throw new Error("Default role must be admin or operator.");
  }

  if (input.autoProvision && input.defaultRole === "admin") {
    const domains = parseAllowedDomains(input.allowedEmailDomains ?? "");
    if (domains === null || domains.length === 0) {
      throw new Error(
        "Auto-provisioning admin users requires at least one allowed email domain. Set allowedEmailDomains to a comma-separated list of trusted domains.",
      );
    }
  }
}

export async function saveLdapConfig(input: LdapConfigInput): Promise<LdapConfig> {
  const existing = await getLdapConfig();
  validateInput(input, !existing);
  if (
    existing &&
    !input.bindPassword &&
    (input.url.trim() !== existing.url || input.bindDN.trim() !== existing.bindDN)
  ) {
    throw new Error("Re-enter the bind password when changing the server URL or bind DN.");
  }

  const newEncryptedPassword = input.bindPassword
    ? await encryptText(input.bindPassword)
    : null;

  return mutateStore(async (store) => {
    const timestamp = new Date().toISOString();
    const next: LdapConfig = {
      url: input.url.trim(),
      bindDN: input.bindDN.trim(),
      encryptedBindPassword:
        newEncryptedPassword ?? existing?.encryptedBindPassword ?? "",
      searchBase: input.searchBase.trim(),
      userFilter: input.userFilter.trim() || DEFAULT_USER_FILTER,
      emailAttribute: (input.emailAttribute || "mail").trim(),
      nameAttribute: (input.nameAttribute || "displayName").trim(),
      autoProvision: input.autoProvision,
      defaultRole: input.defaultRole,
      allowedEmailDomains: input.allowedEmailDomains.trim(),
      enabled: input.enabled,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    store.config = next;
    return next;
  });
}

export async function deleteLdapConfig(): Promise<boolean> {
  return mutateStore((store) => {
    if (!store.config) return false;
    store.config = null;
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

export function isEmailAllowed(email: string, allowedEmailDomains: string): boolean {
  const list = parseAllowedDomains(allowedEmailDomains);
  if (list === null) return true;
  // Match the domain after the last @ so "x@corp.com@evil.com" cannot pass.
  const lower = email.toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at === -1) return false;
  const domain = lower.slice(at + 1);
  if (!domain) return false;
  return list.includes(domain);
}
