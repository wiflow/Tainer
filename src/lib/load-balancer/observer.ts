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
import { evaluateMigrationTriggers } from "./migration-trigger";
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
};

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
    };
  }
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
    migrateContainer,
    migrateVm,
  } = await import("@/lib/proxmox");
  const { resolveSiteConfigById } = await import("@/lib/site-resolver");

  const config = await resolveSiteConfigById(siteId);
  const siteState = getSiteState(siteId, settings);

  await withSiteConfig(config, async () => {
    // 1. Fetch node metrics with per-node latency measurement
    const { nodes, metrics } = await getNodesWithPerNodeLatency();
    const activeNodes = new Set(nodes.filter((n) => n.status === "online").map((n) => n.name));

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

    // Prune stale EWMA entries
    const allNodeNames = new Set(nodes.map((n) => n.name));
    for (const key of siteState.ewmaStates.keys()) {
      if (!allNodeNames.has(key)) siteState.ewmaStates.delete(key);
    }
    siteState.circuitBreaker.prune(allNodeNames);

    // 3. Fetch deployment data for penalty check (isolated — failures here
    //    do NOT affect circuit breaker or node scores)
    const penaltyMap = new Map<string, NodePenalty[]>();
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
    );
    siteState.clusterAverageScore = computeClusterAverage(siteState.nodeScores);
    siteState.lastMetrics = metrics;

    // 5. Evaluate migration triggers (with capacity validation)
    if (settings.migrationEnabled && deployments.length > 0) {
      const decisions = evaluateMigrationTriggers(
        siteState.nodeScores,
        siteState.hysteresisStates,
        deployments,
        settings,
        siteState.migrationCooldowns,
        metrics,
      );

      for (const decision of decisions) {
        try {
          const upid =
            decision.type === "lxc"
              ? await migrateContainer(decision.sourceNode, decision.vmid, decision.targetNode)
              : await migrateVm(decision.sourceNode, decision.vmid, decision.targetNode);

          siteState.pendingMigrations.push({
            ...decision,
            triggeredAt: Date.now(),
            upid,
            completed: false,
          });

          console.log(
            `[load-balancer] Migration triggered: ${decision.type} ${decision.vmid} from ${decision.sourceNode} to ${decision.targetNode} (${decision.reason})`,
          );
        } catch (error) {
          console.error(
            `[load-balancer] Migration failed for ${decision.type} ${decision.vmid}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    }

    // 6. Prune old pending migrations (>1 hour) and expired cooldowns
    const now = Date.now();
    siteState.pendingMigrations = siteState.pendingMigrations.filter(
      (m) => m.triggeredAt > now - 3_600_000,
    );
    for (const [node, cooldownUntil] of siteState.migrationCooldowns) {
      if (now > cooldownUntil) siteState.migrationCooldowns.delete(node);
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
        try {
          const config = await resolveSiteConfig(site);
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
        } catch (error) {
          console.error(
            `[load-balancer] Tick error for site ${site.name}:`,
            error instanceof Error ? error.message : error,
          );
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
