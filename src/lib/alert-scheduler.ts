import { getAlertSettings } from "@/lib/alert-settings";
import { runAlertCheck } from "@/lib/alert-engine";
import { runBackupTick } from "@/lib/backup-engine";
import { runConfigSnapshotTickAllSites } from "@/lib/config-snapshot-runner";
import { getHeartbeatSettings } from "@/lib/heartbeat-settings";
import { runHeartbeatCheck, shouldRunHeartbeat } from "@/lib/heartbeat-engine";

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

  try {
    const settings = await getAlertSettings();

    if (!settings.enabled) {
      return;
    }

    const result = await runAlertCheck();
    const now = new Date().toISOString();
    state.lastCheckAt = now;

    if (result.policiesEvaluated > 0) {
      state.lastResult = `${result.policiesEvaluated} policies, ${result.alertsFired} fired, ${result.resolvedAlerts} resolved`;
    } else {
      state.lastResult = "No policies due";
    }
    state.lastError = null;

    if (result.errors.length > 0) {
      state.lastError = result.errors[0];
    }
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : "Scheduler tick failed";
    state.lastResult = null;
  }

  // Backup tick runs regardless of alert settings
  try {
    const backupResult = await runBackupTick();
    if (backupResult.runsActive > 0 || backupResult.policiesStarted > 0) {
      state.backupLastResult = `${backupResult.runsActive} active, ${backupResult.policiesStarted} started`;
    }
    if (backupResult.errors.length > 0) {
      state.lastError = (state.lastError ? `${state.lastError}; ` : "") + backupResult.errors[0];
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Backup tick failed";
    state.lastError = (state.lastError ? `${state.lastError}; ` : "") + msg;
  }

  // Config snapshot scheduling: iterate enabled sites and capture due policies.
  try {
    const csResult = await runConfigSnapshotTickAllSites();
    if (csResult.snapshotsTaken > 0 || csResult.policiesEvaluated > 0) {
      state.configSnapshotLastResult = `${csResult.sitesProcessed} site(s), ${csResult.policiesEvaluated} policies, ${csResult.snapshotsTaken} snapshot(s) taken`;
    }
    if (csResult.errors.length > 0) {
      state.lastError = (state.lastError ? `${state.lastError}; ` : "") + csResult.errors[0];
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Config snapshot tick failed";
    state.lastError = (state.lastError ? `${state.lastError}; ` : "") + msg;
  }

  // Heartbeat runs on its own interval, independent of alert settings
  try {
    const hbSettings = await getHeartbeatSettings();
    if (shouldRunHeartbeat(hbSettings)) {
      const hbResult = await runHeartbeatCheck();
      if (hbResult.sitesChecked > 0) {
        state.heartbeatLastResult = `${hbResult.sitesChecked} sites, ${hbResult.alertsFired} fired, ${hbResult.resolvedAlerts} resolved`;
      }
      if (hbResult.errors.length > 0) {
        state.lastError = (state.lastError ? `${state.lastError}; ` : "") + hbResult.errors[0];
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Heartbeat tick failed";
    state.lastError = (state.lastError ? `${state.lastError}; ` : "") + msg;
  }

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
