import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import type { AuthSession } from "@/lib/auth";
import { SITE_PERMISSIONS, type Permission } from "@/lib/permissions";
import { listEnabledSites } from "@/lib/site-store";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

// Token sessions always get the operator role and only site permissions.

const DATA_FILE = "api-tokens.json";
const TOKEN_PREFIX = "tnr_";
const LAST_USED_UPDATE_MS = 60 * 60 * 1000;

export type ApiTokenRecord = {
  id: string;
  name: string;
  tokenHash: string;
  displayPrefix: string;
  permissions: Permission[];
  /** Empty means all enabled sites. */
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
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
      return { tokens: [] };
    }
    throw error;
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
