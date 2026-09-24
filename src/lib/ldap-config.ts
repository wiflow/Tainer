import "server-only";

import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import { decryptText, encryptText } from "@/lib/crypto";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

/**
 * LDAP configuration is global (one directory per Tainer install — multi-
 * directory deployments aren't supported in v1, mirroring the typical
 * "single corporate AD" topology). The bind-DN password is encrypted at
 * rest with the same AES-256-GCM helpers that protect 2FA secrets and
 * OIDC client secrets, so a disk-level read of the data dir doesn't
 * directly hand over the directory service-account password.
 */

export type LdapConfig = {
  /**
   * `ldaps://host:636` is required by default. Plain `ldap://` is refused
   * unless `TAINER_LDAP_ALLOW_INSECURE=true` is set, because the bind
   * password would otherwise travel in clear.
   */
  url: string;
  /** Service-account distinguished name used to perform the user search. */
  bindDN: string;
  /**
   * Encrypted with `encryptText` from crypto.ts. Decrypted only inside
   * `getDecryptedLdapBindPassword` and never returned to the UI. Empty
   * for the "no LDAP configured" sentinel.
   */
  encryptedBindPassword: string;
  /** Subtree under which the user search runs. e.g. `dc=corp,dc=example`. */
  searchBase: string;
  /**
   * Filter template. `{email}` (or `{user}`) is substituted with the
   * RFC-4515-escaped identifier. Default targets typical Active Directory
   * layouts; OpenLDAP installs override with e.g.
   * `(&(objectClass=inetOrgPerson)(mail={email}))`.
   */
  userFilter: string;
  /** LDAP attribute holding the canonical email. Default: `mail`. */
  emailAttribute: string;
  /** LDAP attribute holding the display name. Default: `displayName`. */
  nameAttribute: string;
  /** When true, unknown emails are auto-created as Tainer users on first auth. */
  autoProvision: boolean;
  /** Role assigned to auto-provisioned users. */
  defaultRole: "admin" | "operator";
  /**
   * Comma-separated allowlist (`corp.example.com,subsidiary.example.com`).
   * Empty = no restriction (use with care + auto-provision OFF).
   */
  allowedEmailDomains: string;
  /** Master switch. False = LDAP entirely off, login flow doesn't even try. */
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Shape returned to the UI — never includes the encrypted secret. */
export type LdapConfigPublic = Omit<LdapConfig, "encryptedBindPassword"> & {
  hasBindPassword: boolean;
};

/** Input from the admin form. Plaintext password; empty = unchanged. */
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
  // Strip the encrypted password — it's never useful to the UI and we
  // never want it in client bundles, server logs, or a serialised props
  // payload.
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

  // Same foot-gun guard as IdP providers: an LDAP that auto-provisions
  // admins from any domain means anyone in the directory becomes an
  // admin. Refuse the combination — operators can opt into wide
  // auto-provision at the operator role, but admin auto-provision must
  // be domain-scoped.
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

/** Same canonical domain-list parser used for OIDC providers. */
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
  // Use the canonical mailbox domain — substring after the LAST `@` —
  // to match the OIDC fix for multi-`@` addresses.
  const lower = email.toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at === -1) return false;
  const domain = lower.slice(at + 1);
  if (!domain) return false;
  return list.includes(domain);
}
