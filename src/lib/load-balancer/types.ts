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
  cause: "overload" | "predicted-overload" | "maintenance-drain";
};

/** Times are "HH:MM" in the server's local timezone; a window may wrap midnight. */
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
  migrationDryRun: boolean;
  /** LXC containers cannot live-migrate in Proxmox, so every move has downtime. */
  containerMigrations: ContainerMigrationMode;
  containerMigrationWindows: MigrationWindow[];
  maxConcurrentMigrations: number;
  maintenanceNodes: string[];
  migrationThresholdPercent: number;
  migrationConsecutivePolls: number;
  migrationCooldownSeconds: number;
  minTargetImprovementPercent: number;
  cpuStealPenalty: number;
  cpuStealThresholdPercent: number;
  failcntPenalty: number;
  /** Added per resource whose PSI 10s "some" average exceeds psiThresholdPercent. */
  psiPenalty: number;
  psiThresholdPercent: number;
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
