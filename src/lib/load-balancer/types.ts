export type ScoreWeights = {
  cpu: number;
  memory: number;
  latency: number;
  disk: number;
};

export type NodePenalty = {
  reason: string;
  value: number;
};

export type NodeScore = {
  node: string;
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  ewmaLatencyMs: number;
  compositeScore: number;
  penalties: NodePenalty[];
  penaltyTotal: number;
  updatedAt: number;
};

export type EwmaState = {
  node: string;
  value: number;
  sampleCount: number;
  lastUpdatedAt: number;
};

export type HysteresisState = {
  consecutiveBreaches: number;
  firstBreachAt: number | null;
  lastBreachAt: number | null;
};

export type CircuitBreakerState = {
  failures: number;
  lastFailureAt: number | null;
  openUntil: number | null;
};

export type CircuitBreakerSnapshot = {
  node: string;
  state: "closed" | "open" | "half-open";
  failureCount: number;
  lastFailureAt: number | null;
  cooldownEndsAt: number | null;
};

export type PendingMigration = {
  vmid: number;
  type: "lxc" | "qemu";
  sourceNode: string;
  targetNode: string;
  reason: string;
  triggeredAt: number;
  upid: string | null;
  completed: boolean;
};

export type MigrationDecision = {
  vmid: number;
  type: "lxc" | "qemu";
  sourceNode: string;
  targetNode: string;
  reason: string;
  /**
   * Why this move was decided: sustained overload, a high-confidence
   * forecast of imminent overload, or an admin draining a node.
   */
  cause: "overload" | "predicted-overload" | "maintenance-drain";
};

/**
 * A daily time window in which container (restart) migrations are allowed.
 * Times are "HH:MM" in the server's local timezone. A window may wrap
 * midnight (e.g. 22:00–06:00).
 */
export type MigrationWindow = {
  start: string;
  end: string;
};

export type ContainerMigrationMode = "never" | "windows-only" | "always";

export type LoadBalancerStatus = {
  enabled: boolean;
  running: boolean;
  startedAt: string | null;
  lastTickAt: string | null;
  lastError: string | null;
  tickCount: number;
  pollIntervalMs: number;
  nodeScores: NodeScore[];
  clusterAverageScore: number;
  pendingMigrations: PendingMigration[];
  circuitBreakers: CircuitBreakerSnapshot[];
};

export type LoadBalancerSettings = {
  enabled: boolean;
  pollIntervalSeconds: number;
  weights: ScoreWeights;
  migrationEnabled: boolean;
  /**
   * When true, migration decisions are recorded as "migration-recommended"
   * events instead of being executed. Safe default for building trust in the
   * balancer before letting it move workloads.
   */
  migrationDryRun: boolean;
  /**
   * LXC containers cannot live-migrate in Proxmox — a migration is
   * stop → transfer → start, with real downtime. "never" exempts containers
   * from automatic balancing entirely, "windows-only" allows moves inside
   * containerMigrationWindows, "always" treats them like VMs.
   */
  containerMigrations: ContainerMigrationMode;
  containerMigrationWindows: MigrationWindow[];
  /** Cap on cluster-wide in-flight migrations (auto-triggered + drain). */
  maxConcurrentMigrations: number;
  /**
   * Nodes being drained for maintenance: never a migration or placement
   * target, and the balancer evacuates their guests one at a time.
   */
  maintenanceNodes: string[];
  migrationThresholdPercent: number;
  migrationConsecutivePolls: number;
  migrationCooldownSeconds: number;
  /**
   * A migration target's score must be at least this % lower than the
   * source's, or the move is skipped — the cost-benefit floor that stops
   * marginal moves.
   */
  minTargetImprovementPercent: number;
  cpuStealPenalty: number;
  cpuStealThresholdPercent: number;
  failcntPenalty: number;
  /**
   * PSI (Pressure Stall Information, PVE 9+) penalty: added per resource
   * (CPU/memory/IO) whose 10s "some" stall average exceeds the threshold.
   * Pressure catches contention utilization can't — a node at 60% CPU can
   * still be stalling tasks badly. Nodes without PSI are unaffected.
   */
  psiPenalty: number;
  psiThresholdPercent: number;
  /**
   * Predictive balancing: act on a high-confidence linear forecast of a
   * node's score crossing the migration threshold within the horizon,
   * instead of waiting for the overload to materialize. Forecasts below
   * the confidence floor (R²) never act.
   */
  predictiveEnabled: boolean;
  predictiveHorizonMinutes: number;
  predictiveMinConfidencePercent: number;
  ewmaAlpha: number;
  latencyMaxMs: number;
  tickTimeoutSeconds: number;
  excludedNodes: string[];
  excludedVmids: number[];
  updatedAt: string | null;
};
