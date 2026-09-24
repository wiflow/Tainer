import type { EwmaState } from "./types";

export function updateEwma(
  current: EwmaState | undefined,
  node: string,
  newLatencyMs: number,
  alpha: number,
): EwmaState {
  const now = Date.now();

  if (!current || current.sampleCount === 0) {
    return {
      node,
      value: newLatencyMs,
      sampleCount: 1,
      lastUpdatedAt: now,
    };
  }

  return {
    node,
    value: alpha * newLatencyMs + (1 - alpha) * current.value,
    sampleCount: current.sampleCount + 1,
    lastUpdatedAt: now,
  };
}
