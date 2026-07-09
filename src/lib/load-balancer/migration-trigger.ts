import type { LiveDeployment, LiveNodeMetrics } from "@/lib/proxmox";
import type {
  HysteresisState,
  LoadBalancerSettings,
  MigrationDecision,
  MigrationWindow,
  NodeScore,
} from "./types";
import type { ScoreForecast } from "./forecast";
import {
  affinityTags,
  antiAffinityExcludedNodes,
  antiAffinityTags,
  effectiveMemBytes,
  hasIgnoreTag,
  hasManualTag,
  hasPinTag,
  validateTargetCapacity,
  wouldBreakAffinityGroup,
} from "./guest-rules";
import { selectNodeP2C } from "./p2c-selector";

// Drains move one guest per node per spacing window. Faster than the
// overload cooldown (draining is deliberate), slow enough that a failing
// migration doesn't cascade into a storm before the operator notices.
const DRAIN_SPACING_SECONDS = 60;

export type DrainWarning = {
  node: string;
  vmid: number;
  message: string;
};

export type MigrationEvaluation = {
  decisions: MigrationDecision[];
  drainWarnings: DrainWarning[];
};

function parseTimeOfDayMinutes(value: string): number {
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * True when `date` falls inside any window. Windows use the server's local
 * timezone and may wrap midnight (22:00–06:00 covers late evening AND early
 * morning).
 */
export function isWithinMigrationWindow(windows: MigrationWindow[], date: Date): boolean {
  const nowMinutes = date.getHours() * 60 + date.getMinutes();
  return windows.some((w) => {
    const start = parseTimeOfDayMinutes(w.start);
    const end = parseTimeOfDayMinutes(w.end);
    if (start < end) return nowMinutes >= start && nowMinutes < end;
    return nowMinutes >= start || nowMinutes < end; // wraps midnight
  });
}

/**
 * Containers restart-migrate in Proxmox (stop → transfer → start), so a
 * balancing move means real downtime. Gate them behind an explicit opt-in
 * and, optionally, downtime windows.
 */
function containerMoveAllowed(settings: LoadBalancerSettings, date: Date): boolean {
  if (settings.containerMigrations === "always") return true;
  if (settings.containerMigrations === "never") return false;
  return isWithinMigrationWindow(settings.containerMigrationWindows, date);
}

function findValidTarget(
  guest: LiveDeployment,
  candidateScores: NodeScore[],
  baseExclusions: Set<string>,
  deployments: LiveDeployment[],
  nodeMetrics: LiveNodeMetrics[],
  maxSourceScore: number | null,
  minImprovementPercent: number,
  guestMemBytes: number,
): string | null {
  const excludeSet = new Set(baseExclusions);
  excludeSet.add(guest.node);
  for (const node of antiAffinityExcludedNodes(guest.vmid, antiAffinityTags(guest), deployments)) {
    excludeSet.add(node);
  }

  const targetNode = selectNodeP2C(candidateScores, excludeSet);
  if (!targetNode) return null;

  const targetScore = candidateScores.find((s) => s.node === targetNode);
  if (!targetScore) return null;

  // Cost-benefit floor: a migration is never free, so the target must be
  // meaningfully better than the source or the move is skipped.
  if (
    maxSourceScore !== null &&
    targetScore.compositeScore >= maxSourceScore * (1 - minImprovementPercent / 100)
  ) {
    return null;
  }

  const targetMetrics = nodeMetrics.find((m) => m.node === targetNode);
  if (!validateTargetCapacity(targetMetrics, guest, targetScore, guestMemBytes)) return null;

  return targetNode;
}

/**
 * Eligibility for AUTOMATIC moves (overload + predictive phases). Explicit
 * admin actions (drains, rebalance plans) apply their own, looser rules —
 * notably plb_manual guests are movable there but never here.
 */
function isAutoMovable(
  guest: LiveDeployment,
  node: string,
  settings: LoadBalancerSettings,
  nowDate: Date,
  deployments: LiveDeployment[],
): boolean {
  return (
    guest.node === node &&
    guest.rawStatus === "running" &&
    !settings.excludedVmids.includes(guest.vmid) &&
    !hasIgnoreTag(guest) &&
    !hasManualTag(guest) &&
    !hasPinTag(guest) &&
    (guest.type !== "lxc" || containerMoveAllowed(settings, nowDate)) &&
    !wouldBreakAffinityGroup(guest, deployments)
  );
}

/**
 * Cost-benefit candidate ordering for an overloaded node (DRS-inspired:
 * achieve the goal with the least disruption):
 *
 * 1. VMs before containers — VM live migration is invisible to the
 *    workload, a container move is downtime.
 * 2. Within each group, the SMALLEST guest that alone sheds enough load
 *    ("smallest sufficient move") — moving a 64 GB VM when 4 GB would
 *    rebalance the node is pure waste. Guests too small to be sufficient
 *    follow, biggest first, as best-effort relief.
 */
function orderGuestsByCostBenefit(
  guests: LiveDeployment[],
  desiredShedBytes: number,
  guestMemOverrides: Map<number, number>,
): LiveDeployment[] {
  const order = (group: LiveDeployment[]): LiveDeployment[] => {
    const ascending = [...group].sort(
      (a, b) => effectiveMemBytes(a, guestMemOverrides) - effectiveMemBytes(b, guestMemOverrides),
    );
    const splitIndex = ascending.findIndex(
      (g) => effectiveMemBytes(g, guestMemOverrides) >= desiredShedBytes,
    );
    if (splitIndex === -1) return ascending.reverse(); // none sufficient — biggest first
    return [...ascending.slice(splitIndex), ...ascending.slice(0, splitIndex).reverse()];
  };

  return [
    ...order(guests.filter((g) => g.type === "qemu")),
    ...order(guests.filter((g) => g.type === "lxc")),
  ];
}

/**
 * Evaluate all migration decisions for a tick: maintenance drains first
 * (deliberate admin action, highest priority), then sustained-overload
 * rebalancing. Both share the maxConcurrentMigrations budget together with
 * migrations already in flight.
 *
 * Overload detection uses hysteresis (consecutive breach counting) to
 * prevent flapping: a node must exceed the cluster average by the configured
 * threshold for N consecutive polls before anything moves.
 */
export function evaluateMigrationDecisions(input: {
  scores: NodeScore[];
  hysteresisStates: Map<string, HysteresisState>;
  deployments: LiveDeployment[];
  settings: LoadBalancerSettings;
  migrationCooldowns: Map<string, number>;
  nodeMetrics: LiveNodeMetrics[];
  activeMigrationCount: number;
  /** vmid → guest-actual memory bytes from the balloon driver (QEMU). */
  guestMemOverrides?: Map<number, number>;
  /** node → score forecast; enables the predictive phase when set. */
  forecasts?: Map<string, ScoreForecast>;
}): MigrationEvaluation {
  const {
    scores,
    hysteresisStates,
    deployments,
    settings,
    migrationCooldowns,
    nodeMetrics,
    activeMigrationCount,
  } = input;
  const guestMemOverrides = input.guestMemOverrides ?? new Map<number, number>();

  const decisions: MigrationDecision[] = [];
  const drainWarnings: DrainWarning[] = [];
  const now = Date.now();
  const nowDate = new Date();
  const maintenanceSet = new Set(settings.maintenanceNodes);

  let budget = Math.max(0, settings.maxConcurrentMigrations - activeMigrationCount);

  // Targets must not be excluded, in maintenance, or already receiving a
  // migration decided this tick (avoids dogpiling one cool node).
  const baseExclusions = new Set([...settings.excludedNodes, ...settings.maintenanceNodes]);

  // ---- Phase 1: maintenance drains -----------------------------------
  for (const node of settings.maintenanceNodes) {
    if (budget <= 0) break;

    const cooldownUntil = migrationCooldowns.get(node);
    if (cooldownUntil && now < cooldownUntil) continue;

    const guests = deployments
      .filter((d) => d.node === node && d.rawStatus === "running")
      .sort(
        (a, b) =>
          effectiveMemBytes(b, guestMemOverrides) - effectiveMemBytes(a, guestMemOverrides),
      );

    for (const guest of guests) {
      if (settings.excludedVmids.includes(guest.vmid) || hasPinTag(guest) || hasIgnoreTag(guest)) {
        drainWarnings.push({
          node,
          vmid: guest.vmid,
          message: `Drain of ${node} is skipping ${guest.type.toUpperCase()} ${guest.vmid} (${
            settings.excludedVmids.includes(guest.vmid)
              ? "in the excluded VMID list"
              : hasPinTag(guest)
                ? "pinned via plb_pin tag"
                : "exempt via plb_ignore tag"
          }) — move it manually to finish the drain.`,
        });
        continue;
      }

      // Prefer a target already hosting the guest's affinity peers so a
      // drain reunites groups instead of scattering them.
      const affinity = affinityTags(guest);
      let preferredTarget: string | null = null;
      if (affinity.length > 0) {
        const peerNode = deployments.find(
          (d) =>
            d.vmid !== guest.vmid &&
            d.node !== node &&
            d.rawStatus === "running" &&
            !baseExclusions.has(d.node) &&
            d.tagList.some((t) => affinity.includes(t)),
        )?.node;
        if (peerNode) {
          const peerScore = scores.find((s) => s.node === peerNode);
          const peerMetrics = nodeMetrics.find((m) => m.node === peerNode);
          if (
            peerScore &&
            validateTargetCapacity(
              peerMetrics,
              guest,
              peerScore,
              effectiveMemBytes(guest, guestMemOverrides),
            )
          ) {
            preferredTarget = peerNode;
          }
        }
      }

      const targetNode =
        preferredTarget ??
        findValidTarget(
          guest,
          scores,
          baseExclusions,
          deployments,
          nodeMetrics,
          null,
          settings.minTargetImprovementPercent,
          effectiveMemBytes(guest, guestMemOverrides),
        );
      if (!targetNode) continue;

      decisions.push({
        vmid: guest.vmid,
        type: guest.type,
        sourceNode: node,
        targetNode,
        reason: `Node ${node} is in maintenance mode — draining guests`,
        cause: "maintenance-drain",
      });
      budget--;
      baseExclusions.add(targetNode);
      migrationCooldowns.set(node, now + DRAIN_SPACING_SECONDS * 1000);
      break; // one guest per maintenance node per tick
    }
  }

  // ---- Phase 2: sustained-overload rebalancing ------------------------
  if (!settings.migrationEnabled || scores.length < 2) {
    return { decisions, drainWarnings };
  }

  const clusterAvg = scores.reduce((s, n) => s + n.compositeScore, 0) / scores.length;
  const threshold = clusterAvg * (1 + settings.migrationThresholdPercent / 100);
  const activeNodes = new Set(scores.map((s) => s.node));

  // Clean up hysteresis for nodes no longer in the cluster
  for (const node of hysteresisStates.keys()) {
    if (!activeNodes.has(node)) hysteresisStates.delete(node);
  }

  for (const score of scores) {
    // Maintenance nodes are handled by the drain phase.
    if (maintenanceSet.has(score.node)) continue;

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
    if (budget <= 0) continue; // keep counting breaches, just don't act yet

    // Check cooldown
    const cooldownUntil = migrationCooldowns.get(score.node);
    if (cooldownUntil && now < cooldownUntil) continue;

    // Movable guests on this overloaded node.
    const movableGuests = deployments.filter((d) =>
      isAutoMovable(d, score.node, settings, nowDate, deployments),
    );

    // How much memory the node needs to shed to come back to the cluster
    // average — drives "smallest sufficient move" candidate ordering.
    const sourceMetrics = nodeMetrics.find((m) => m.node === score.node);
    const sourceMemUsed = sourceMetrics?.memoryUsedBytes ?? 0;
    const desiredShedBytes = Math.max(
      0,
      sourceMemUsed *
        ((score.compositeScore - clusterAvg) / Math.max(score.compositeScore, 1)),
    );

    const nodeGuests = orderGuestsByCostBenefit(
      movableGuests,
      desiredShedBytes,
      guestMemOverrides,
    );

    // Target candidates: below-average nodes only
    const belowAvgScores = scores.filter(
      (s) => s.node !== score.node && s.compositeScore < clusterAvg,
    );

    for (const guest of nodeGuests) {
      const targetNode = findValidTarget(
        guest,
        belowAvgScores,
        baseExclusions,
        deployments,
        nodeMetrics,
        score.compositeScore,
        settings.minTargetImprovementPercent,
        effectiveMemBytes(guest, guestMemOverrides),
      );
      if (!targetNode) continue;

      decisions.push({
        vmid: guest.vmid,
        type: guest.type,
        sourceNode: score.node,
        targetNode,
        reason: `Node ${score.node} score ${score.compositeScore.toFixed(1)} exceeded threshold ${threshold.toFixed(1)} for ${hs.consecutiveBreaches} consecutive polls`,
        cause: "overload",
      });
      budget--;
      baseExclusions.add(targetNode);

      // Apply cooldown
      migrationCooldowns.set(
        score.node,
        now + settings.migrationCooldownSeconds * 1000,
      );

      // Reset hysteresis after triggering
      hs.consecutiveBreaches = 0;
      hs.firstBreachAt = null;
      hs.lastBreachAt = null;
      break; // one guest per overloaded node per tick
    }
  }

  // ---- Phase 3: predictive pre-emption ---------------------------------
  // Act on high-confidence forecasts of a node crossing the threshold
  // within the horizon, before the overload materializes. The forecast
  // window doubles as hysteresis (a spike can't produce a confident trend),
  // and all the usual gates — cooldown, budget, eligibility, target
  // validation — still apply.
  if (settings.predictiveEnabled && input.forecasts) {
    const decidedNodes = new Set(decisions.map((d) => d.sourceNode));
    const minR2 = settings.predictiveMinConfidencePercent / 100;

    for (const score of scores) {
      if (budget <= 0) break;
      if (maintenanceSet.has(score.node) || decidedNodes.has(score.node)) continue;
      if (score.compositeScore > threshold) continue; // real overload — phase 2's job

      const forecast = input.forecasts.get(score.node);
      if (!forecast) continue;
      if (forecast.r2 < minR2) continue;
      if (forecast.slopePerMinute <= 0) continue; // load falling or flat
      if (forecast.predictedScore <= threshold) continue;

      const cooldownUntil = migrationCooldowns.get(score.node);
      if (cooldownUntil && now < cooldownUntil) continue;

      const movableGuests = deployments.filter((d) =>
        isAutoMovable(d, score.node, settings, nowDate, deployments),
      );

      const sourceMetrics = nodeMetrics.find((m) => m.node === score.node);
      const sourceMemUsed = sourceMetrics?.memoryUsedBytes ?? 0;
      const desiredShedBytes = Math.max(
        0,
        sourceMemUsed *
          ((forecast.predictedScore - clusterAvg) / Math.max(forecast.predictedScore, 1)),
      );

      const orderedGuests = orderGuestsByCostBenefit(
        movableGuests,
        desiredShedBytes,
        guestMemOverrides,
      );

      const belowAvgScores = scores.filter(
        (s) => s.node !== score.node && s.compositeScore < clusterAvg,
      );

      for (const guest of orderedGuests) {
        // The improvement gate compares against the PREDICTED score — the
        // whole point is the source isn't hot yet.
        const targetNode = findValidTarget(
          guest,
          belowAvgScores,
          baseExclusions,
          deployments,
          nodeMetrics,
          forecast.predictedScore,
          settings.minTargetImprovementPercent,
          effectiveMemBytes(guest, guestMemOverrides),
        );
        if (!targetNode) continue;

        decisions.push({
          vmid: guest.vmid,
          type: guest.type,
          sourceNode: score.node,
          targetNode,
          reason: `Node ${score.node} forecast to reach score ${forecast.predictedScore.toFixed(1)} (threshold ${threshold.toFixed(1)}) within ${settings.predictiveHorizonMinutes} min — trend +${forecast.slopePerMinute.toFixed(2)}/min, confidence R²=${forecast.r2.toFixed(2)} over ${forecast.sampleCount} samples`,
          cause: "predicted-overload",
        });
        budget--;
        baseExclusions.add(targetNode);
        migrationCooldowns.set(
          score.node,
          now + settings.migrationCooldownSeconds * 1000,
        );
        break; // one guest per predicted node per tick
      }
    }
  }

  return { decisions, drainWarnings };
}
