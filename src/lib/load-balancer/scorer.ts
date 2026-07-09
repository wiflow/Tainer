import type { LiveNodeMetrics } from "@/lib/proxmox";
import type { EwmaState, NodePenalty, NodeScore, ScoreWeights } from "./types";

const METRIC_UNAVAILABLE_PENALTY = 10;
const FALLBACK_PERCENT = 50;

/**
 * Compute composite scores for all nodes.
 *
 * Score formula:
 *   S(node) = (w.cpu * C) + (w.memory * M) + (w.disk * D) + (w.latency * L_norm) + penalties
 *
 * Where:
 *   C = cpuRatio * 100 (0-100 scale)
 *   M = memoryUsed / memoryTotal * 100 (0-100 scale)
 *   D = rootfsUsed / rootfsTotal * 100 (0-100 scale)
 *   L_norm = min(ewmaLatency / latencyMaxMs, 1.0) * 100 (normalized to 0-100)
 *
 * When a metric is unavailable (null/zero total), the node receives the
 * cluster average for that metric (or 50% if no average exists) plus a
 * small penalty. This avoids permanently banning nodes with missing metrics
 * while still slightly disfavoring them.
 *
 * Lower score = better node.
 */
export type PsiScoringOptions = {
  /** Penalty added per pressured resource (0 disables PSI scoring). */
  psiPenalty: number;
  /** avg10 "some" stall percentage above which a resource counts as pressured. */
  psiThresholdPercent: number;
};

/**
 * PSI (Pressure Stall Information) penalties, PVE 9+. Utilization misses
 * contention — a node can sit at 60% CPU while tasks stall waiting for it.
 * PSI measures the stalling directly, so each pressured resource (CPU,
 * memory, IO) adds a penalty. Nodes that don't report PSI are unaffected.
 */
function computePsiPenalties(
  metrics: LiveNodeMetrics,
  options: PsiScoringOptions,
): NodePenalty[] {
  const pressure = metrics.pressure;
  if (!pressure || options.psiPenalty <= 0) return [];

  const penalties: NodePenalty[] = [];
  const checks: Array<{ label: string; value: number | null }> = [
    { label: "cpu", value: pressure.cpuSomeAvg10 },
    { label: "memory", value: pressure.memorySomeAvg10 },
    { label: "io", value: pressure.ioSomeAvg10 },
  ];

  for (const check of checks) {
    if (check.value !== null && check.value > options.psiThresholdPercent) {
      penalties.push({
        reason: `PSI ${check.label} stall ${check.value.toFixed(1)}% > ${options.psiThresholdPercent}% (avg10)`,
        value: options.psiPenalty,
      });
    }
  }

  return penalties;
}

export function computeNodeScores(
  metrics: LiveNodeMetrics[],
  ewmaStates: Map<string, EwmaState>,
  penaltyData: Map<string, NodePenalty[]>,
  weights: ScoreWeights,
  latencyMaxMs: number,
  psiOptions?: PsiScoringOptions,
): NodeScore[] {
  const now = Date.now();

  // First pass: compute raw percentages for available metrics to find averages
  const cpuValues: number[] = [];
  const memValues: number[] = [];
  const diskValues: number[] = [];

  for (const m of metrics) {
    if (m.cpuRatio != null) cpuValues.push(m.cpuRatio * 100);
    const memTotal = m.memoryTotalBytes ?? 0;
    if (memTotal > 0) memValues.push(((m.memoryUsedBytes ?? 0) / memTotal) * 100);
    const diskTotal = m.rootfsTotalBytes ?? 0;
    if (diskTotal > 0) diskValues.push(((m.rootfsUsedBytes ?? 0) / diskTotal) * 100);
  }

  const avgCpu = cpuValues.length > 0 ? cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length : FALLBACK_PERCENT;
  const avgMem = memValues.length > 0 ? memValues.reduce((a, b) => a + b, 0) / memValues.length : FALLBACK_PERCENT;
  const avgDisk = diskValues.length > 0 ? diskValues.reduce((a, b) => a + b, 0) / diskValues.length : FALLBACK_PERCENT;

  // Second pass: compute final scores
  return metrics.map((m) => {
    const penalties = [...(penaltyData.get(m.node) ?? [])];
    if (psiOptions) penalties.push(...computePsiPenalties(m, psiOptions));

    // CPU
    let cpuPercent: number;
    if (m.cpuRatio != null) {
      cpuPercent = m.cpuRatio * 100;
    } else {
      cpuPercent = avgCpu;
      penalties.push({ reason: "CPU metric unavailable", value: METRIC_UNAVAILABLE_PENALTY });
    }

    // Memory
    let memoryPercent: number;
    const memTotal = m.memoryTotalBytes ?? 0;
    if (memTotal > 0) {
      memoryPercent = ((m.memoryUsedBytes ?? 0) / memTotal) * 100;
    } else {
      memoryPercent = avgMem;
      penalties.push({ reason: "Memory metric unavailable", value: METRIC_UNAVAILABLE_PENALTY });
    }

    // Disk
    let diskPercent: number;
    const diskTotal = m.rootfsTotalBytes ?? 0;
    if (diskTotal > 0) {
      diskPercent = ((m.rootfsUsedBytes ?? 0) / diskTotal) * 100;
    } else {
      diskPercent = avgDisk;
      penalties.push({ reason: "Disk metric unavailable", value: METRIC_UNAVAILABLE_PENALTY });
    }

    // Latency
    const ewma = ewmaStates.get(m.node);
    const ewmaLatencyMs = ewma?.value ?? 0;
    const latencyNormalized = Math.min(ewmaLatencyMs / Math.max(latencyMaxMs, 1), 1.0) * 100;

    const penaltyTotal = penalties.reduce((sum, p) => sum + p.value, 0);

    const compositeScore =
      weights.cpu * cpuPercent +
      weights.memory * memoryPercent +
      weights.disk * diskPercent +
      weights.latency * latencyNormalized +
      penaltyTotal;

    return {
      node: m.node,
      cpuPercent: Math.round(cpuPercent * 100) / 100,
      memoryPercent: Math.round(memoryPercent * 100) / 100,
      diskPercent: Math.round(diskPercent * 100) / 100,
      ewmaLatencyMs: Math.round(ewmaLatencyMs * 100) / 100,
      compositeScore: Math.round(compositeScore * 100) / 100,
      penalties,
      penaltyTotal,
      updatedAt: now,
    };
  });
}

export function computeClusterAverage(scores: NodeScore[]): number {
  if (scores.length === 0) return 0;
  const sum = scores.reduce((acc, s) => acc + s.compositeScore, 0);
  return Math.round((sum / scores.length) * 100) / 100;
}
