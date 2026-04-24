import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { writeJsonFileAtomically } from "@/lib/store-utils";

export type BackupWorkloadStatus = "success" | "error" | "skipped";

export type BackupWorkloadResult = {
  archiveVolid: string | null;
  durationSeconds: number | null;
  errorMessage: string | null;
  name: string;
  node: string;
  prunedArchives: string[];
  status: BackupWorkloadStatus;
  type: "lxc" | "qemu";
  upid: string | null;
  vmid: number;
};

export type BackupRunStatus = "success" | "error" | "partial" | "running";

export type BackupRunRecord = {
  completedAt: string | null;
  errorCount: number;
  id: string;
  policyId: string;
  policyName: string;
  prunedCount: number;
  startedAt: string;
  status: BackupRunStatus;
  successCount: number;
  totalWorkloads: number;
  trigger: "scheduled" | "manual";
  triggeredBy: string | null;
  workloads: BackupWorkloadResult[];
};

const MAX_ENTRIES = 500;

type BackupRunLogStore = {
  runs: BackupRunRecord[];
};

async function readStore(): Promise<BackupRunLogStore> {
  try {
    const raw = await readFile(
      await resolveSiteDataFilePathFromContext("backup-run-log.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<BackupRunLogStore>;

    return {
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
  } catch {
    return { runs: [] };
  }
}

async function writeStore(store: BackupRunLogStore) {
  const filePath = await resolveSiteDataFilePathFromContext("backup-run-log.json");
  await writeJsonFileAtomically(filePath, store);
}

export async function listBackupRuns(limit = 50): Promise<BackupRunRecord[]> {
  const store = await readStore();
  return store.runs
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, limit);
}

export async function getBackupRun(id: string): Promise<BackupRunRecord | null> {
  const store = await readStore();
  return store.runs.find((r) => r.id === id) ?? null;
}

export async function createBackupRun(
  policyId: string,
  policyName: string,
  trigger: "scheduled" | "manual",
  triggeredBy: string | null,
  totalWorkloads: number,
): Promise<BackupRunRecord> {
  const store = await readStore();

  const run: BackupRunRecord = {
    completedAt: null,
    errorCount: 0,
    id: randomUUID(),
    policyId,
    policyName,
    prunedCount: 0,
    startedAt: new Date().toISOString(),
    status: "running",
    successCount: 0,
    totalWorkloads,
    trigger,
    triggeredBy,
    workloads: [],
  };

  store.runs.unshift(run);

  if (store.runs.length > MAX_ENTRIES) {
    store.runs = store.runs.slice(0, MAX_ENTRIES);
  }

  await writeStore(store);
  return run;
}

export async function updateBackupRun(
  id: string,
  update: Partial<BackupRunRecord>,
): Promise<void> {
  const store = await readStore();
  const run = store.runs.find((r) => r.id === id);
  if (!run) return;

  Object.assign(run, update);
  await writeStore(store);
}

export async function finalizeBackupRun(id: string): Promise<void> {
  const store = await readStore();
  const run = store.runs.find((r) => r.id === id);
  if (!run) return;

  run.completedAt = new Date().toISOString();
  run.successCount = run.workloads.filter((w) => w.status === "success").length;
  run.errorCount = run.workloads.filter((w) => w.status === "error").length;
  run.prunedCount = run.workloads.reduce((sum, w) => sum + w.prunedArchives.length, 0);

  if (run.errorCount === 0) {
    run.status = "success";
  } else if (run.successCount > 0) {
    run.status = "partial";
  } else {
    run.status = "error";
  }

  await writeStore(store);
}
