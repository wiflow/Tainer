import { getAlertSettings } from "@/lib/alert-settings";
import { runAlertCheck } from "@/lib/alert-engine";
import { runBackupTick } from "@/lib/backup-engine";
import { runConfigSnapshotTickAllSites } from "@/lib/config-snapshot-runner";
import { getHeartbeatSettings } from "@/lib/heartbeat-settings";
import { runHeartbeatCheck, shouldRunHeartbeat } from "@/lib/heartbeat-engine";
import { runStateBackupTick } from "@/lib/state-backup";

type SchedulerState = {
  backupLastResult: string | null;
  configSnapshotLastResult: string | null;
  heartbeatLastResult: string | null;
  intervalId: ReturnType<typeof setInterval> | null;
  lastCheckAt: string | null;
  lastError: string | null;
  lastResult: string | null;
  running: boolean;
  startedAt: string | null;
  tickCount: number;
};

const TICK_INTERVAL_MS = 30_000; // 30 seconds

const globalForScheduler = globalThis as typeof globalThis & {
  __tainerAlertScheduler?: SchedulerState;
};

function getState(): SchedulerState {
  if (!globalForScheduler.__tainerAlertScheduler) {
    globalForScheduler.__tainerAlertScheduler = {
      backupLastResult: null,
      configSnapshotLastResult: null,
      heartbeatLastResult: null,
      intervalId: null,
      lastCheckAt: null,
      lastError: null,
      lastResult: null,
      running: false,
      startedAt: null,
      tickCount: 0,
    };
  }
  return globalForScheduler.__tainerAlertScheduler;
}

async function tick() {
  const state = getState();
  state.tickCount++;

  // The four checks (alerts, backups, config snapshots, heartbeat) are
  // independent — none reads what the others wrote. Run them in parallel so
  // the worst-case tick is the slowest single check, not the sum of all four.
  // Each block has its own try/catch, so a failure in one does not affect the
  // others. We collect errors and apply them to `state` after all settle, in
  // a deterministic order, so the displayed `lastError` is stable.

  const collectedErrors: string[] = [];

  const runAlerts = async () => {
    try {
      const settings = await getAlertSettings();
      if (!settings.enabled) return;

      const result = await runAlertCheck();
      state.lastCheckAt = new Date().toISOString();
      state.lastResult =
        result.policiesEvaluated > 0
          ? `${result.policiesEvaluated} policies, ${result.alertsFired} fired, ${result.resolvedAlerts} resolved`
          : "No policies due";
      if (result.errors.length > 0) collectedErrors.push(result.errors[0]);
    } catch (error) {
      state.lastResult = null;
      collectedErrors.push(error instanceof Error ? error.message : "Scheduler tick failed");
    }
  };

  const runBackups = async () => {
    try {
      const backupResult = await runBackupTick();
      if (backupResult.runsActive > 0 || backupResult.policiesStarted > 0) {
        state.backupLastResult = `${backupResult.runsActive} active, ${backupResult.policiesStarted} started`;
      }
      if (backupResult.errors.length > 0) collectedErrors.push(backupResult.errors[0]);
    } catch (error) {
      collectedErrors.push(error instanceof Error ? error.message : "Backup tick failed");
    }
  };

  const runConfigSnapshots = async () => {
    try {
      const csResult = await runConfigSnapshotTickAllSites();
      if (csResult.snapshotsTaken > 0 || csResult.policiesEvaluated > 0) {
        state.configSnapshotLastResult = `${csResult.sitesProcessed} site(s), ${csResult.policiesEvaluated} policies, ${csResult.snapshotsTaken} snapshot(s) taken`;
      }
      if (csResult.errors.length > 0) collectedErrors.push(csResult.errors[0]);
    } catch (error) {
      collectedErrors.push(
        error instanceof Error ? error.message : "Config snapshot tick failed",
      );
    }
  };

  const runHeartbeat = async () => {
    try {
      const hbSettings = await getHeartbeatSettings();
      if (!shouldRunHeartbeat(hbSettings)) return;
      const hbResult = await runHeartbeatCheck();
      if (hbResult.sitesChecked > 0) {
        state.heartbeatLastResult = `${hbResult.sitesChecked} sites, ${hbResult.alertsFired} fired, ${hbResult.resolvedAlerts} resolved`;
      }
      if (hbResult.errors.length > 0) collectedErrors.push(hbResult.errors[0]);
    } catch (error) {
      collectedErrors.push(error instanceof Error ? error.message : "Heartbeat tick failed");
    }
  };

  const runStateBackup = async () => {
    try {
      const result = await runStateBackupTick();
      if (result.error) collectedErrors.push(`State backup: ${result.error}`);
    } catch (error) {
      collectedErrors.push(
        error instanceof Error ? error.message : "State backup tick failed",
      );
    }
  };

  await Promise.all([
    runAlerts(),
    runBackups(),
    runConfigSnapshots(),
    runHeartbeat(),
    runStateBackup(),
  ]);

  state.lastError = collectedErrors.length > 0 ? collectedErrors.join("; ") : null;
}

export function startScheduler() {
  const state = getState();

  if (state.running && state.intervalId != null) {
    return;
  }

  state.running = true;
  state.startedAt = new Date().toISOString();
  state.intervalId = setInterval(() => {
    tick().catch((err) => {
      console.error("[alert-scheduler] Unhandled tick error:", err);
    });
  }, TICK_INTERVAL_MS);

  tick().catch((err) => {
    console.error("[alert-scheduler] Initial tick error:", err);
  });

  console.log("[alert-scheduler] Started (30s tick interval)");
}

export function stopScheduler() {
  const state = getState();

  if (state.intervalId != null) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }

  state.running = false;
  console.log("[alert-scheduler] Stopped");
}

export type SchedulerStatus = {
  backupLastResult: string | null;
  configSnapshotLastResult: string | null;
  heartbeatLastResult: string | null;
  lastCheckAt: string | null;
  lastError: string | null;
  lastResult: string | null;
  running: boolean;
  startedAt: string | null;
  tickCount: number;
};

export function getSchedulerStatus(): SchedulerStatus {
  const state = getState();

  return {
    backupLastResult: state.backupLastResult,
    configSnapshotLastResult: state.configSnapshotLastResult,
    heartbeatLastResult: state.heartbeatLastResult,
    lastCheckAt: state.lastCheckAt,
    lastError: state.lastError,
    lastResult: state.lastResult,
    running: state.running,
    startedAt: state.startedAt,
    tickCount: state.tickCount,
  };
}
