import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import type { AuthSession } from "@/lib/auth";
import { SITE_PERMISSIONS, type Permission } from "@/lib/permissions";
import { listEnabledSites } from "@/lib/site-store";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

/**
 * Scoped service tokens for scripts / Terraform / CI. Tokens are shown once
 * at creation and stored only as SHA-256 hashes. A bearer token resolves to
 * a synthetic operator session carrying exactly the granted per-site
 * permissions — deny-by-default:
 *   - role is always "operator", so admin-only surfaces (requireAdminSession,
 *     role === "admin" checks) refuse tokens outright;
 *   - only SITE_PERMISSIONS are grantable — user, group, and site management
 *     can never be driven by a token.
 */

const DATA_FILE = "api-tokens.json";
const TOKEN_PREFIX = "tnr_";
const LAST_USED_UPDATE_MS = 60 * 60 * 1000;

export type ApiTokenRecord = {
  id: string;
  name: string;
  /** SHA-256 hex of the full token — the token itself is never stored. */
  tokenHash: string;
  /** First characters of the token, for identification in the UI. */
  displayPrefix: string;
  permissions: Permission[];
  /** Site ids the token is scoped to; empty array = all enabled sites. */
  siteIds: string[];
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type ApiTokenStore = { tokens: ApiTokenRecord[] };

async function readStore(): Promise<ApiTokenStore> {
  try {
    const raw = await readFile(await resolveDataFilePath(DATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<ApiTokenStore>;
    return { tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [] };
  } catch {
    return { tokens: [] };
  }
}

async function writeStore(store: ApiTokenStore) {
  await writeJsonFileAtomically(await resolveDataFilePath(DATA_FILE), store);
}

const mutateStore = createStoreMutator("api-tokens", readStore, writeStore);

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type ApiTokenSummary = Omit<ApiTokenRecord, "tokenHash">;

function toSummary(record: ApiTokenRecord): ApiTokenSummary {
  const summary: Partial<ApiTokenRecord> = { ...record };
  delete summary.tokenHash;
  return summary as ApiTokenSummary;
}

export async function listApiTokens(): Promise<ApiTokenSummary[]> {
  const store = await readStore();
  return store.tokens
    .map(toSummary)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createApiToken(input: {
  name: string;
  permissions: Permission[];
  siteIds: string[];
  expiresAt: string | null;
  createdBy: string;
}): Promise<{ token: string; record: ApiTokenSummary }> {
  const name = input.name.trim();
  if (!name || name.length > 60) {
    throw new Error("Token name is required (max 60 characters).");
  }
  const permissions = input.permissions.filter((p): p is Permission =>
    (SITE_PERMISSIONS as Permission[]).includes(p),
  );
  if (permissions.length === 0) {
    throw new Error("Grant at least one permission.");
  }

  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const record: ApiTokenRecord = {
    id: randomUUID(),
    name,
    tokenHash: hashToken(token),
    displayPrefix: token.slice(0, TOKEN_PREFIX.length + 8),
    permissions,
    siteIds: input.siteIds,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    expiresAt: input.expiresAt,
    lastUsedAt: null,
    revokedAt: null,
  };

  await mutateStore((store) => {
    store.tokens.push(record);
    return null;
  });

  return { token, record: toSummary(record) };
}

export async function revokeApiToken(id: string): Promise<ApiTokenSummary | null> {
  return mutateStore((store) => {
    const record = store.tokens.find((t) => t.id === id);
    if (!record || record.revokedAt) return null;
    record.revokedAt = new Date().toISOString();
    return toSummary(record);
  });
}

/**
 * Resolve an Authorization header value to a synthetic session, or null.
 * Site scoping: the token's siteIds (or every enabled site when unscoped)
 * become accessibleSiteIds, and each carries the token's permission set.
 * Global permissions stay empty, so a token only passes per-site checks.
 */
export async function getSessionForBearerToken(
  authorizationHeader: string | null,
): Promise<AuthSession | null> {
  if (!authorizationHeader?.startsWith("Bearer ")) return null;
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token.startsWith(TOKEN_PREFIX) || token.length < 20) return null;

  const tokenHash = hashToken(token);
  const store = await readStore();
  const record = store.tokens.find((t) => t.tokenHash === tokenHash);
  if (!record || record.revokedAt) return null;
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  // Throttled last-used stamp — one store write per hour per token, not one
  // per request.
  const lastUsed = record.lastUsedAt ? new Date(record.lastUsedAt).getTime() : 0;
  if (Date.now() - lastUsed >= LAST_USED_UPDATE_MS) {
    void mutateStore((s) => {
      const t = s.tokens.find((entry) => entry.id === record.id);
      if (t) t.lastUsedAt = new Date().toISOString();
    }).catch(() => {});
  }

  const scopedSiteIds =
    record.siteIds.length > 0
      ? record.siteIds
      : (await listEnabledSites()).map((site) => site.id);
  const sitePermissions: Record<string, Permission[]> = {};
  for (const siteId of scopedSiteIds) {
    sitePermissions[siteId] = [...record.permissions];
  }

  return {
    id: `api-token-session:${record.id}`,
    expiresAt:
      record.expiresAt ?? new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    user: {
      id: `api-token:${record.id}`,
      email: `api-token:${record.name}`,
      name: `API token "${record.name}"`,
      role: "operator",
      permissions: [],
      accessibleSiteIds: scopedSiteIds,
      sitePermissions,
      groupIds: [],
      hasTwoFactor: false,
    },
  };
}
