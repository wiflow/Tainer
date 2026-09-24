import "server-only";

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";
import type { AlertCategory, AlertSeverity } from "@/lib/alert-runtime-state";

// Assumes a single Tainer instance writes to the data directory.

export type NotificationState = "cleared" | "firing" | "resolved" | "test";

export type NotificationEntry = {
  alertKey: string;
  category: AlertCategory;
  clearedBy: string | null;
  detailsLabel: string | null;
  detailsUrl: string | null;
  durationMinutes: number | null;
  firedAt: string;
  id: string;
  message: string;
  policyName: string | null;
  severity: AlertSeverity;
  state: NotificationState;
  subject: string;
  title: string;
};

type NotificationStore = {
  entries: NotificationEntry[];
};

const MAX_ENTRIES = 500;

async function readStore(): Promise<NotificationStore> {
  try {
    const raw = await readFile(await resolveSiteDataFilePathFromContext("notification-log.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<NotificationStore>;

    return {
      entries: Array.isArray(parsed.entries)
        ? parsed.entries.map((entry) => {
            const value = entry as Partial<NotificationEntry>;

            return {
              alertKey: typeof value.alertKey === "string" ? value.alertKey : "system",
              category:
                value.category === "backup-stale" ||
                value.category === "deployment-high-cpu" ||
                value.category === "deployment-high-disk" ||
                value.category === "deployment-high-memory" ||
                value.category === "deployment-offline" ||
                value.category === "storage-low-space" ||
                value.category === "storage-unhealthy"
                  ? value.category
                  : "system",
              clearedBy:
                typeof value.clearedBy === "string" && value.clearedBy.trim()
                  ? value.clearedBy
                  : null,
              detailsLabel:
                typeof value.detailsLabel === "string" && value.detailsLabel.trim()
                  ? value.detailsLabel
                  : null,
              detailsUrl:
                typeof value.detailsUrl === "string" && value.detailsUrl.trim()
                  ? value.detailsUrl
                  : null,
              durationMinutes:
                typeof value.durationMinutes === "number" && Number.isFinite(value.durationMinutes)
                  ? value.durationMinutes
                  : null,
              firedAt: typeof value.firedAt === "string" ? value.firedAt : new Date(0).toISOString(),
              id: typeof value.id === "string" ? value.id : randomUUID(),
              message: typeof value.message === "string" ? value.message : "",
              policyName:
                typeof value.policyName === "string" && value.policyName.trim()
                  ? value.policyName
                  : null,
              severity:
                value.severity === "error" || value.severity === "info"
                  ? value.severity
                  : "warning",
              state:
                value.state === "resolved" || value.state === "test" || value.state === "cleared"
                  ? value.state
                  : "firing",
              subject:
                typeof value.subject === "string"
                  ? value.subject
                  : typeof value.alertKey === "string"
                    ? value.alertKey
                    : "Alert",
              title:
                typeof value.title === "string" && value.title.trim()
                  ? value.title
                  : typeof value.subject === "string" && value.subject.trim()
                    ? value.subject
                    : "Alert",
            } satisfies NotificationEntry;
          })
        : [],
    };
  } catch {
    return { entries: [] };
  }
}

async function writeStore(store: NotificationStore): Promise<void> {
  const filePath = await resolveSiteDataFilePathFromContext("notification-log.json");
  await writeJsonFileAtomically(filePath, store);
}

const mutateNotificationStore = createStoreMutator(
  "notification-log",
  readStore,
  writeStore,
);

export async function recordNotification(
  entry: Omit<NotificationEntry, "clearedBy" | "firedAt" | "id" | "policyName"> & {
    clearedBy?: string | null;
    firedAt?: string;
    id?: string;
    policyName?: string | null;
  },
): Promise<NotificationEntry> {
  return mutateNotificationStore((store) => {
    const nextEntry: NotificationEntry = {
      ...entry,
      clearedBy: entry.clearedBy ?? null,
      firedAt: entry.firedAt ?? new Date().toISOString(),
      id: entry.id ?? randomUUID(),
      policyName: entry.policyName ?? null,
    };

    store.entries.unshift(nextEntry);

    if (store.entries.length > MAX_ENTRIES) {
      store.entries = store.entries.slice(0, MAX_ENTRIES);
    }

    return nextEntry;
  });
}

export async function getRecentNotifications(limit = 50): Promise<NotificationEntry[]> {
  const store = await readStore();
  return store.entries.slice(0, limit);
}

export async function clearAlertHistory(): Promise<number> {
  return mutateNotificationStore((store) => {
    const count = store.entries.length;
    store.entries = [];
    return count;
  });
}
