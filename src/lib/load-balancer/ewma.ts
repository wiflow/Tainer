import type { EwmaState } from "./types";

/**
 * Update the EWMA (Exponentially Weighted Moving Average) latency for a node.
 * Formula: L_new = (alpha * currentSample) + ((1 - alpha) * L_old)
 * First sample is used directly as the initial value.
 */
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
