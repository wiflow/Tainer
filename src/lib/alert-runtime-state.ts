import "server-only";

import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import {
  createStoreMutator,
  readJsonFileCached,
  writeJsonFileAtomically,
} from "@/lib/store-utils";

export type AlertCategory =
  | "backup-stale"
  | "deployment-high-cpu"
  | "deployment-high-disk"
  | "deployment-high-memory"
  | "deployment-offline"
  | "storage-low-space"
  | "storage-unhealthy"
  | "system";

export type AlertSeverity = "error" | "info" | "warning";

export type AlertRuntimeEntry = {
  active: boolean;
  category: AlertCategory;
  detailsLabel: string | null;
  detailsUrl: string | null;
  firstObservedAt: string;
  key: string;
  lastMessage: string;
  lastNotifiedAt: string | null;
  lastObservedAt: string;
  lastResolvedAt: string | null;
  notificationCount: number;
  policyName: string | null;
  severity: AlertSeverity;
  subject: string;
  title: string;
};

type AlertRuntimeStore = {
  alerts: Record<string, AlertRuntimeEntry>;
};

const INITIAL_STORE: AlertRuntimeStore = {
  alerts: {},
};

async function readStore(): Promise<AlertRuntimeStore> {
  return readJsonFileCached(
    await resolveSiteDataFilePathFromContext("alert-runtime-state.json"),
    {
      fallback: () => INITIAL_STORE,
      normalize: (parsed) => {
        const store = parsed as Partial<AlertRuntimeStore>;
        const alerts =
          store.alerts && typeof store.alerts === "object"
            ? store.alerts
            : {};

        return {
          alerts: Object.fromEntries(
            Object.entries(alerts).map(([key, entry]) => {
              const value = entry as Partial<AlertRuntimeEntry>;

              return [
                key,
                {
                  active: Boolean(value.active),
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
                  detailsLabel:
                    typeof value.detailsLabel === "string" && value.detailsLabel.trim()
                      ? value.detailsLabel
                      : null,
                  detailsUrl:
                    typeof value.detailsUrl === "string" && value.detailsUrl.trim()
                      ? value.detailsUrl
                      : null,
                  firstObservedAt:
                    typeof value.firstObservedAt === "string"
                      ? value.firstObservedAt
                      : new Date(0).toISOString(),
                  key,
                  lastMessage: typeof value.lastMessage === "string" ? value.lastMessage : "",
                  lastNotifiedAt:
                    typeof value.lastNotifiedAt === "string" ? value.lastNotifiedAt : null,
                  lastObservedAt:
                    typeof value.lastObservedAt === "string"
                      ? value.lastObservedAt
                      : new Date(0).toISOString(),
                  lastResolvedAt:
                    typeof value.lastResolvedAt === "string" ? value.lastResolvedAt : null,
                  notificationCount:
                    typeof value.notificationCount === "number" ? value.notificationCount : 0,
                  policyName:
                    typeof value.policyName === "string" && value.policyName.trim()
                      ? value.policyName
                      : null,
                  severity:
                    value.severity === "error" || value.severity === "info"
                      ? value.severity
                      : "warning",
                  subject: typeof value.subject === "string" ? value.subject : key,
                  title: typeof value.title === "string" ? value.title : key,
                } satisfies AlertRuntimeEntry,
              ];
            }),
          ),
        };
      },
    },
  );
}

async function writeStore(store: AlertRuntimeStore) {
  const filePath = await resolveSiteDataFilePathFromContext("alert-runtime-state.json");
  await writeJsonFileAtomically(filePath, store);
}

export const mutateAlertRuntimeState = createStoreMutator(
  "alert-runtime-state",
  readStore,
  writeStore,
);

export async function getActiveAlertRuntimeEntries() {
  const store = await readStore();

  return Object.values(store.alerts)
    .filter((entry) => entry.active)
    .sort((left, right) => left.firstObservedAt.localeCompare(right.firstObservedAt));
}

export async function clearAllActiveAlerts(): Promise<AlertRuntimeEntry[]> {
  return mutateAlertRuntimeState((store) => {
    const cleared: AlertRuntimeEntry[] = [];
    const nowIso = new Date().toISOString();

    for (const entry of Object.values(store.alerts)) {
      if (entry.active) {
        cleared.push({ ...entry });
        entry.active = false;
        entry.lastResolvedAt = nowIso;
      }
    }

    return cleared;
  });
}

export async function clearSingleAlert(key: string): Promise<AlertRuntimeEntry | null> {
  return mutateAlertRuntimeState((store) => {
    const entry = store.alerts[key];
    if (!entry || !entry.active) return null;

    const snapshot = { ...entry };
    entry.active = false;
    entry.lastResolvedAt = new Date().toISOString();
    return snapshot;
  });
}
