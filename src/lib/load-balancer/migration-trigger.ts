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

/** Windows use the server's local timezone and may wrap past midnight. */
export function isWithinMigrationWindow(windows: MigrationWindow[], date: Date): boolean {
  const nowMinutes = date.getHours() * 60 + date.getMinutes();
  return windows.some((w) => {
    const start = parseTimeOfDayMinutes(w.start);
    const end = parseTimeOfDayMinutes(w.end);
    if (start < end) return nowMinutes >= start && nowMinutes < end;
    return nowMinutes >= start || nowMinutes < end;
  });
}

/** Proxmox migrates containers by stop, transfer and start, so a move means downtime. */
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
    if (splitIndex === -1) return ascending.reverse();
    return [...ascending.slice(splitIndex), ...ascending.slice(0, splitIndex).reverse()];
  };

  return [
    ...order(guests.filter((g) => g.type === "qemu")),
    ...order(guests.filter((g) => g.type === "lxc")),
  ];
}

export function evaluateMigrationDecisions(input: {
  scores: NodeScore[];
  hysteresisStates: Map<string, HysteresisState>;
  deployments: LiveDeployment[];
  settings: LoadBalancerSettings;
  migrationCooldowns: Map<string, number>;
  nodeMetrics: LiveNodeMetrics[];
  activeMigrationCount: number;
  /** Guest-reported memory bytes from the QEMU balloon driver, keyed by vmid. */
  guestMemOverrides?: Map<number, number>;
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

  const baseExclusions = new Set([...settings.excludedNodes, ...settings.maintenanceNodes]);

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
      break;
    }
  }

  if (!settings.migrationEnabled || scores.length < 2) {
    return { decisions, drainWarnings };
  }

  const clusterAvg = scores.reduce((s, n) => s + n.compositeScore, 0) / scores.length;
  const threshold = clusterAvg * (1 + settings.migrationThresholdPercent / 100);
  const activeNodes = new Set(scores.map((s) => s.node));

  for (const node of hysteresisStates.keys()) {
    if (!activeNodes.has(node)) hysteresisStates.delete(node);
  }

  for (const score of scores) {
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
    if (budget <= 0) continue;

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
        ((score.compositeScore - clusterAvg) / Math.max(score.compositeScore, 1)),
    );

    const nodeGuests = orderGuestsByCostBenefit(
      movableGuests,
      desiredShedBytes,
      guestMemOverrides,
    );

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

      migrationCooldowns.set(
        score.node,
        now + settings.migrationCooldownSeconds * 1000,
      );

      hs.consecutiveBreaches = 0;
      hs.firstBreachAt = null;
      hs.lastBreachAt = null;
      break;
    }
  }

  if (settings.predictiveEnabled && input.forecasts) {
    const decidedNodes = new Set(decisions.map((d) => d.sourceNode));
    const minR2 = settings.predictiveMinConfidencePercent / 100;

    for (const score of scores) {
      if (budget <= 0) break;
      if (maintenanceSet.has(score.node) || decidedNodes.has(score.node)) continue;
      if (score.compositeScore > threshold) continue;

      const forecast = input.forecasts.get(score.node);
      if (!forecast) continue;
      if (forecast.r2 < minR2) continue;
      if (forecast.slopePerMinute <= 0) continue;
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
        break;
      }
    }
  }

  return { decisions, drainWarnings };
}
