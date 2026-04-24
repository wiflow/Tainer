import type { LiveDeployment, LiveNodeMetrics } from "@/lib/proxmox";
import type {
  HysteresisState,
  LoadBalancerSettings,
  MigrationDecision,
  NodeScore,
} from "./types";
import { selectNodeP2C } from "./p2c-selector";

const MEM_HEADROOM = 1.2;  // 20% memory headroom
const DISK_HEADROOM = 1.1; // 10% disk headroom
const CPU_MAX_PERCENT = 90; // Don't migrate to nodes above 90% CPU

/**
 * Validate that the target node has enough capacity for the guest,
 * checking CPU, memory, and disk with headroom margins.
 */
function validateTargetCapacity(
  targetMetrics: LiveNodeMetrics | undefined,
  guest: LiveDeployment,
  targetScore: NodeScore,
): boolean {
  if (!targetMetrics) return false;

  // CPU: target must be below 90%
  if (targetScore.cpuPercent >= CPU_MAX_PERCENT) return false;

  // Memory: target must have enough free memory with 20% headroom
  const guestMem = guest.memUsedBytes ?? 0;
  if (guestMem > 0) {
    const targetFreeMem = (targetMetrics.memoryTotalBytes ?? 0) - (targetMetrics.memoryUsedBytes ?? 0);
    if (targetFreeMem < guestMem * MEM_HEADROOM) return false;
  }

  // Disk: target must have enough free disk with 10% headroom
  const guestDisk = guest.diskUsedBytes ?? 0;
  if (guestDisk > 0) {
    const targetFreeDisk = (targetMetrics.rootfsTotalBytes ?? 0) - (targetMetrics.rootfsUsedBytes ?? 0);
    if (targetFreeDisk < guestDisk * DISK_HEADROOM) return false;
  }

  return true;
}

/**
 * Evaluate whether any nodes have been in sustained overload and should
 * trigger a live migration. Uses hysteresis (consecutive breach counting)
 * to prevent flapping.
 *
 * A node is considered "in breach" when its composite score exceeds the
 * cluster average by the configured threshold percentage for a configured
 * number of consecutive polls.
 */
export function evaluateMigrationTriggers(
  scores: NodeScore[],
  hysteresisStates: Map<string, HysteresisState>,
  deployments: LiveDeployment[],
  settings: LoadBalancerSettings,
  migrationCooldowns: Map<string, number>,
  nodeMetrics: LiveNodeMetrics[],
): MigrationDecision[] {
  if (!settings.migrationEnabled || scores.length < 2) return [];

  const now = Date.now();
  const clusterAvg = scores.reduce((s, n) => s + n.compositeScore, 0) / scores.length;
  const threshold = clusterAvg * (1 + settings.migrationThresholdPercent / 100);

  const decisions: MigrationDecision[] = [];
  const activeNodes = new Set(scores.map((s) => s.node));

  // Clean up hysteresis for nodes no longer in the cluster
  for (const node of hysteresisStates.keys()) {
    if (!activeNodes.has(node)) hysteresisStates.delete(node);
  }

  for (const score of scores) {
    const hs = hysteresisStates.get(score.node) ?? {
      consecutiveBreaches: 0,
      firstBreachAt: null,
      lastBreachAt: null,
    };

    if (score.compositeScore > threshold) {
      hs.consecutiveBreaches++;
      hs.lastBreachAt = now;
      if (!hs.firstBreachAt) hs.firstBreachAt = now;
    } else {
      hs.consecutiveBreaches = 0;
      hs.firstBreachAt = null;
      hs.lastBreachAt = null;
    }

    hysteresisStates.set(score.node, hs);

    if (hs.consecutiveBreaches < settings.migrationConsecutivePolls) continue;

    // Check cooldown
    const cooldownUntil = migrationCooldowns.get(score.node);
    if (cooldownUntil && now < cooldownUntil) continue;

    // Find the heaviest movable guest on this overloaded node
    const nodeGuests = deployments
      .filter(
        (d) =>
          d.node === score.node &&
          d.rawStatus === "running" &&
          !settings.excludedVmids.includes(d.vmid),
      )
      .sort((a, b) => (b.memUsedBytes ?? 0) - (a.memUsedBytes ?? 0));

    if (nodeGuests.length === 0) continue;

    const guest = nodeGuests[0];

    // Select target using P2C among below-average nodes
    const belowAvgScores = scores.filter(
      (s) => s.node !== score.node && s.compositeScore < clusterAvg,
    );
    const excludeSet = new Set(settings.excludedNodes);
    excludeSet.add(score.node);

    const targetNode = selectNodeP2C(belowAvgScores, excludeSet);
    if (!targetNode) continue;

    const targetScore = scores.find((s) => s.node === targetNode);
    if (!targetScore) continue;

    // Only migrate if target is meaningfully better
    if (targetScore.compositeScore >= score.compositeScore * 0.8) continue;

    // Validate target has actual capacity (CPU + memory + disk)
    const targetM = nodeMetrics.find((m) => m.node === targetNode);
    if (!validateTargetCapacity(targetM, guest, targetScore)) continue;

    decisions.push({
      vmid: guest.vmid,
      type: guest.type,
      sourceNode: score.node,
      targetNode,
      reason: `Node ${score.node} score ${score.compositeScore.toFixed(1)} exceeded threshold ${threshold.toFixed(1)} for ${hs.consecutiveBreaches} consecutive polls`,
    });

    // Apply cooldown
    migrationCooldowns.set(
      score.node,
      now + settings.migrationCooldownSeconds * 1000,
    );

    // Reset hysteresis after triggering
    hs.consecutiveBreaches = 0;
    hs.firstBreachAt = null;
    hs.lastBreachAt = null;
  }

  return decisions;
}
