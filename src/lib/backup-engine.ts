import "server-only";

import {
  listBackupPolicies,
  markPolicyRun,
  type BackupPolicy,
} from "@/lib/backup-policies";
import {
  createBackupRun,
  finalizeBackupRun,
  updateBackupRun,
  type BackupRunRecord,
  type BackupWorkloadResult,
} from "@/lib/backup-run-log";
import {
  deleteBackup,
  getDeploymentIndex,
  getTaskSnapshot,
  listBackupStoragePools,
  listBackupsForVm,
  triggerBackup,
  type LiveDeployment,
} from "@/lib/proxmox";
import { extractManagedTagSlugs } from "@/lib/tag-utils";

// In-flight state is stored on globalThis so it survives Next.js HMR without losing progress
type InFlightVm = {
  node: string;
  policyId: string;
  startedAt: number;
  upid: string;
  vmid: number;
};

type ActivePolicyRun = {
  completed: BackupWorkloadResult[];
  pending: LiveDeployment[];
  policyId: string;
  runId: string;
  storage: string;
  compression: string;
  mode: string;
  retentionCount: number;
};

type BackupEngineState = {
  activeRuns: Map<string, ActivePolicyRun>;
  inFlightVm: InFlightVm | null;
  backingUpVmids: Set<number>;
};

const globalForBackup = globalThis as typeof globalThis & {
  __tainerBackupEngine?: BackupEngineState;
};

function getEngineState(): BackupEngineState {
  if (!globalForBackup.__tainerBackupEngine) {
    globalForBackup.__tainerBackupEngine = {
      activeRuns: new Map(),
      backingUpVmids: new Set(),
      inFlightVm: null,
    };
  }
  return globalForBackup.__tainerBackupEngine;
}

function filterDeploymentsByScope(
  deployments: LiveDeployment[],
  policy: BackupPolicy,
): LiveDeployment[] {
  if (policy.scope === "all" || policy.tagSlugs.length === 0) {
    return deployments;
  }

  const slugSet = new Set(policy.tagSlugs);
  return deployments.filter((d) => {
    const managedSlugs = extractManagedTagSlugs(d.tagList);
    return managedSlugs.some((slug) => slugSet.has(slug));
  });
}

async function enforceRetention(
  vmid: number,
  node: string,
  storage: string,
  retentionCount: number,
): Promise<string[]> {
  if (retentionCount <= 0) return [];

  const { archives } = await listBackupsForVm(node, vmid);
  const storageArchives = archives
    .filter((a) => a.storage === storage)
    .sort((a, b) => b.ctime - a.ctime);

  if (storageArchives.length <= retentionCount) return [];

  const toDelete = storageArchives.slice(retentionCount);
  const pruned: string[] = [];

  for (const archive of toDelete) {
    try {
      await deleteBackup(archive.node, archive.storage, archive.volid);
      pruned.push(archive.volid);
    } catch (err) {
      console.error(`[backup-engine] Failed to prune ${archive.volid}:`, err);
    }
  }

  return pruned;
}

async function startVmBackup(
  run: ActivePolicyRun,
  deployment: LiveDeployment,
  state: BackupEngineState,
): Promise<void> {
  try {
    const upid = await triggerBackup(deployment.node, deployment.vmid, run.storage, {
      compress: run.compression === "none" ? undefined : run.compression,
      mode: run.mode,
    });

    state.inFlightVm = {
      node: deployment.node,
      policyId: run.policyId,
      startedAt: Date.now(),
      upid,
      vmid: deployment.vmid,
    };
    state.backingUpVmids.add(deployment.vmid);
  } catch (err) {
    const result: BackupWorkloadResult = {
      archiveVolid: null,
      durationSeconds: null,
      errorMessage: err instanceof Error ? err.message : "Failed to start backup",
      name: deployment.name,
      node: deployment.node,
      prunedArchives: [],
      status: "error",
      type: deployment.type,
      upid: null,
      vmid: deployment.vmid,
    };
    run.completed.push(result);
  }
}

async function pollInFlightVm(state: BackupEngineState): Promise<void> {
  if (!state.inFlightVm) return;

  const { node, policyId, startedAt, upid, vmid } = state.inFlightVm;

  try {
    const snapshot = await getTaskSnapshot(node, upid);

    if (!snapshot.completed) return;

    const run = state.activeRuns.get(policyId);
    if (!run) {
      state.inFlightVm = null;
      state.backingUpVmids.delete(vmid);
      return;
    }

    const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
    const isSuccess = snapshot.status === "success";

    let pruned: string[] = [];
    if (isSuccess && run.retentionCount > 0) {
      try {
        pruned = await enforceRetention(vmid, node, run.storage, run.retentionCount);
      } catch (err) {
        console.error(`[backup-engine] Retention enforcement failed for VMID ${vmid}:`, err);
      }
    }

    const result: BackupWorkloadResult = {
      archiveVolid: null,
      durationSeconds,
      errorMessage: isSuccess ? null : (snapshot.message || "Backup task failed"),
      name: run.pending.find((d) => d.vmid === vmid)?.name ?? `VMID ${vmid}`,
      node,
      prunedArchives: pruned,
      status: isSuccess ? "success" : "error",
      type: run.pending.find((d) => d.vmid === vmid)?.type ?? "lxc",
      upid,
      vmid,
    };

    run.completed.push(result);

    await updateBackupRun(run.runId, {
      workloads: run.completed,
    });

    state.inFlightVm = null;
    state.backingUpVmids.delete(vmid);
  } catch (err) {
    console.error(`[backup-engine] Failed to poll task ${upid}:`, err);
    // Don't clear in-flight — will retry next tick
  }
}

async function advanceActiveRuns(state: BackupEngineState): Promise<void> {
  // only one VM at a time
  if (state.inFlightVm) return;

  for (const [policyId, run] of state.activeRuns) {
    const nextDeployment = run.pending.find(
      (d) =>
        !run.completed.some((c) => c.vmid === d.vmid) &&
        !state.backingUpVmids.has(d.vmid),
    );

    if (nextDeployment) {
      await startVmBackup(run, nextDeployment, state);
      return; // one at a time
    }

    if (run.completed.length >= run.pending.length || run.pending.length === 0) {
      await finalizeBackupRun(run.runId);
      await markPolicyRun(run.policyId, new Date().toISOString());
      state.activeRuns.delete(policyId);
      console.log(`[backup-engine] Policy run ${run.runId} finalized`);
    }
  }
}

async function startPolicyRun(
  policy: BackupPolicy,
  deployments: LiveDeployment[],
  trigger: "scheduled" | "manual",
  triggeredBy: string | null,
  state: BackupEngineState,
): Promise<BackupRunRecord> {
  const scopedDeployments = filterDeploymentsByScope(deployments, policy);

  const run = await createBackupRun(
    policy.id,
    policy.name,
    trigger,
    triggeredBy,
    scopedDeployments.length,
  );

  if (scopedDeployments.length === 0) {
    await finalizeBackupRun(run.id);
    await markPolicyRun(policy.id, new Date().toISOString());
    return run;
  }

  state.activeRuns.set(policy.id, {
    completed: [],
    compression: policy.compression,
    mode: policy.mode,
    pending: scopedDeployments,
    policyId: policy.id,
    retentionCount: policy.retentionCount,
    runId: run.id,
    storage: policy.storage,
  });

  return run;
}

export async function runBackupTick(): Promise<{
  errors: string[];
  policiesStarted: number;
  runsActive: number;
}> {
  const state = getEngineState();
  const errors: string[] = [];
  let policiesStarted = 0;

  await pollInFlightVm(state);
  await advanceActiveRuns(state);

  try {
    const policies = await listBackupPolicies();
    const now = Date.now();

    const duePolicies = policies.filter((p) => {
      if (!p.enabled) return false;
      if (state.activeRuns.has(p.id)) return false;
      if (!p.storage) return false;
      if (!p.nextRunAt) return true;
      return now >= new Date(p.nextRunAt).getTime();
    });

    if (duePolicies.length > 0) {
      const { deployments } = await getDeploymentIndex();
      const { pools } = await listBackupStoragePools();
      const healthyStorages = new Set(
        pools.filter((p) => p.issues.length === 0).map((p) => p.storage),
      );

      for (const policy of duePolicies) {
        if (!healthyStorages.has(policy.storage)) {
          errors.push(`Policy "${policy.name}": target storage "${policy.storage}" is unhealthy, skipping`);
          continue;
        }

        try {
          await startPolicyRun(policy, deployments, "scheduled", null, state);
          policiesStarted++;
        } catch (err) {
          errors.push(`Policy "${policy.name}": ${err instanceof Error ? err.message : "failed to start"}`);
        }
      }
    }
  } catch (err) {
    errors.push(`Backup tick error: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  return {
    errors,
    policiesStarted,
    runsActive: state.activeRuns.size,
  };
}

export async function triggerManualBackupRun(
  policyId: string,
  triggeredBy: string,
): Promise<BackupRunRecord | null> {
  const state = getEngineState();

  if (state.activeRuns.has(policyId)) {
    throw new Error("This policy already has an active backup run.");
  }

  const policies = await listBackupPolicies();
  const policy = policies.find((p) => p.id === policyId);
  if (!policy) return null;

  if (!policy.storage) {
    throw new Error("Policy has no target storage configured.");
  }

  const { pools } = await listBackupStoragePools();
  const healthyStorages = new Set(
    pools.filter((p) => p.issues.length === 0).map((p) => p.storage),
  );

  if (!healthyStorages.has(policy.storage)) {
    throw new Error(`Target storage "${policy.storage}" is unhealthy.`);
  }

  const { deployments } = await getDeploymentIndex();

  return startPolicyRun(policy, deployments, "manual", triggeredBy, state);
}

export function getBackupEngineStatus(): {
  activeRunCount: number;
  inFlightVmid: number | null;
} {
  const state = getEngineState();
  return {
    activeRunCount: state.activeRuns.size,
    inFlightVmid: state.inFlightVm?.vmid ?? null,
  };
}
