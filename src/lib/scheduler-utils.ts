import "server-only";

export function computeNextRunAt(
  lastRunAt: string | null,
  intervalMinutes: number,
): string {
  const baseMs = lastRunAt ? new Date(lastRunAt).getTime() : Date.now();
  return new Date(baseMs + intervalMinutes * 60_000).toISOString();
}

export type SchedulablePolicy = {
  enabled: boolean;
  id: string;
  nextRunAt: string | null;
};

export type RunDueOptions<T extends SchedulablePolicy> = {
  isReady?: (policy: T) => boolean;
  markRun: (policyId: string, runAt: string) => Promise<void>;
  policyLabel?: (policy: T) => string;
  policies: T[];
  runOne: (policy: T) => Promise<void>;
};

export type RunDueResult = {
  errors: string[];
  policiesEvaluated: number;
  ranCount: number;
};

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

    // Mark failed runs too so a broken policy waits a full interval before retrying.
    try {
      await markRun(policy.id, runAt);
    } catch {}
  }

  return { errors, policiesEvaluated: policies.length, ranCount };
}
