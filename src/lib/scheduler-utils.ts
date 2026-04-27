import "server-only";

/**
 * Shared helpers for interval-based scheduled-policy engines.
 *
 * Multiple subsystems (backup, config snapshot, alert, heartbeat) follow the
 * same pattern: each has a list of policies with `enabled`, `intervalMinutes`,
 * `lastRunAt`, `nextRunAt`, and a tick that runs every due one. This module
 * factors out the parts that are genuinely identical so a fix lands in one
 * place. Engine-specific logic (in-flight tracking, per-archive retention,
 * complex multi-step runs) deliberately stays in each engine.
 */

/**
 * Returns an ISO timestamp `intervalMinutes` after `lastRunAt`. If the policy
 * has never run, the next run is scheduled for `intervalMinutes` from now.
 */
export function computeNextRunAt(
  lastRunAt: string | null,
  intervalMinutes: number,
): string {
  const baseMs = lastRunAt ? new Date(lastRunAt).getTime() : Date.now();
  return new Date(baseMs + intervalMinutes * 60_000).toISOString();
}

/** Minimum shape a policy needs to participate in `runDuePolicies`. */
export type SchedulablePolicy = {
  enabled: boolean;
  id: string;
  nextRunAt: string | null;
};

export type RunDueOptions<T extends SchedulablePolicy> = {
  /** Optional extra predicate, e.g. "policy has a target node". */
  isReady?: (policy: T) => boolean;
  /** Mark the policy as having just run; called even on runOne failure so we
   *  don't busy-retry on every tick. */
  markRun: (policyId: string, runAt: string) => Promise<void>;
  /** Used for "policy: <name>" error prefixes. */
  policyLabel?: (policy: T) => string;
  policies: T[];
  /** What to do when a policy is due. */
  runOne: (policy: T) => Promise<void>;
};

export type RunDueResult = {
  errors: string[];
  policiesEvaluated: number;
  ranCount: number;
};

/**
 * Walks the given policies, filters to ones that are enabled + ready + due,
 * runs each via `runOne`, and marks them with `markRun`. Errors are
 * accumulated rather than thrown so one failing policy does not stop the rest.
 */
export async function runDuePolicies<T extends SchedulablePolicy>({
  isReady,
  markRun,
  policyLabel,
  policies,
  runOne,
}: RunDueOptions<T>): Promise<RunDueResult> {
  const errors: string[] = [];
  let ranCount = 0;

  const now = Date.now();
  const due = policies.filter((p) => {
    if (!p.enabled) return false;
    if (isReady && !isReady(p)) return false;
    if (!p.nextRunAt) return true;
    return now >= new Date(p.nextRunAt).getTime();
  });

  for (const policy of due) {
    const runAt = new Date().toISOString();
    const label = policyLabel ? policyLabel(policy) : policy.id;
    try {
      await runOne(policy);
      ranCount++;
    } catch (error) {
      errors.push(
        `${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Always mark the run so a persistently failing policy doesn't fire on
    // every 30-second tick. The next attempt happens after intervalMinutes.
    try {
      await markRun(policy.id, runAt);
    } catch {
      /* ignore — best-effort */
    }
  }

  return { errors, policiesEvaluated: policies.length, ranCount };
}
