import type {
  EwmaState,
  HysteresisState,
  LoadBalancerSettings,
  LoadBalancerStatus,
  NodePenalty,
  NodeScore,
  PendingMigration,
} from "./types";
import type { LiveNodeMetrics } from "@/lib/proxmox";
import { NodeCircuitBreaker } from "./circuit-breaker";
import { updateEwma } from "./ewma";
import { computeClusterAverage, computeNodeScores } from "./scorer";
import { evaluateMigrationDecisions } from "./migration-trigger";
import {
  appendScoreSample,
  forecastScore,
  type ScoreForecast,
  type ScoreSample,
} from "./forecast";
import { DEFAULT_LB_SETTINGS } from "./settings";

type SiteState = {
  nodeScores: NodeScore[];
  clusterAverageScore: number;
  ewmaStates: Map<string, EwmaState>;
  hysteresisStates: Map<string, HysteresisState>;
  migrationCooldowns: Map<string, number>;
  pendingMigrations: PendingMigration[];
  circuitBreaker: NodeCircuitBreaker;
  settings: LoadBalancerSettings;
  lastMetrics: LiveNodeMetrics[];
  /** (node:vmid) keys already warned about during a drain — warn once per process. */
  drainWarned: Set<string>;
  /** Per-node composite score history feeding the predictive forecaster. */
  scoreHistory: Map<string, ScoreSample[]>;
};

type ObserverState = {
  running: boolean;
  startedAt: string | null;
  lastTickAt: string | null;
  lastError: string | null;
  tickCount: number;
  tickInProgress: boolean;
  intervalId: ReturnType<typeof setInterval> | null;
  siteStates: Map<string, SiteState>;
  /** Rate limiter for persisted tick-error events, keyed by siteId. */
  lastTickErrorLog: Map<string, { at: number; message: string }>;
};

// Don't write the same site's tick error to the event log more often than
// this — a downed Proxmox at a 10s poll interval would otherwise flood the
// 10k-entry log within a day.
const TICK_ERROR_LOG_INTERVAL_MS = 5 * 60_000;

/**
 * Advance an applied rebalance plan by at most one move: resolve the fate
 * of in-flight moves via the Proxmox task API, then — if the shared
 * concurrency budget allows — re-validate and fire the next queued move.
 * Every move is re-checked against LIVE state at execution time; a plan is
 * a preview, not a promise. Returns the number of plan moves still in
 * flight so the automatic phases can count them against the budget.
 */
async function executeRebalancePlanStep(params: {
  config: { siteId: string; siteName: string };
  deployments: import("@/lib/proxmox").LiveDeployment[];
  metrics: LiveNodeMetrics[];
  nodeScores: NodeScore[];
  settings: LoadBalancerSettings;
  guestMemOverrides: Map<number, number>;
  pendingActiveCount: number;
  proxmox: {
    getTaskSnapshot: (node: string, upid: string) => Promise<{ completed: boolean; exitStatus: string | null }>;
    migrateContainer: (node: string, vmid: number, target: string) => Promise<string>;
    migrateVm: (node: string, vmid: number, target: string) => Promise<string>;
  };
  recordLbEvent: typeof import("@/lib/load-balancer/event-log").recordLbEvent;
}): Promise<number> {
  const {
    config,
    deployments,
    metrics,
    nodeScores,
    settings,
    guestMemOverrides,
    pendingActiveCount,
    proxmox,
    recordLbEvent,
  } = params;

  const { getRebalancePlan, updateRebalancePlan } = await import(
    "@/lib/load-balancer/plan-store"
  );
  const { effectiveMemBytes, validateTargetCapacity } = await import(
    "@/lib/load-balancer/guest-rules"
  );

  const plan = await getRebalancePlan();
  if (!plan || plan.status !== "active") return 0;

  // Resolve in-flight moves.
  for (const move of plan.moves) {
    if (move.status !== "migrating" || !move.upid) continue;
    try {
      const snapshot = await proxmox.getTaskSnapshot(move.sourceNode, move.upid);
      if (!snapshot.completed) continue;
      const ok = snapshot.exitStatus === "OK";
      move.status = ok ? "done" : "failed";
      move.error = ok ? null : (snapshot.exitStatus ?? "migration task failed");
      await updateRebalancePlan(plan.id, (p) => {
        const m = p.moves.find((x) => x.vmid === move.vmid);
        if (m) {
          m.status = move.status;
          m.error = move.error;
        }
      });
      if (!ok) {
        recordLbEvent({
          category: "migration-failed",
          level: "destructive",
          siteId: config.siteId,
          siteName: config.siteName,
          node: move.sourceNode,
          vmid: move.vmid,
          message: `Rebalance plan: migration of ${move.type.toUpperCase()} ${move.vmid} (${move.sourceNode} → ${move.targetNode}) failed: ${move.error}`,
          details: { cause: "rebalance-plan", planId: plan.id, error: move.error },
        }).catch(() => {});
      }
    } catch {
      // Task status unavailable this tick — leave the move in flight.
    }
  }

  // Fire the next queued move when the shared budget allows.
  let migrating = plan.moves.filter((m) => m.status === "migrating").length;
  if (pendingActiveCount + migrating < settings.maxConcurrentMigrations) {
    const next = plan.moves.find((m) => m.status === "queued");
    if (next) {
      const guest = deployments.find((d) => d.vmid === next.vmid);
      const targetScore = nodeScores.find((s) => s.node === next.targetNode);
      const targetMetrics = metrics.find((m) => m.node === next.targetNode);

      let skipReason: string | null = null;
      if (!guest || guest.rawStatus !== "running") {
        skipReason = "guest is no longer running";
      } else if (guest.node !== next.sourceNode) {
        skipReason = `guest is now on ${guest.node}, not ${next.sourceNode}`;
      } else if (
        !targetScore ||
        !validateTargetCapacity(
          targetMetrics,
          guest,
          targetScore,
          effectiveMemBytes(guest, guestMemOverrides),
        )
      ) {
        skipReason = `target ${next.targetNode} no longer has capacity`;
      }

      if (skipReason) {
        next.status = "skipped";
        next.error = skipReason;
        await updateRebalancePlan(plan.id, (p) => {
          const m = p.moves.find((x) => x.vmid === next.vmid);
          if (m) {
            m.status = "skipped";
            m.error = skipReason;
          }
        });
        recordLbEvent({
          category: "rebalance-plan",
          level: "warning",
          siteId: config.siteId,
          siteName: config.siteName,
          node: next.sourceNode,
          vmid: next.vmid,
          message: `Rebalance plan: skipped move of ${next.type.toUpperCase()} ${next.vmid} (${next.sourceNode} → ${next.targetNode}) — ${skipReason}.`,
          details: { planId: plan.id },
        }).catch(() => {});
      } else {
        try {
          const upid =
            next.type === "lxc"
              ? await proxmox.migrateContainer(next.sourceNode, next.vmid, next.targetNode)
              : await proxmox.migrateVm(next.sourceNode, next.vmid, next.targetNode);
          next.status = "migrating";
          next.upid = upid;
          migrating++;
          await updateRebalancePlan(plan.id, (p) => {
            const m = p.moves.find((x) => x.vmid === next.vmid);
            if (m) {
              m.status = "migrating";
              m.upid = upid;
            }
          });
          recordLbEvent({
            category: "migration-triggered",
            level: "info",
            siteId: config.siteId,
            siteName: config.siteName,
            node: next.sourceNode,
            vmid: next.vmid,
            message: `Rebalance plan: migrating ${next.type.toUpperCase()} ${next.vmid} from ${next.sourceNode} → ${next.targetNode}`,
            details: { cause: "rebalance-plan", planId: plan.id, targetNode: next.targetNode, upid },
          }).catch(() => {});
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          next.status = "failed";
          next.error = message;
          await updateRebalancePlan(plan.id, (p) => {
            const m = p.moves.find((x) => x.vmid === next.vmid);
            if (m) {
              m.status = "failed";
              m.error = message;
            }
          });
          recordLbEvent({
            category: "migration-failed",
            level: "destructive",
            siteId: config.siteId,
            siteName: config.siteName,
            node: next.sourceNode,
            vmid: next.vmid,
            message: `Rebalance plan: migration of ${next.type.toUpperCase()} ${next.vmid} (${next.sourceNode} → ${next.targetNode}) failed to start: ${message}`,
            details: { cause: "rebalance-plan", planId: plan.id, error: message },
          }).catch(() => {});
        }
      }
    }
  }

  // Finalize when nothing is left to do.
  const unresolved = plan.moves.some(
    (m) => m.status === "queued" || m.status === "migrating",
  );
  if (!unresolved) {
    await updateRebalancePlan(plan.id, (p) => {
      p.status = "completed";
    });
    const done = plan.moves.filter((m) => m.status === "done").length;
    const failed = plan.moves.filter((m) => m.status === "failed").length;
    const skipped = plan.moves.filter((m) => m.status === "skipped").length;
    recordLbEvent({
      category: "rebalance-plan",
      level: failed > 0 ? "warning" : "info",
      siteId: config.siteId,
      siteName: config.siteName,
      node: null,
      vmid: null,
      message: `Rebalance plan completed: ${done} moved, ${failed} failed, ${skipped} skipped.`,
      details: { planId: plan.id },
    }).catch(() => {});
  }

  return migrating;
}

const globalForLB = globalThis as typeof globalThis & {
  __tainerLoadBalancer?: ObserverState;
};

function getObserverState(): ObserverState {
  if (!globalForLB.__tainerLoadBalancer) {
    globalForLB.__tainerLoadBalancer = {
      running: false,
      startedAt: null,
      lastTickAt: null,
      lastError: null,
      tickCount: 0,
      tickInProgress: false,
      intervalId: null,
      siteStates: new Map(),
      lastTickErrorLog: new Map(),
    };
  }
  // Older observer instances survive hot reloads without the newer fields.
  globalForLB.__tainerLoadBalancer.lastTickErrorLog ??= new Map();
  return globalForLB.__tainerLoadBalancer;
}

function getSiteState(siteId: string, settings: LoadBalancerSettings): SiteState {
  const observer = getObserverState();
  let state = observer.siteStates.get(siteId);
  if (!state) {
    state = {
      nodeScores: [],
      clusterAverageScore: 0,
      ewmaStates: new Map(),
      hysteresisStates: new Map(),
      migrationCooldowns: new Map(),
      pendingMigrations: [],
      circuitBreaker: new NodeCircuitBreaker(),
      settings,
      lastMetrics: [],
      drainWarned: new Set(),
      scoreHistory: new Map(),
    };
    observer.siteStates.set(siteId, state);
  }
  state.settings = settings;
  return state;
}

async function tickSite(siteId: string, settings: LoadBalancerSettings): Promise<void> {
  const {
    withSiteConfig,
    getNodesWithPerNodeLatency,
    getDeploymentIndex,
    fetchGuestPenaltyData,
    getTaskSnapshot,
    migrateContainer,
    migrateVm,
  } = await import("@/lib/proxmox");
  const { resolveSiteConfigById } = await import("@/lib/site-resolver");
  // Lazy-import the event log so the LB module doesn't depend on
  // server-only at import time when used by lighter call sites.
  const { recordLbEvent } = await import("@/lib/load-balancer/event-log");

  const config = await resolveSiteConfigById(siteId);
  const siteState = getSiteState(siteId, settings);

  await withSiteConfig(config, async () => {
    // 1. Fetch node metrics with per-node latency measurement
    const { nodes, metrics } = await getNodesWithPerNodeLatency();
    const activeNodes = new Set(nodes.filter((n) => n.status === "online").map((n) => n.name));
    const openBefore = siteState.circuitBreaker.getOpenNodes();

    // 2. Update per-node EWMA latency from individual measurements
    for (const m of metrics) {
      if (!activeNodes.has(m.node)) continue;
      siteState.ewmaStates.set(
        m.node,
        updateEwma(siteState.ewmaStates.get(m.node), m.node, m.latencyMs, settings.ewmaAlpha),
      );
      siteState.circuitBreaker.recordSuccess(m.node);
    }

    // Record failures for online nodes that didn't return metrics
    for (const nodeName of activeNodes) {
      if (!metrics.some((m) => m.node === nodeName)) {
        siteState.circuitBreaker.recordFailure(nodeName);
      }
    }

    // Persist circuit-breaker transitions so an admin can audit flaky
    // nodes after the fact, not just see the current badge.
    const openAfter = siteState.circuitBreaker.getOpenNodes();
    for (const node of openAfter) {
      if (!openBefore.has(node)) {
        recordLbEvent({
          category: "circuit-breaker-opened",
          level: "warning",
          siteId: config.siteId,
          siteName: config.siteName,
          node,
          vmid: null,
          message: `Circuit breaker opened for node ${node} — repeated metric failures; node excluded from scoring until it recovers.`,
        }).catch(() => {});
      }
    }
    for (const node of openBefore) {
      if (!openAfter.has(node) && activeNodes.has(node)) {
        recordLbEvent({
          category: "circuit-breaker-closed",
          level: "info",
          siteId: config.siteId,
          siteName: config.siteName,
          node,
          vmid: null,
          message: `Circuit breaker closed for node ${node} — metrics recovered; node rejoined scoring.`,
        }).catch(() => {});
      }
    }

    // Prune stale EWMA entries
    const allNodeNames = new Set(nodes.map((n) => n.name));
    for (const key of siteState.ewmaStates.keys()) {
      if (!allNodeNames.has(key)) siteState.ewmaStates.delete(key);
    }
    siteState.circuitBreaker.prune(allNodeNames);

    // 3. Fetch deployment data for penalty check (isolated — failures here
    //    do NOT affect circuit breaker or node scores)
    const penaltyMap = new Map<string, NodePenalty[]>();
    // vmid → guest-actual memory from the balloon driver; corrects the
    // host-reported figure that counts the full ballooned allocation.
    const guestMemOverrides = new Map<number, number>();
    let deployments: Awaited<ReturnType<typeof getDeploymentIndex>>["deployments"] = [];

    try {
      const result = await getDeploymentIndex();
      deployments = result.deployments;
      const runningGuests = deployments.filter((d) => d.rawStatus === "running");

      if (runningGuests.length > 0) {
        const penaltyData = await fetchGuestPenaltyData(
          runningGuests.map((d) => ({ vmid: d.vmid, node: d.node, type: d.type })),
        );

        for (const pd of penaltyData) {
          if (pd.guestMemUsedBytes !== undefined) {
            guestMemOverrides.set(pd.vmid, pd.guestMemUsedBytes);
          }

          const penalties = penaltyMap.get(pd.node) ?? [];

          if (pd.type === "qemu" && pd.cpuSteal !== undefined && pd.cpuSteal > settings.cpuStealThresholdPercent / 100) {
            penalties.push({
              reason: `VM ${pd.vmid}: cpu_steal ${(pd.cpuSteal * 100).toFixed(1)}% > ${settings.cpuStealThresholdPercent}%`,
              value: settings.cpuStealPenalty,
            });
          }

          if (pd.type === "lxc" && pd.failcnt !== undefined && pd.failcnt > 0) {
            penalties.push({
              reason: `CT ${pd.vmid}: failcnt=${pd.failcnt}`,
              value: settings.failcntPenalty,
            });
          }

          if (penalties.length > 0) {
            penaltyMap.set(pd.node, penalties);
          }
        }
      }
    } catch (error) {
      // Deployment fetch failed — skip penalty data for this tick,
      // but do NOT mark nodes as failed
      console.warn(
        `[load-balancer] Deployment fetch failed, skipping penalties:`,
        error instanceof Error ? error.message : error,
      );
    }

    // 4. Compute scores
    const openNodes = siteState.circuitBreaker.getOpenNodes();
    const filteredMetrics = metrics.filter((m) => activeNodes.has(m.node) && !openNodes.has(m.node));

    siteState.nodeScores = computeNodeScores(
      filteredMetrics,
      siteState.ewmaStates,
      penaltyMap,
      settings.weights,
      settings.latencyMaxMs,
      {
        psiPenalty: settings.psiPenalty,
        psiThresholdPercent: settings.psiThresholdPercent,
      },
    );
    siteState.clusterAverageScore = computeClusterAverage(siteState.nodeScores);
    siteState.lastMetrics = metrics;

    // Feed the forecaster: one score sample per node per tick, pruning
    // history for nodes that left the cluster.
    const tickAt = Date.now();
    for (const score of siteState.nodeScores) {
      const history = siteState.scoreHistory.get(score.node) ?? [];
      siteState.scoreHistory.set(
        score.node,
        appendScoreSample(history, { at: tickAt, score: score.compositeScore }),
      );
    }
    for (const node of siteState.scoreHistory.keys()) {
      if (!allNodeNames.has(node)) siteState.scoreHistory.delete(node);
    }

    // 5. Resolve in-flight migrations. The concurrency cap counts
    //    unfinished migrations, so without this sweep a single completed
    //    move would block the budget until the 1-hour prune.
    for (const pending of siteState.pendingMigrations) {
      if (pending.completed || !pending.upid) continue;
      try {
        const snapshot = await getTaskSnapshot(pending.sourceNode, pending.upid);
        if (snapshot.completed) pending.completed = true;
      } catch {
        // Status unavailable (source node rebooting, task GC'd) — leave it
        // pending; the 1-hour prune is the backstop.
      }
    }
    const pendingActiveCount = siteState.pendingMigrations.filter((m) => !m.completed).length;

    // 6. Advance an applied rebalance plan (explicit admin action — takes
    //    priority over automatic moves and shares the concurrency budget).
    //    Skipped when the deployment fetch failed: re-validation against an
    //    empty list would wrongly skip every move.
    let planMigratingCount = 0;
    if (deployments.length > 0) {
      try {
        planMigratingCount = await executeRebalancePlanStep({
          config: { siteId: config.siteId, siteName: config.siteName },
          deployments,
          metrics,
          nodeScores: siteState.nodeScores,
          settings,
          guestMemOverrides,
          pendingActiveCount,
          proxmox: { getTaskSnapshot, migrateContainer, migrateVm },
          recordLbEvent,
        });
      } catch (error) {
        console.warn(
          `[load-balancer] Rebalance plan step failed:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    const activeMigrationCount = pendingActiveCount + planMigratingCount;

    // 7. Evaluate migration decisions: maintenance drains always run while
    //    a node is marked for maintenance; overload rebalancing requires
    //    the auto-migration toggle.
    const shouldEvaluate =
      deployments.length > 0 &&
      (settings.migrationEnabled || settings.maintenanceNodes.length > 0);

    if (shouldEvaluate) {
      let forecasts: Map<string, ScoreForecast> | undefined;
      if (settings.predictiveEnabled && settings.migrationEnabled) {
        forecasts = new Map();
        for (const [node, history] of siteState.scoreHistory) {
          const forecast = forecastScore(history, settings.predictiveHorizonMinutes, tickAt);
          if (forecast) forecasts.set(node, forecast);
        }
      }

      const { decisions, drainWarnings } = evaluateMigrationDecisions({
        scores: siteState.nodeScores,
        hysteresisStates: siteState.hysteresisStates,
        deployments,
        settings,
        migrationCooldowns: siteState.migrationCooldowns,
        nodeMetrics: metrics,
        activeMigrationCount,
        guestMemOverrides,
        forecasts,
      });

      for (const warning of drainWarnings) {
        const key = `${warning.node}:${warning.vmid}`;
        if (siteState.drainWarned.has(key)) continue;
        siteState.drainWarned.add(key);
        recordLbEvent({
          category: "drain-warning",
          level: "warning",
          siteId: config.siteId,
          siteName: config.siteName,
          node: warning.node,
          vmid: warning.vmid,
          message: warning.message,
        }).catch(() => {});
      }

      for (const decision of decisions) {
        // Dry-run: record what WOULD happen, touch nothing. Cooldowns set
        // by the evaluator still apply, so recommendations arrive at the
        // same pace real migrations would.
        if (settings.migrationDryRun) {
          console.log(
            `[load-balancer] Dry-run: would migrate ${decision.type} ${decision.vmid} from ${decision.sourceNode} to ${decision.targetNode} (${decision.reason})`,
          );
          recordLbEvent({
            category: "migration-recommended",
            level: "info",
            siteId: config.siteId,
            siteName: config.siteName,
            node: decision.sourceNode,
            vmid: decision.vmid,
            message: `Dry-run: would migrate ${decision.type.toUpperCase()} ${decision.vmid} from ${decision.sourceNode} → ${decision.targetNode}${decision.type === "lxc" ? " (restart migration — brief downtime)" : ""}`,
            details: {
              type: decision.type,
              targetNode: decision.targetNode,
              reason: decision.reason,
              cause: decision.cause,
              dryRun: true,
            },
          }).catch(() => {});
          continue;
        }

        try {
          const upid =
            decision.type === "lxc"
              ? await migrateContainer(decision.sourceNode, decision.vmid, decision.targetNode)
              : await migrateVm(decision.sourceNode, decision.vmid, decision.targetNode);

          siteState.pendingMigrations.push({
            vmid: decision.vmid,
            type: decision.type,
            sourceNode: decision.sourceNode,
            targetNode: decision.targetNode,
            reason: decision.reason,
            triggeredAt: Date.now(),
            upid,
            completed: false,
          });

          console.log(
            `[load-balancer] Migration triggered: ${decision.type} ${decision.vmid} from ${decision.sourceNode} to ${decision.targetNode} (${decision.reason})`,
          );

          recordLbEvent({
            category: "migration-triggered",
            level: "info",
            siteId: config.siteId,
            siteName: config.siteName,
            node: decision.sourceNode,
            vmid: decision.vmid,
            message: `Migrated ${decision.type.toUpperCase()} ${decision.vmid} from ${decision.sourceNode} → ${decision.targetNode}`,
            details: {
              type: decision.type,
              targetNode: decision.targetNode,
              reason: decision.reason,
              cause: decision.cause,
              upid,
            },
          }).catch(() => {});
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(
            `[load-balancer] Migration failed for ${decision.type} ${decision.vmid}:`,
            message,
          );

          recordLbEvent({
            category: "migration-failed",
            level: "destructive",
            siteId: config.siteId,
            siteName: config.siteName,
            node: decision.sourceNode,
            vmid: decision.vmid,
            message: `Migration of ${decision.type.toUpperCase()} ${decision.vmid} (${decision.sourceNode} → ${decision.targetNode}) failed: ${message}`,
            details: {
              type: decision.type,
              targetNode: decision.targetNode,
              reason: decision.reason,
              cause: decision.cause,
              error: message,
            },
          }).catch(() => {});
        }
      }
    }

    // 8. Prune old pending migrations (>1 hour), expired cooldowns, and
    //    drain warnings for nodes no longer in maintenance (so a future
    //    drain of the same node warns again).
    const now = Date.now();
    siteState.pendingMigrations = siteState.pendingMigrations.filter(
      (m) => m.triggeredAt > now - 3_600_000,
    );
    for (const [node, cooldownUntil] of siteState.migrationCooldowns) {
      if (now > cooldownUntil) siteState.migrationCooldowns.delete(node);
    }
    const maintenanceSet = new Set(settings.maintenanceNodes);
    for (const key of siteState.drainWarned) {
      if (!maintenanceSet.has(key.split(":")[0])) siteState.drainWarned.delete(key);
    }
  });
}

/**
 * Race a promise against a timeout. If the timeout fires first, the
 * original promise is left running in background (no cancellation in JS)
 * but the caller can proceed.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function tick(): Promise<void> {
  const state = getObserverState();

  if (state.tickInProgress) return;
  state.tickInProgress = true;

  try {
    state.tickCount++;

    const { listEnabledSites } = await import("@/lib/site-store");
    const { getLoadBalancerSettings } = await import("@/lib/load-balancer/settings");

    const sites = await listEnabledSites();

    // Run all sites in parallel — they're isolated (different Proxmox
    // clusters, different agent pools). Sequential iteration meant a single
    // unresponsive site blocked all others for up to tickTimeoutSeconds.
    const { withSiteConfig } = await import("@/lib/proxmox");
    const { resolveSiteConfig } = await import("@/lib/site-resolver");

    await Promise.all(
      sites.map(async (site) => {
        let config: Awaited<ReturnType<typeof resolveSiteConfig>> | null = null;
        try {
          config = await resolveSiteConfig(site);
          const settings = await withSiteConfig(config, () => getLoadBalancerSettings());

          if (!settings.enabled) {
            state.siteStates.delete(site.id);
            return;
          }

          const timeoutMs = settings.tickTimeoutSeconds * 1000;
          await withTimeout(
            tickSite(site.id, settings),
            timeoutMs,
            `tickSite(${site.name})`,
          );
          state.lastTickErrorLog.delete(site.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[load-balancer] Tick error for site ${site.name}:`, message);

          // Persist to the site's event log, rate-limited so a downed
          // Proxmox doesn't flood the log at poll-interval frequency.
          const last = state.lastTickErrorLog.get(site.id);
          const shouldRecord =
            config !== null &&
            (!last ||
              last.message !== message ||
              Date.now() - last.at > TICK_ERROR_LOG_INTERVAL_MS);

          if (shouldRecord && config) {
            state.lastTickErrorLog.set(site.id, { at: Date.now(), message });
            const siteConfig = config;
            try {
              const { recordLbEvent } = await import("@/lib/load-balancer/event-log");
              await withSiteConfig(siteConfig, () =>
                recordLbEvent({
                  category: "tick-error",
                  level: "warning",
                  siteId: siteConfig.siteId,
                  siteName: siteConfig.siteName,
                  node: null,
                  vmid: null,
                  message: `Load balancer tick failed: ${message}`,
                }),
              );
            } catch {
              // Event log unavailable — the console line above is the fallback.
            }
          }
        }
      }),
    );

    state.lastTickAt = new Date().toISOString();
    state.lastError = null;
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : "Observer tick failed";
  } finally {
    state.tickInProgress = false;
  }
}

export function startLoadBalancerObserver(): void {
  const state = getObserverState();

  if (state.running && state.intervalId != null) return;

  state.running = true;
  state.startedAt = new Date().toISOString();

  const intervalMs = DEFAULT_LB_SETTINGS.pollIntervalSeconds * 1000;

  state.intervalId = setInterval(() => {
    tick().catch((err) => {
      console.error("[load-balancer] Unhandled tick error:", err);
    });
  }, intervalMs);

  console.log(`[load-balancer] Observer started (interval: ${intervalMs}ms)`);
}

export function getLoadBalancerStatus(siteId: string): LoadBalancerStatus {
  const observer = getObserverState();
  const siteState = observer.siteStates.get(siteId);

  return {
    enabled: siteState?.settings.enabled ?? false,
    running: observer.running,
    startedAt: observer.startedAt,
    lastTickAt: observer.lastTickAt,
    lastError: observer.lastError,
    tickCount: observer.tickCount,
    pollIntervalMs: (siteState?.settings.pollIntervalSeconds ?? DEFAULT_LB_SETTINGS.pollIntervalSeconds) * 1000,
    nodeScores: siteState?.nodeScores ?? [],
    clusterAverageScore: siteState?.clusterAverageScore ?? 0,
    pendingMigrations: siteState?.pendingMigrations ?? [],
    circuitBreakers: siteState?.circuitBreaker.getSnapshot() ?? [],
  };
}

export function getNodeScoresForSite(siteId: string): NodeScore[] {
  const observer = getObserverState();
  return observer.siteStates.get(siteId)?.nodeScores ?? [];
}

/**
 * Last-loaded settings for a site, or null before the observer has ticked
 * it. Lets placement callers respect excluded/maintenance nodes without
 * re-reading the settings file.
 */
export function getSiteLbSettings(siteId: string): LoadBalancerSettings | null {
  const observer = getObserverState();
  return observer.siteStates.get(siteId)?.settings ?? null;
}

/** Node metrics captured on the site's last observer tick (for planning). */
export function getSiteMetricsSnapshot(siteId: string): LiveNodeMetrics[] {
  const observer = getObserverState();
  return observer.siteStates.get(siteId)?.lastMetrics ?? [];
}
