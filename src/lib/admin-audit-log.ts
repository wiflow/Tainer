import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import { writeJsonFileAtomically } from "@/lib/store-utils";

export type AdminAuditAction =
  | "user-created"
  | "user-deleted"
  | "user-role-changed"
  | "password-changed"
  | "password-reset-requested"
  | "two-factor-enabled"
  | "two-factor-disabled"
  | "settings-updated"
  | "template-created"
  | "template-updated"
  | "template-deleted"
  | "ip-pool-created"
  | "ip-pool-deleted"
  | "alert-settings-updated"
  | "alert-test-sent"
  | "sessions-revoked"
  | "session-revoked"
  | "admin-password-reset"
  | "user-permissions-updated"
  | "group-created"
  | "group-updated"
  | "group-deleted"
  | "user-groups-updated"
  | "sso-login"
  | "sso-user-provisioned"
  | "sso-provider-created"
  | "sso-provider-updated"
  | "sso-provider-deleted";

export type AdminAuditEntry = {
  action: AdminAuditAction;
  actorEmail: string;
  actorName: string;
  id: string;
  message: string;
  recordedAt: string;
  targetEmail?: string;
};

const MAX_ENTRIES = 5000;
const DATA_FILE = "admin-audit-log.json";

type AdminAuditLogStore = {
  entries: AdminAuditEntry[];
};

async function readStore(): Promise<AdminAuditLogStore> {
  try {
    const raw = await readFile(await resolveDataFilePath(DATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<AdminAuditLogStore>;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { entries: [] };
  }
}

async function writeStore(store: AdminAuditLogStore) {
  const filePath = await resolveDataFilePath(DATA_FILE);
  await writeJsonFileAtomically(filePath, store);
}

export async function recordAdminAudit(
  input: Omit<AdminAuditEntry, "id" | "recordedAt">,
) {
  const store = await readStore();
  const entry: AdminAuditEntry = {
    ...input,
    id: randomUUID(),
    recordedAt: new Date().toISOString(),
  };

  store.entries.unshift(entry);
  if (store.entries.length > MAX_ENTRIES) {
    store.entries = store.entries.slice(0, MAX_ENTRIES);
  }

  await writeStore(store);
  return entry;
}

export async function getAdminAuditLog(
  limit = 100,
): Promise<AdminAuditEntry[]> {
  const store = await readStore();
  return store.entries.slice(0, limit);
}
