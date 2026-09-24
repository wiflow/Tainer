import type { LiveDeployment, LiveNodeMetrics } from "@/lib/proxmox";
import type { LoadBalancerSettings, NodeScore } from "./types";
import {
  CPU_MAX_PERCENT,
  DISK_HEADROOM,
  MEM_HEADROOM,
  antiAffinityExcludedNodes,
  antiAffinityTags,
  effectiveMemBytes,
  hasIgnoreTag,
  hasPinTag,
  wouldBreakAffinityGroup,
} from "./guest-rules";

export type PlannedMove = {
  vmid: number;
  name: string;
  type: "lxc" | "qemu";
  sourceNode: string;
  targetNode: string;
  memBytes: number;
  projectedImbalance: number;
};

export type RebalancePlanResult = {
  moves: PlannedMove[];
  imbalanceBefore: number;
  imbalanceAfter: number;
  projectedScores: Array<{ node: string; before: number; after: number }>;
};

const MIN_CV_GAIN = 0.005;

type ProjectedNode = {
  node: string;
  baseScore: number;
  memUsedBytes: number;
  memTotalBytes: number;
  rootfsFreeBytes: number;
  cpuPercent: number;
};

function projectedScore(n: ProjectedNode, memoryWeight: number): number {
  if (n.memTotalBytes <= 0) return n.baseScore;
  return n.baseScore + memoryWeight * ((n.memUsedBytes / n.memTotalBytes) * 100);
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return 0;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance) / mean;
}

export function computeRebalancePlan(input: {
  scores: NodeScore[];
  deployments: LiveDeployment[];
  nodeMetrics: LiveNodeMetrics[];
  settings: LoadBalancerSettings;
  guestMemOverrides?: Map<number, number>;
  maxMoves: number;
  includeContainers: boolean;
}): RebalancePlanResult {
  const { scores, deployments, nodeMetrics, settings, maxMoves, includeContainers } = input;
  const guestMemOverrides = input.guestMemOverrides ?? new Map<number, number>();
  const memoryWeight = settings.weights.memory;

  const forbiddenNodes = new Set([...settings.excludedNodes, ...settings.maintenanceNodes]);

  const nodes = new Map<string, ProjectedNode>();
  for (const score of scores) {
    if (forbiddenNodes.has(score.node)) continue;
    const m = nodeMetrics.find((metric) => metric.node === score.node);
    const memTotal = m?.memoryTotalBytes ?? 0;
    const memUsed = m?.memoryUsedBytes ?? 0;
    nodes.set(score.node, {
      node: score.node,
      baseScore:
        memTotal > 0
          ? score.compositeScore - memoryWeight * ((memUsed / memTotal) * 100)
          : score.compositeScore,
      memUsedBytes: memUsed,
      memTotalBytes: memTotal,
      rootfsFreeBytes: (m?.rootfsTotalBytes ?? 0) - (m?.rootfsUsedBytes ?? 0),
      cpuPercent: score.cpuPercent,
    });
  }

  const initialScores = [...nodes.values()].map((n) => ({
    node: n.node,
    before: Math.round(projectedScore(n, memoryWeight) * 100) / 100,
  }));
  const imbalanceBefore = coefficientOfVariation(
    [...nodes.values()].map((n) => projectedScore(n, memoryWeight)),
  );

  const movable = deployments.filter(
    (d) =>
      d.rawStatus === "running" &&
      nodes.has(d.node) &&
      !settings.excludedVmids.includes(d.vmid) &&
      !hasIgnoreTag(d) &&
      !hasPinTag(d) &&
      (d.type !== "lxc" || includeContainers) &&
      !wouldBreakAffinityGroup(d, deployments),
  );

  const positions = new Map<number, string>();
  for (const d of deployments) positions.set(d.vmid, d.node);

  const moves: PlannedMove[] = [];
  const movedVmids = new Set<number>();
  let currentCv = imbalanceBefore;

  for (let step = 0; step < maxMoves; step++) {
    let best: { guest: LiveDeployment; target: ProjectedNode; cv: number } | null = null;

    for (const guest of movable) {
      if (movedVmids.has(guest.vmid)) continue;
      const source = nodes.get(positions.get(guest.vmid) ?? guest.node);
      if (!source) continue;

      const memBytes = effectiveMemBytes(guest, guestMemOverrides);
      const antiAffinityForbidden = antiAffinityExcludedNodes(
        guest.vmid,
        antiAffinityTags(guest),
        deployments,
        positions,
      );

      for (const target of nodes.values()) {
        if (target.node === source.node) continue;
        if (antiAffinityForbidden.has(target.node)) continue;
        if (target.cpuPercent >= CPU_MAX_PERCENT) continue;
        if (
          memBytes > 0 &&
          target.memTotalBytes - target.memUsedBytes < memBytes * MEM_HEADROOM
        ) {
          continue;
        }
        const guestDisk = guest.diskUsedBytes ?? 0;
        if (guestDisk > 0 && target.rootfsFreeBytes < guestDisk * DISK_HEADROOM) continue;

        source.memUsedBytes -= memBytes;
        target.memUsedBytes += memBytes;
        const cv = coefficientOfVariation(
          [...nodes.values()].map((n) => projectedScore(n, memoryWeight)),
        );
        source.memUsedBytes += memBytes;
        target.memUsedBytes -= memBytes;

        if (!best || cv < best.cv) best = { guest, target, cv };
      }
    }

    if (!best || currentCv - best.cv < MIN_CV_GAIN) break;

    const memBytes = effectiveMemBytes(best.guest, guestMemOverrides);
    const source = nodes.get(positions.get(best.guest.vmid) ?? best.guest.node);
    if (!source) break;
    source.memUsedBytes -= memBytes;
    best.target.memUsedBytes += memBytes;
    best.target.rootfsFreeBytes -= best.guest.diskUsedBytes ?? 0;
    positions.set(best.guest.vmid, best.target.node);
    movedVmids.add(best.guest.vmid);
    currentCv = best.cv;

    moves.push({
      vmid: best.guest.vmid,
      name: best.guest.name,
      type: best.guest.type,
      sourceNode: source.node,
      targetNode: best.target.node,
      memBytes,
      projectedImbalance: Math.round(best.cv * 1000) / 1000,
    });
  }

  return {
    moves,
    imbalanceBefore: Math.round(imbalanceBefore * 1000) / 1000,
    imbalanceAfter: Math.round(currentCv * 1000) / 1000,
    projectedScores: initialScores.map((s) => {
      const n = nodes.get(s.node);
      return {
        node: s.node,
        before: s.before,
        after: n ? Math.round(projectedScore(n, memoryWeight) * 100) / 100 : s.before,
      };
    }),
  };
}
