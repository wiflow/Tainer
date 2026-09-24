import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

export type DeploymentActivityAction =
  | "start"
  | "stop"
  | "restart"
  | "shutdown"
  | "created"
  | "deleted"
  | "env-updated"
  | "resources-updated"
  | "network-updated"
  | "migrated"
  | "backup-created"
  | "backup-restored"
  | "port-scanned"
  | "snapshot-created"
  | "snapshot-deleted"
  | "snapshot-rollback"
  | "firewall-updated";

export type DeploymentActivityEntry = {
  action: DeploymentActivityAction;
  deploymentId: string;
  id: string;
  message: string;
  recordedAt: string;
  userEmail: string;
  userName: string;
  vmid: number;
};

const MAX_ENTRIES = 2000;
const DATA_FILE = "deployment-activity-log.json";

type DeploymentActivityLogStore = {
  entries: DeploymentActivityEntry[];
};

async function readStore(): Promise<DeploymentActivityLogStore> {
  try {
    const raw = await readFile(await resolveSiteDataFilePathFromContext(DATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<DeploymentActivityLogStore>;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { entries: [] };
  }
}

async function writeStore(store: DeploymentActivityLogStore) {
  const filePath = await resolveSiteDataFilePathFromContext(DATA_FILE);
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("deployment-activity-log", readStore, writeStore);

export async function recordDeploymentActivity(
  input: Omit<DeploymentActivityEntry, "id" | "recordedAt">,
) {
  return mutateStore((store) => {
    const entry: DeploymentActivityEntry = {
      ...input,
      id: randomUUID(),
      recordedAt: new Date().toISOString(),
    };

    store.entries.unshift(entry);
    if (store.entries.length > MAX_ENTRIES) {
      store.entries = store.entries.slice(0, MAX_ENTRIES);
    }

    return entry;
  });
}

export async function getDeploymentActivities(
  deploymentId: string,
  limit = 50,
): Promise<DeploymentActivityEntry[]> {
  const store = await readStore();
  return store.entries
    .filter((entry) => entry.deploymentId === deploymentId)
    .slice(0, limit);
}

export async function clearDeploymentActivities(deploymentId: string) {
  await mutateStore((store) => {
    store.entries = store.entries.filter(
      (entry) => entry.deploymentId !== deploymentId,
    );
  });
}
