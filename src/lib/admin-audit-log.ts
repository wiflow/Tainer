import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

export type AdminAuditAction =
  | "user-created"
  | "user-deleted"
  | "user-role-changed"
  | "password-changed"
  | "password-reset-requested"
  | "password-reset-completed"
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
  | "login-success"
  | "login-failure"
  | "login-password-verified"
  | "two-factor-failure"
  | "admin-bootstrapped"
  | "guest-shell-step-up"
  | "guest-shell-step-up-failure"
  | "sso-login"
  | "sso-user-provisioned"
  | "sso-login-failure"
  | "sso-provider-created"
  | "sso-provider-updated"
  | "sso-provider-deleted"
  | "ldap-login-success"
  | "ldap-login-failure"
  | "ldap-user-provisioned"
  | "ldap-config-updated"
  | "ldap-config-deleted"
  | "integration-configured"
  | "integration-updated"
  | "integration-removed"
  | "lldp-token-issued"
  | "lldp-token-revoked"
  | "lldp-snapshots-cleared"
  | "lldp-ingest-rejected"
  | "lldp-annotation-updated"
  | "lldp-annotation-removed"
  | "login-lockout-cleared"
  | "copilot-tool-approved"
  | "copilot-tool-denied"
  | "copilot-tool-executed"
  | "copilot-tool-failed"
  | "copilot-budget-exceeded"
  | "copilot-settings-updated"
  | "state-backup-created"
  | "state-backup-downloaded"
  | "state-backup-settings-updated"
  | "api-token-created"
  | "api-token-revoked";

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

// Events that callers can trigger without a session are capped separately so
// they can never push authenticated admin events out of the log.
const UNAUTHENTICATED_ACTIONS = new Set<AdminAuditAction>([
  "ldap-login-failure",
  "lldp-ingest-rejected",
  "login-failure",
  "login-password-verified",
  "password-reset-requested",
  "two-factor-failure",
]);
const MAX_UNAUTHENTICATED_ENTRIES = 1000;

const THROTTLE_WINDOW_MS = 15 * 60_000;
const THROTTLE_MAX_PER_KEY = 5;
const THROTTLE_MAX_PER_WINDOW = 200;
const THROTTLE_MAX_KEYS = 2000;

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

const mutateStore = createStoreMutator("admin-audit-log", readStore, writeStore);

export async function recordAdminAudit(
  input: Omit<AdminAuditEntry, "id" | "recordedAt">,
) {
  // Serialise read-modify-write: without the queue two concurrent calls can
  // both read the current store, append independently, and the second write
  // silently overwrites the first — losing audit entries during the very
  // bursts (parallel admin actions, mass user import, incident response)
  // when the log is most useful.
  return mutateStore((store) => {
    const entry: AdminAuditEntry = {
      ...input,
      id: randomUUID(),
      recordedAt: new Date().toISOString(),
    };

    store.entries.unshift(entry);
    if (UNAUTHENTICATED_ACTIONS.has(entry.action)) {
      let unauthenticated = 0;
      store.entries = store.entries.filter(
        (existing) =>
          !UNAUTHENTICATED_ACTIONS.has(existing.action) ||
          ++unauthenticated <= MAX_UNAUTHENTICATED_ENTRIES,
      );
    }
    if (store.entries.length > MAX_ENTRIES) {
      store.entries = store.entries.slice(0, MAX_ENTRIES);
    }

    return entry;
  });
}

const throttle = {
  counts: new Map<string, number>(),
  recorded: 0,
  suppressed: new Map<AdminAuditAction, number>(),
  windowStart: 0,
};

/**
 * Records at most a few entries per key and a fixed number overall per
 * window. Use for events an unauthenticated caller can repeat at will; the
 * number of dropped entries is logged once the next window starts.
 */
export async function recordThrottledAdminAudit(
  key: string,
  input: Omit<AdminAuditEntry, "id" | "recordedAt">,
) {
  const now = Date.now();

  if (now - throttle.windowStart >= THROTTLE_WINDOW_MS) {
    const suppressed = [...throttle.suppressed];
    throttle.counts.clear();
    throttle.recorded = 0;
    throttle.suppressed.clear();
    throttle.windowStart = now;

    for (const [action, count] of suppressed) {
      await recordAdminAudit({
        action,
        actorEmail: "system",
        actorName: "Audit log",
        message: `${count} similar event${count === 1 ? " was" : "s were"} not recorded individually in the previous ${THROTTLE_WINDOW_MS / 60_000} minutes.`,
      });
    }
  }

  const count = throttle.counts.get(key) ?? 0;
  if (
    count >= THROTTLE_MAX_PER_KEY ||
    throttle.recorded >= THROTTLE_MAX_PER_WINDOW ||
    (count === 0 && throttle.counts.size >= THROTTLE_MAX_KEYS)
  ) {
    throttle.suppressed.set(input.action, (throttle.suppressed.get(input.action) ?? 0) + 1);
    return null;
  }

  throttle.counts.set(key, count + 1);
  throttle.recorded += 1;
  return recordAdminAudit(input);
}

export async function getAdminAuditLog(
  limit = 100,
): Promise<AdminAuditEntry[]> {
  const store = await readStore();
  return store.entries.slice(0, limit);
}
