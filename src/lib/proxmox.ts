import "server-only";

import http from "node:http";
import https from "node:https";
import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";

import { getExtraCaCerts } from "@/lib/aia-fetch";
import type { ResolvedSiteConfig } from "@/lib/site-types";
import { parseTainerMeta } from "@/lib/tainer-meta";
import { getProxmoxTagColorSpec } from "@/lib/tag-utils";
import { buildProxmoxUrl, formatBytes, formatUptime, titleFromTemplateFile } from "@/lib/utils";

// React.cache covers App Router renders; AsyncLocalStorage covers API routes.
const siteConfigALS = new AsyncLocalStorage<ResolvedSiteConfig>();

const getRequestConfigHolder = cache((): { config: ResolvedSiteConfig | null } => ({
  config: null,
}));

export function setSiteConfigForRequest(config: ResolvedSiteConfig): void {
  getRequestConfigHolder().config = config;
}

export function withSiteConfig<T>(
  config: ResolvedSiteConfig,
  fn: () => T | Promise<T>,
): Promise<T> {
  setSiteConfigForRequest(config);
  return siteConfigALS.run(config, () => Promise.resolve(fn()));
}

export function getActiveSiteConfig(): ResolvedSiteConfig {
  const fromReactCache = getRequestConfigHolder().config;
  if (fromReactCache) return fromReactCache;

  const fromALS = siteConfigALS.getStore();
  if (fromALS) return fromALS;

  const legacy = getLegacyEnvConfig();
  if (legacy) return legacy;

  throw new Error(
    "No site context is set. Wrap this call in withSiteConfig() or configure PROXMOX_* env vars.",
  );
}

export function hasSiteConfig(): boolean {
  return Boolean(
    getRequestConfigHolder().config ||
    siteConfigALS.getStore() ||
    getLegacyEnvConfig(),
  );
}

type ProxmoxEnvelope<T> = {
  data: T | null;
  message?: string;
};

type RequestOptions = {
  method?: "DELETE" | "GET" | "POST" | "PUT";
  params?: URLSearchParams;
};

type ProxmoxClusterOptionsResponse = {
  "tag-style"?: string;
  [key: string]: unknown;
};

type ProxmoxNodeResponse = {
  id: string;
  node: string;
  ssl_fingerprint?: string;
  status?: string;
  type: string;
};

type ProxmoxStorageResponse = {
  active?: number;
  avail?: number;
  content?: string;
  enabled?: number;
  shared?: number;
  storage: string;
  total?: number;
  type?: string;
  used?: number;
  used_fraction?: number;
};

type ProxmoxStorageContentResponse = {
  content: string;
  ctime?: number;
  size?: number;
  volid: string;
};

type ProxmoxAplInfoResponse = {
  architecture?: string;
  description?: string;
  headline?: string;
  location?: string;
  os?: string;
  section?: string;
  source?: string;
  template?: string;
  type?: string;
  version?: string;
};

type ProxmoxLxcListResponse = {
  cpu?: number;
  cpus?: number;
  disk?: number;
  maxdisk?: number;
  maxmem?: number;
  mem?: number;
  name?: string;
  status?: string;
  tags?: string;
  template?: number;
  uptime?: number;
  vmid: number;
};

type ProxmoxLxcConfigResponse = {
  cores?: number | string;
  description?: string;
  digest?: string;
  env?: string;
  hostname?: string;
  memory?: number | string;
  nameserver?: string;
  net0?: string;
  ostemplate?: string;
  rootfs?: string;
  searchdomain?: string;
  swap?: number | string;
  tags?: string;
  [key: string]: unknown;
};

type ProxmoxLxcStatusResponse = {
  cpu?: number;
  cpus?: number;
  disk?: number;
  diskread?: number;
  diskwrite?: number;
  maxdisk?: number;
  maxmem?: number;
  mem?: number;
  name?: string;
  netin?: number;
  netout?: number;
  status?: string;
  uptime?: number;
  vmid?: number;
};

type ProxmoxLxcInterfaceResponse = {
  hwaddr?: string;
  inet?: string;
  inet6?: string;
  name?: string;
};

type ProxmoxQemuAgentNetworkResponse = {
  result?: {
    "hardware-address"?: string;
    "ip-addresses"?: {
      "ip-address"?: string;
      "ip-address-type"?: string;
      prefix?: number;
    }[];
    name?: string;
  }[];
};

type ProxmoxQemuListResponse = {
  cpu?: number;
  cpus?: number;
  disk?: number;
  maxdisk?: number;
  maxmem?: number;
  mem?: number;
  name?: string;
  status?: string;
  tags?: string;
  template?: number;
  uptime?: number;
  vmid: number;
};

type ProxmoxQemuConfigResponse = {
  agent?: string;
  balloon?: number;
  boot?: string;
  cores?: number | string;
  cpu?: string;
  description?: string;
  digest?: string;
  ide0?: string;
  ide2?: string;
  machine?: string;
  memory?: number | string;
  name?: string;
  net0?: string;
  numa?: number;
  ostype?: string;
  scsi0?: string;
  scsihw?: string;
  sockets?: number | string;
  tags?: string;
  vga?: string;
};

type ProxmoxQemuStatusResponse = {
  cpu?: number;
  cpus?: number;
  disk?: number;
  diskread?: number;
  diskwrite?: number;
  maxdisk?: number;
  maxmem?: number;
  mem?: number;
  name?: string;
  netin?: number;
  netout?: number;
  pid?: number;
  qmpstatus?: string;
  status?: string;
  uptime?: number;
  vmid?: number;
};

type ProxmoxPsiWindow = {
  avg10?: number | string;
  avg60?: number | string;
  avg300?: number | string;
};

type ProxmoxPsiEntry = {
  some?: ProxmoxPsiWindow;
  full?: ProxmoxPsiWindow;
};

type ProxmoxNodeStatusResponse = {
  cpu?: number;
  loadavg?: Array<number | string>;
  memory?: {
    available?: number;
    free?: number;
    total?: number;
    used?: number;
  };
  pressure?: {
    cpu?: ProxmoxPsiEntry;
    io?: ProxmoxPsiEntry;
    memory?: ProxmoxPsiEntry;
  };
  rootfs?: {
    avail?: number;
    free?: number;
    total?: number;
    used?: number;
  };
  swap?: {
    free?: number;
    total?: number;
    used?: number;
  };
  uptime?: number;
};

type ProxmoxTaskStatusResponse = {
  exitstatus?: string;
  id?: string;
  node?: string;
  starttime?: number;
  status?: string;
  type?: string;
  upid?: string;
};

type ProxmoxTaskLogEntryResponse = {
  n?: number;
  t?: string;
};

type ProxmoxTaskListEntryResponse = {
  endtime?: number;
  starttime?: number;
  status?: string;
  type?: string;
  upid?: string;
};

export type ProxmoxIssue = {
  endpoint: string;
  message: string;
  requiredPrivileges: string[];
  scope?: string;
};

export type DeploymentActivity = {
  label: string;
  occurredAt: string | null;
};

export type LiveNode = {
  fingerprint: string;
  name: string;
  status: string;
};

export type LiveTemplate = {
  createdAt: string | null;
  fileName: string;
  id: string;
  name: string;
  node: string;
  sizeLabel: string;
  storage: string;
  volid: string;
};

export type AvailableTemplate = {
  architecture: string;
  description: string;
  fileName: string;
  headline: string;
  location: string;
  node: string;
  os: string;
  section: string;
  source: string;
  storage: string;
  version: string;
};

export type TemplateTarget = {
  node: string;
  shared: boolean;
  storage: string;
};

export type RootfsTarget = {
  availableBytes: number | null;
  node: string;
  shared: boolean;
  storage: string;
  totalBytes: number | null;
  type: string;
  usageRatio: number | null;
  usedBytes: number | null;
};

export type LiveStoragePool = {
  availableBytes: number | null;
  contentTypes: string[];
  id: string;
  isIsoCapable: boolean;
  isRootfsCapable: boolean;
  isSnippetCapable: boolean;
  isTemplateCapable: boolean;
  node: string;
  shared: boolean;
  storage: string;
  totalBytes: number | null;
  type: string;
  usageRatio: number | null;
  usedBytes: number | null;
};

/** 10-second average PSI stall percentages; null before PVE 9. */
export type NodePressure = {
  cpuSomeAvg10: number | null;
  memorySomeAvg10: number | null;
  memoryFullAvg10: number | null;
  ioSomeAvg10: number | null;
  ioFullAvg10: number | null;
};

export type LiveNodeMetrics = {
  cpuRatio: number | null;
  loadAverage: number[];
  memoryTotalBytes: number | null;
  memoryUsedBytes: number | null;
  node: string;
  pressure?: NodePressure | null;
  rootfsTotalBytes: number | null;
  rootfsUsedBytes: number | null;
  swapTotalBytes: number | null;
  swapUsedBytes: number | null;
  uptimeSeconds: number | null;
};

export type ClusterResourceSummary = {
  cpuRatio: number | null;
  loadAverage: number[];
  memoryTotalBytes: number;
  memoryUsedBytes: number;
  rootfsTotalBytes: number;
  rootfsUsedBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
};

export type LiveDeployment = {
  cpu: string;
  cpuUsage: number | null;
  disk: string;
  diskTotalBytes: number | null;
  diskUsedBytes: number | null;
  environmentMode: string;
  id: string;
  ipAddress: string;
  memTotalBytes: number | null;
  memUsedBytes: number | null;
  memory: string;
  name: string;
  node: string;
  rawStatus: string;
  statusLabel: string;
  tagList: string[];
  tainerMeta: import("@/lib/tainer-meta").TainerMeta | null;
  templateName: string;
  type: "lxc" | "qemu";
  uptime: string;
  vmid: number;
};

export type ContainerResourceUsage = {
  cpuRatio: number;
  diskReadBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  diskWriteBytes: number;
  memUsedBytes: number;
  memTotalBytes: number;
  netInBytes: number;
  netOutBytes: number;
};

export type LiveDeploymentDetail = LiveDeployment & {
  configAccessible: boolean;
  coresConfigured: number | null;
  memoryConfiguredMb: number | null;
  swapConfiguredMb: number | null;
  description: string;
  digest: string;
  envCount: number;
  envText: string;
  guestOsType?: string;
  issues: ProxmoxIssue[];
  networkInfo: NetworkInfo | null;
  ostemplate: string;
  resourceUsage: ContainerResourceUsage | null;
  rootfs: string;
  vmCpuType?: string;
  vmSockets?: number;
  vmMachineType?: string;
  vmScsiHw?: string;
  vmVga?: string;
  vmIso?: string;
};

export type LiveSnapshot = {
  createdAt: string | null;
  description: string;
  hasVmState: boolean;
  name: string;
  parent: string | null;
};

export type ContainerLifecycleAction = "restart" | "shutdown" | "start" | "stop";

export type VmLifecycleAction = "reset" | "restart" | "resume" | "shutdown" | "start" | "stop" | "suspend";

export type ProxmoxTaskSnapshot = {
  completed: boolean;
  exitStatus: string | null;
  latestLog: string | null;
  message: string;
  node: string;
  progress: number;
  status: "error" | "running" | "success" | "warning";
  taskId: string;
  taskType: string;
  upid: string;
};

export type OverviewData = {
  availableTemplates: AvailableTemplate[];
  clusterResources: ClusterResourceSummary | null;
  connected: boolean;
  deployments: LiveDeployment[];
  issues: ProxmoxIssue[];
  nextId: string | null;
  nodeMetrics: LiveNodeMetrics[];
  nodes: LiveNode[];
  storagePools: LiveStoragePool[];
  templates: LiveTemplate[];
  version: string | null;
};

export type DashboardOverviewData = {
  clusterResources: ClusterResourceSummary | null;
  deployments: LiveDeployment[];
  issues: ProxmoxIssue[];
  nodeMetrics: LiveNodeMetrics[];
  nodes: LiveNode[];
};

type SafeResult<T> = {
  data: T | null;
  issue: ProxmoxIssue | null;
};

const PROXMOX_NODE_NAME_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,61}[a-zA-Z0-9])?$/;
const PROXMOX_STORAGE_NAME_REGEX = /^[a-zA-Z0-9._-]{1,63}$/;
const PROXMOX_GET_CACHE_TTL_MS = 10_000;
const TEMPLATE_CONTENT_INDEX_TTL_MS = 10_000;
const TASK_UPID_DETAILS_REGEX = /^UPID:([^:]+):[0-9A-Fa-f]+:[0-9A-Fa-f]+:([0-9A-Fa-f]+):([^:]+):([^:]*):([^:]+):$/;
const IGNORED_DEPLOYMENT_TASK_TYPES = new Set([
  "spiceproxy",
  "termproxy",
  "vncshell",
  "vncproxy",
]);
const proxmoxGetCache = new Map<string, { expiresAt: number; value: unknown }>();
const proxmoxGetInflight = new Map<string, Promise<unknown>>();

// Proxmox delays each failed login by 3 seconds, so repeated 401s fail fast.
const AUTH_CIRCUIT_BREAKER_THRESHOLD = 3;
const AUTH_CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;
const authCircuitBreaker = new Map<string, { trippedAt: number; consecutiveFailures: number }>();

function checkAuthCircuitBreaker(siteId: string): boolean {
  const state = authCircuitBreaker.get(siteId);
  if (!state || state.consecutiveFailures < AUTH_CIRCUIT_BREAKER_THRESHOLD) return false;
  if (Date.now() - state.trippedAt > AUTH_CIRCUIT_BREAKER_COOLDOWN_MS) {
    state.consecutiveFailures = 0;
    return false;
  }
  return true;
}

function recordAuthSuccess(siteId: string) {
  authCircuitBreaker.delete(siteId);
}

function recordAuthFailure(siteId: string) {
  const state = authCircuitBreaker.get(siteId);
  if (state) {
    state.consecutiveFailures++;
    state.trippedAt = Date.now();
  } else {
    authCircuitBreaker.set(siteId, { trippedAt: Date.now(), consecutiveFailures: 1 });
  }
}

function invalidateProxmoxGetCache(endpoint: string, siteId?: string) {
  const resolvedSiteId = siteId ?? siteConfigALS.getStore()?.siteId ?? "__env__";
  const cacheKey = `${resolvedSiteId}::GET:/api2/json${endpoint}`;
  proxmoxGetCache.delete(cacheKey);
  proxmoxGetInflight.delete(cacheKey);
}

function parseTagStyleOptions(tagStyle?: string) {
  const entries = new Map<string, string>();

  if (!tagStyle?.trim()) {
    return entries;
  }

  for (const rawSegment of tagStyle.split(",")) {
    const segment = rawSegment.trim();

    if (!segment) {
      continue;
    }

    const separatorIndex = segment.indexOf("=");

    if (separatorIndex < 0) {
      entries.set(segment, "");
      continue;
    }

    entries.set(
      segment.slice(0, separatorIndex).trim(),
      segment.slice(separatorIndex + 1).trim(),
    );
  }

  return entries;
}

function serializeTagStyleOptions(options: Map<string, string>) {
  return [...options.entries()]
    .map(([key, value]) => (value ? `${key}=${value}` : key))
    .join(",");
}

function parseTagStyleColorMap(colorMap?: string) {
  const entries = new Map<string, string>();

  if (!colorMap?.trim()) {
    return entries;
  }

  for (const rawEntry of colorMap.split(";")) {
    const entry = rawEntry.trim();

    if (!entry) {
      continue;
    }

    const separatorIndex = entry.indexOf(":");

    if (separatorIndex < 0) {
      continue;
    }

    const tag = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();

    if (!tag || !value) {
      continue;
    }

    entries.set(tag, value);
  }

  return entries;
}

function serializeTagStyleColorMap(colorMap: Map<string, string>) {
  return [...colorMap.entries()]
    .map(([tag, value]) => `${tag}:${value}`)
    .join(";");
}

const templateContentIndexCache = new Map<
  string,
  {
    expiresAt: number;
    value: Map<string, { ctime: number; size: number }>;
  }
>();
const templateContentIndexInflight = new Map<
  string,
  Promise<Map<string, { ctime: number; size: number }>>
>();

class ProxmoxApiError extends Error {
  endpoint: string;
  requiredPrivileges: string[];
  scope?: string;

  constructor(message: string, endpoint: string) {
    super(message.trim());
    this.endpoint = endpoint;

    const permissionMatch = this.message.match(
      /Permission check failed \(([^,]+), ([^)]+)\)/,
    );

    this.scope = permissionMatch?.[1];
    this.requiredPrivileges = permissionMatch?.[2]
      ? permissionMatch[2].split("|")
      : [];
  }
}

function validateNodeName(node: string, label = "node") {
  const normalized = node.trim();

  if (!PROXMOX_NODE_NAME_REGEX.test(normalized)) {
    throw new Error(`Invalid ${label} name.`);
  }

  return normalized;
}

function validateStorageName(storage: string, label = "storage") {
  const normalized = storage.trim();

  if (!PROXMOX_STORAGE_NAME_REGEX.test(normalized)) {
    throw new Error(`Invalid ${label} name.`);
  }

  return normalized;
}

function validateBackupVolid(volid: string, storage: string) {
  const normalized = volid.trim();
  const match = /^([a-zA-Z0-9._-]{1,63}):(backup\/[a-zA-Z0-9._:/-]+)$/.exec(normalized);

  if (
    !match ||
    match[1] !== storage ||
    match[2].split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("Invalid backup volume ID.");
  }

  return normalized;
}

function validatePositiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label}.`);
  }

  return value;
}

let tlsWarningLogged = false;

function getLegacyEnvConfig(): ResolvedSiteConfig | null {
  const url = process.env.PROXMOX_URL;
  const username = process.env.PROXMOX_USERNAME;
  const password = process.env.PROXMOX_PASSWORD;

  if (!url || !username || !password) {
    return null;
  }

  const tlsInsecure = process.env.PROXMOX_TLS_INSECURE === "true";

  if (tlsInsecure && !tlsWarningLogged) {
    tlsWarningLogged = true;
    console.warn(
      "[proxmox] WARNING: PROXMOX_TLS_INSECURE=true. TLS certificate validation is disabled. " +
      "This exposes credentials to MITM attacks. Use proper certificates in production.",
    );
  }

  return {
    siteId: "__env__",
    siteSlug: "__env__",
    siteName: "Environment",

    apiUrl: url,
    username,
    password,
    tlsInsecure,
    tlsFingerprint: null,
    tlsCustomCaPem: null,

    defaultNode: process.env.PROXMOX_DEFAULT_NODE ?? "",
    defaultRootfsStorage: process.env.PROXMOX_DEFAULT_ROOTFS_STORAGE ?? "",
    defaultVmStorage: process.env.PROXMOX_DEFAULT_VM_STORAGE ?? "",
    defaultIsoStorage: process.env.PROXMOX_DEFAULT_ISO_STORAGE ?? "",
    defaultBackupStorage: "",
    defaultBackupSlaHours: 24,

    sshHostKeyPolicy: (process.env.PROXMOX_SSH_HOST_KEY_POLICY?.trim().toLowerCase() as ResolvedSiteConfig["sshHostKeyPolicy"]) || "accept-new",
    consoleKnownHostsContent: null,
  };
}

function sanitizeProxmoxMessage(message: string): string {
  // Strip credentials before truncating so no partial secret survives.
  return message
    .replace(/PVEAuthCookie=[^\s;]+/g, "[ticket]")
    .replace(/PVEAPIToken=[^\s]+/g, "[token]")
    .replace(/CSRFPreventionToken=[^\s]+/gi, "[csrf-token]")
    .replace(/\/[^\s]+/g, "[path]")
    .slice(0, 200);
}

function normalizeIssue(error: unknown, endpoint: string): ProxmoxIssue {
  if (error instanceof ProxmoxApiError) {
    return {
      endpoint,
      message: sanitizeProxmoxMessage(error.message),
      requiredPrivileges: error.requiredPrivileges,
      scope: error.scope,
    };
  }

  if (error instanceof Error) {
    return {
      endpoint,
      message: sanitizeProxmoxMessage(error.message),
      requiredPrivileges: [],
    };
  }

  return {
    endpoint,
    message: "Unknown Proxmox request failure",
    requiredPrivileges: [],
  };
}

function dedupeIssues(issues: ProxmoxIssue[]) {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const key = `${issue.endpoint}:${issue.message}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function parseJson<T>(raw: string) {
  try {
    return JSON.parse(raw) as ProxmoxEnvelope<T>;
  } catch {
    throw new Error("Failed to parse Proxmox response");
  }
}

function parseStorageContentTypes(value?: string) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeMaybeNumber(value?: number | null) {
  if (value == null || Number.isNaN(value)) {
    return null;
  }

  return value;
}

function toOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseLoadAverage(values?: Array<number | string>) {
  return (values ?? [])
    .map((value) =>
      typeof value === "number" ? value : Number.parseFloat(String(value)),
    )
    .filter((value) => !Number.isNaN(value));
}

function extractVmIsoVolid(config: Partial<ProxmoxQemuConfigResponse>) {
  const candidates = [config.ide0, config.ide2];

  for (const candidate of candidates) {
    const raw = candidate?.split(",")[0]?.trim() ?? "";
    if (raw && raw.includes(":") && !raw.endsWith(":cloudinit")) {
      return raw;
    }
  }

  return "";
}

function mapStoragePool(node: string, storage: ProxmoxStorageResponse): LiveStoragePool {
  const contentTypes = parseStorageContentTypes(storage.content);

  return {
    availableBytes: normalizeMaybeNumber(storage.avail),
    contentTypes,
    id: `${node}::${storage.storage}`,
    isIsoCapable: contentTypes.includes("iso"),
    isRootfsCapable: contentTypes.includes("rootdir"),
    isSnippetCapable: contentTypes.includes("snippets"),
    isTemplateCapable: contentTypes.includes("vztmpl"),
    node,
    shared: Boolean(storage.shared),
    storage: storage.storage,
    totalBytes: normalizeMaybeNumber(storage.total),
    type: storage.type ?? "unknown",
    usageRatio: normalizeMaybeNumber(storage.used_fraction),
    usedBytes: normalizeMaybeNumber(storage.used),
  };
}

function getStorageScopeKey(node: string, storage: Pick<ProxmoxStorageResponse, "shared" | "storage">) {
  return storage.shared ? storage.storage : `${node}::${storage.storage}`;
}

const TASK_PROGRESS_HINTS: Record<string, number> = {
  aptupdate: 12,
  download: 11,
  ociregistrypull: 15,
  qmclone: 15,
  qmcreate: 12,
  qmmigrate: 30,
  qmreboot: 1,
  qmshutdown: 1,
  qmstart: 1,
  qmstop: 1,
  startall: 3,
  vzdump: 25,
  vzcreate: 13,
  vzrestore: 30,
  vzreboot: 1,
  vzshutdown: 1,
  vzstart: 1,
  vzstop: 1,
};

const tlsOptionsCache = new Map<string, { result: { rejectUnauthorized: boolean; ca?: string[] }; expiresAt: number; connectionKey: string }>();
const tlsOptionsInflight = new Map<string, Promise<{ rejectUnauthorized: boolean; ca?: string[] }>>();
const TLS_OPTIONS_CACHE_TTL_MS = 30 * 60_000;
const TLS_OPTIONS_EMPTY_CACHE_TTL_MS = 2 * 60_000;

const httpsAgentCache = new Map<string, { agent: https.Agent; expiresAt: number }>();
const httpAgentCache = new Map<string, http.Agent>();
const KEEP_ALIVE_AGENT_OPTS = {
  keepAlive: true,
  keepAliveMsecs: 5000,
  maxSockets: 32,
  scheduling: "lifo" as const,
};

const REQUEST_TIMEOUT_MS = 15_000;

function getHttpsAgent(
  siteId: string,
  tlsOpts: { rejectUnauthorized: boolean; ca?: string[] },
): https.Agent {
  const cached = httpsAgentCache.get(siteId);
  if (cached && cached.expiresAt > Date.now()) return cached.agent;

  cached?.agent.destroy();

  const agent = new https.Agent({
    ...KEEP_ALIVE_AGENT_OPTS,
    ...tlsOpts,
  });
  httpsAgentCache.set(siteId, {
    agent,
    expiresAt: Date.now() + TLS_OPTIONS_CACHE_TTL_MS,
  });
  return agent;
}

function getHttpAgent(siteId: string): http.Agent {
  const existing = httpAgentCache.get(siteId);
  if (existing) return existing;
  const agent = new http.Agent(KEEP_ALIVE_AGENT_OPTS);
  httpAgentCache.set(siteId, agent);
  return agent;
}

function getSiteConnectionKey(config: ResolvedSiteConfig) {
  return JSON.stringify([
    config.apiUrl,
    config.username,
    config.tlsInsecure,
    config.tlsFingerprint,
    config.tlsCustomCaPem,
  ]);
}

async function buildTlsOptions(
  config: ResolvedSiteConfig,
): Promise<{ rejectUnauthorized: boolean; ca?: string[] }> {
  if (config.tlsInsecure) {
    return { rejectUnauthorized: false };
  }

  const connectionKey = getSiteConnectionKey(config);
  const cached = tlsOptionsCache.get(config.siteId);
  if (cached && cached.connectionKey === connectionKey && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const inflightKey = `${config.siteId}\n${connectionKey}`;
  const existing = tlsOptionsInflight.get(inflightKey);
  if (existing) return existing;

  const promise = buildTlsOptionsUncached(config);
  tlsOptionsInflight.set(inflightKey, promise);

  try {
    const result = await promise;
    tlsOptionsCache.set(config.siteId, {
      result,
      expiresAt: Date.now() + (result.ca ? TLS_OPTIONS_CACHE_TTL_MS : TLS_OPTIONS_EMPTY_CACHE_TTL_MS),
      connectionKey,
    });
    return result;
  } finally {
    tlsOptionsInflight.delete(inflightKey);
  }
}

async function buildTlsOptionsUncached(
  config: ResolvedSiteConfig,
): Promise<{ rejectUnauthorized: boolean; ca?: string[] }> {
  const extras: string[] = [];

  if (config.tlsCustomCaPem) {
    extras.push(config.tlsCustomCaPem);
  }

  try {
    const parsed = new URL(config.apiUrl);
    const aiaCerts = await getExtraCaCerts(
      parsed.hostname,
      parsed.port || "8006",
      config.tlsCustomCaPem,
    );
    if (aiaCerts.length > 0) {
      extras.push(...aiaCerts);
    }
  } catch {}

  if (extras.length > 0) {
    const { rootCertificates } = await import("node:tls");
    const seen = new Set<string>();
    const ca: string[] = [];
    for (const pem of [...rootCertificates, ...extras]) {
      const trimmed = pem.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        ca.push(trimmed);
      }
    }
    return { rejectUnauthorized: true, ca };
  }

  return { rejectUnauthorized: true };
}

type PveTicket = { ticket: string; csrfToken: string; expiresAt: number };
const pveTicketCache = new Map<string, PveTicket & { connectionKey: string }>();
const pveTicketInflight = new Map<string, Promise<PveTicket>>();

export async function getPveTicket(config: ResolvedSiteConfig): Promise<PveTicket> {
  const cacheKey = config.siteId;
  const connectionKey = getSiteConnectionKey(config);
  const cached = pveTicketCache.get(cacheKey);
  if (cached && cached.connectionKey === connectionKey && cached.expiresAt > Date.now() + 5 * 60_000) {
    return cached;
  }

  const inflightKey = `${cacheKey}\n${connectionKey}`;
  const existing = pveTicketInflight.get(inflightKey);
  if (existing) return existing;

  const promise = (async (): Promise<PveTicket> => {
    const loginUrl = buildProxmoxUrl("/api2/json/access/ticket", config.apiUrl);
    const loginBody = new URLSearchParams({
      username: config.username,
      password: config.password,
    }).toString();

    const tlsOpts = loginUrl.protocol === "https:" ? await buildTlsOptions(config) : {};
    const requestModule = loginUrl.protocol === "https:" ? https : http;
    const agent =
      loginUrl.protocol === "https:"
        ? getHttpsAgent(config.siteId, tlsOpts as { rejectUnauthorized: boolean; ca?: string[] })
        : getHttpAgent(config.siteId);

    const data = await new Promise<{ ticket?: string; CSRFPreventionToken?: string }>((resolve, reject) => {
      const req = requestModule.request(
        loginUrl,
        {
          agent,
          method: "POST",
          headers: {
            "Content-Length": Buffer.byteLength(loginBody),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          ...tlsOpts,
        },
        (res) => {
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => { raw += chunk; });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(raw);
              if (!parsed.data?.ticket) {
                reject(new Error(
                  `Proxmox login failed (HTTP ${res.statusCode}). Check username and password.`,
                ));
                return;
              }
              resolve(parsed.data);
            } catch {
              reject(new Error(`Proxmox login failed (HTTP ${res.statusCode}).`));
            }
          });
        },
      );
      req.on("error", (err) => reject(new Error(`Proxmox login failed: ${err.message}`)));
      req.write(loginBody);
      req.end();
    });

    const result: PveTicket = {
      ticket: data.ticket!,
      csrfToken: data.CSRFPreventionToken || "",
      expiresAt: Date.now() + 2 * 60 * 60_000,
    };
    pveTicketCache.set(cacheKey, { ...result, connectionKey });
    return result;
  })();

  pveTicketInflight.set(inflightKey, promise);
  try {
    return await promise;
  } finally {
    pveTicketInflight.delete(inflightKey);
  }
}

function clearPveTicket(siteId: string) {
  pveTicketCache.delete(siteId);
}

export function resetSiteConnection(siteId: string) {
  pveTicketCache.delete(siteId);
  tlsOptionsCache.delete(siteId);
  httpsAgentCache.get(siteId)?.agent.destroy();
  httpsAgentCache.delete(siteId);
  httpAgentCache.get(siteId)?.destroy();
  httpAgentCache.delete(siteId);
}

async function proxmoxRequest<T>(endpoint: string, options: RequestOptions = {}) {
  const config = getActiveSiteConfig();

  if (checkAuthCircuitBreaker(config.siteId)) {
    throw new ProxmoxApiError(
      "Authentication failed. Credentials may be invalid or expired. Requests paused to avoid delays. Will retry automatically.",
      endpoint,
    );
  }

  const method = options.method ?? "GET";

  // Keep the query out of the URL constructor so it is not encoded into the path.
  const qIdx = endpoint.indexOf("?");
  const endpointPath = qIdx >= 0 ? endpoint.slice(0, qIdx) : endpoint;
  const endpointQuery = qIdx >= 0 ? endpoint.slice(qIdx + 1) : "";

  if (/(^|\/)\.{1,2}(\/|$)|%2e|\\/i.test(endpointPath)) {
    throw new ProxmoxApiError("Invalid Proxmox API path.", endpoint);
  }

  const url = buildProxmoxUrl(`/api2/json${endpointPath}`, config.apiUrl);
  const query = options.params?.toString() || endpointQuery;
  const body = method === "GET" ? undefined : (options.params?.toString() || undefined);

  if (method === "GET" && query) {
    url.search = query;
  }

  const canCache =
    method === "GET" &&
    !body &&
    !endpoint.includes("/tasks/");
  const cacheKey = `${config.siteId}::${method}:${url.pathname}${url.search}`;

  if (canCache) {
    const cached = proxmoxGetCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }

    const inflight = proxmoxGetInflight.get(cacheKey);
    if (inflight) {
      return inflight as Promise<T>;
    }
  }

  const pveAuth = await getPveTicket(config);
  const tlsOpts = url.protocol === "https:" ? await buildTlsOptions(config) : {};
  const requestModule = url.protocol === "https:" ? https : http;
  const agent =
    url.protocol === "https:"
      ? getHttpsAgent(config.siteId, tlsOpts as { rejectUnauthorized: boolean; ca?: string[] })
      : getHttpAgent(config.siteId);

  const requestPromise = new Promise<T>((resolve, reject) => {
    const request = requestModule.request(
      url,
      {
        agent,
        headers: {
          Cookie: `PVEAuthCookie=${pveAuth.ticket}`,
          ...(method !== "GET" ? { CSRFPreventionToken: pveAuth.csrfToken } : {}),
          ...(body
            ? {
                "Content-Length": Buffer.byteLength(body),
                "Content-Type": "application/x-www-form-urlencoded",
              }
            : {}),
        },
        method,
        ...tlsOpts,
      },
      (response) => {
        if (response.statusCode === 401 || response.statusCode === 403) {
          clearPveTicket(config.siteId);
          recordAuthFailure(config.siteId);
        } else {
          recordAuthSuccess(config.siteId);
        }

        let raw = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          try {
            const parsed = parseJson<T>(raw);

            if (parsed.message) {
              reject(new ProxmoxApiError(parsed.message, endpoint));
              return;
            }

            resolve(parsed.data as T);
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on("error", (error) => {
      reject(new ProxmoxApiError(error.message, endpoint));
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy();
      reject(new ProxmoxApiError(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`, endpoint));
    });

    if (body) {
      request.write(body);
    }

    request.end();
  });

  if (!canCache) {
    return requestPromise;
  }

  proxmoxGetInflight.set(cacheKey, requestPromise);

  return requestPromise
    .then((value) => {
      proxmoxGetCache.set(cacheKey, {
        expiresAt: Date.now() + PROXMOX_GET_CACHE_TTL_MS,
        value,
      });
      return value;
    })
    .finally(() => {
      proxmoxGetInflight.delete(cacheKey);
    });
}

async function safeRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<SafeResult<T>> {
  try {
    return {
      data: await proxmoxRequest<T>(endpoint, options),
      issue: null,
    };
  } catch (error) {
    return {
      data: null,
      issue: normalizeIssue(error, endpoint),
    };
  }
}

function toIsoFromUnixSeconds(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

function parseTaskUpidDetails(upid: string) {
  const match = TASK_UPID_DETAILS_REGEX.exec(upid.trim());

  if (!match) {
    return null;
  }

  const startedAtSeconds = Number.parseInt(match[2] ?? "", 16);

  return {
    startedAtSeconds: Number.isNaN(startedAtSeconds) ? null : startedAtSeconds,
    taskType: match[3]?.trim() ?? "",
  };
}

function formatDeploymentTaskLabel(taskType: string) {
  const normalized = taskType.trim().toLowerCase();

  if (normalized === "vzdump" || normalized.includes("backup")) {
    return "Backed up";
  }

  if (normalized.includes("restore")) {
    return "Restored";
  }

  if (normalized.includes("migrate")) {
    return "Migrated";
  }

  if (normalized.includes("clone") || normalized.includes("create")) {
    return "Deployed";
  }

  if (normalized.includes("destroy") || normalized.includes("delete")) {
    return "Deleted";
  }

  if (normalized.includes("restart") || normalized.includes("reboot")) {
    return "Restarted";
  }

  if (normalized.includes("shutdown")) {
    return "Shutdown";
  }

  if (normalized.includes("stop")) {
    return "Stopped";
  }

  if (normalized.includes("start")) {
    return "Started";
  }

  if (normalized.includes("resume")) {
    return "Resumed";
  }

  if (normalized.includes("suspend")) {
    return "Suspended";
  }

  if (normalized.includes("reset")) {
    return "Reset";
  }

  if (normalized.includes("snapshot")) {
    return "Snapshotted";
  }

  if (normalized.includes("rollback")) {
    return "Rolled back";
  }

  if (
    normalized.includes("config") ||
    normalized.includes("set") ||
    normalized.includes("update")
  ) {
    return "Updated";
  }

  return `Ran ${taskType}`;
}

function deploymentActivityFromTask(task: ProxmoxTaskListEntryResponse): DeploymentActivity | null {
  const parsedUpid = typeof task.upid === "string"
    ? parseTaskUpidDetails(task.upid)
    : null;
  const taskType = (
    typeof task.type === "string" && task.type.trim()
      ? task.type
      : parsedUpid?.taskType
  )?.trim();

  if (!taskType) {
    return null;
  }

  if (IGNORED_DEPLOYMENT_TASK_TYPES.has(taskType.toLowerCase())) {
    return null;
  }

  return {
    label: formatDeploymentTaskLabel(taskType),
    occurredAt:
      toIsoFromUnixSeconds(task.endtime) ??
      toIsoFromUnixSeconds(task.starttime) ??
      toIsoFromUnixSeconds(parsedUpid?.startedAtSeconds),
  };
}

function extractProgressFromLogLine(line: string) {
  const matches = [...line.matchAll(/(\d{1,3})%/g)];

  if (matches.length === 0) {
    return null;
  }

  const value = Number.parseInt(matches.at(-1)?.[1] ?? "", 10);

  if (Number.isNaN(value)) {
    return null;
  }

  return Math.max(0, Math.min(value, 100));
}

function latestInterestingTaskLog(logs: ProxmoxTaskLogEntryResponse[]) {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const line = logs[index]?.t?.trim();

    if (!line || line === "TASK OK") {
      continue;
    }

    return line;
  }

  return logs.at(-1)?.t?.trim() || null;
}

function normalizeTaskState(
  status?: string,
  exitStatus?: string,
  logs: ProxmoxTaskLogEntryResponse[] = [],
): ProxmoxTaskSnapshot["status"] {
  if (status === "stopped") {
    if (exitStatus === "OK") {
      return hasTaskWarnings(logs) ? "warning" : "success";
    }

    if (
      typeof exitStatus === "string" &&
      exitStatus.trim().toUpperCase().startsWith("WARNINGS")
    ) {
      return "warning";
    }

    return "error";
  }

  return "running";
}

function extractTaskWarningBlocks(logs: ProxmoxTaskLogEntryResponse[]) {
  const warningBlocks: string[] = [];
  let currentBlock: string[] | null = null;

  for (const logEntry of logs) {
    const line = logEntry.t?.trim();

    if (!line) {
      continue;
    }

    if (line.startsWith("WARN:")) {
      if (currentBlock && currentBlock.length > 0) {
        warningBlocks.push(currentBlock.join("\n"));
      }

      currentBlock = [line.slice(5).trim() || line];
      continue;
    }

    if (line === "TASK OK" || line.startsWith("TASK WARNINGS")) {
      if (currentBlock && currentBlock.length > 0) {
        warningBlocks.push(currentBlock.join("\n"));
      }

      currentBlock = null;
      continue;
    }

    if (!currentBlock) {
      continue;
    }

    if (/^-{3,}$/.test(line)) {
      continue;
    }

    currentBlock.push(line);
  }

  if (currentBlock && currentBlock.length > 0) {
    warningBlocks.push(currentBlock.join("\n"));
  }

  return warningBlocks;
}

function hasTaskWarnings(logs: ProxmoxTaskLogEntryResponse[]) {
  return logs.some((logEntry) => {
    const line = logEntry.t?.trim();
    return Boolean(line?.startsWith("WARN:") || line?.startsWith("TASK WARNINGS"));
  });
}

function buildTaskWarningMessage(logs: ProxmoxTaskLogEntryResponse[]) {
  const warningBlocks = extractTaskWarningBlocks(logs);

  if (warningBlocks.length > 0) {
    return warningBlocks.join("\n\n");
  }

  const warningSummary = logs
    .map((logEntry) => logEntry.t?.trim())
    .find((line) => line?.startsWith("TASK WARNINGS"));

  return warningSummary ?? null;
}

function estimateTaskProgress(
  status: ProxmoxTaskSnapshot["status"],
  taskType: string,
  logs: ProxmoxTaskLogEntryResponse[],
) {
  if (status === "success" || status === "warning") {
    return 100;
  }

  const explicitProgress = logs.reduce<number | null>((current, logEntry) => {
    const line = logEntry.t?.trim();

    if (!line) {
      return current;
    }

    return extractProgressFromLogLine(line) ?? current;
  }, null);

  if (explicitProgress != null) {
    return status === "error" ? explicitProgress : Math.min(explicitProgress, 95);
  }

  const latestLog = logs.at(-1)?.t?.toLowerCase() ?? "";

  if (latestLog.includes("writing manifest")) {
    return 95;
  }

  if (status === "error") {
    return Math.max(15, Math.min(logs.length * 10, 95));
  }

  if (logs.length === 0) {
    return 8;
  }

  const expectedSteps = TASK_PROGRESS_HINTS[taskType] ?? Math.max(logs.length + 4, 8);

  return Math.max(8, Math.min(Math.round((logs.length / expectedSteps) * 100), 95));
}

function buildTaskMessage(
  taskStatus: ProxmoxTaskSnapshot["status"],
  exitStatus: string | null,
  logs: ProxmoxTaskLogEntryResponse[],
) {
  if (taskStatus === "success") {
    return latestInterestingTaskLog(logs) ?? "Task completed successfully.";
  }

  if (taskStatus === "warning") {
    return buildTaskWarningMessage(logs) ?? "Task completed with warnings.";
  }

  if (taskStatus === "error") {
    return exitStatus || latestInterestingTaskLog(logs) || "Task failed.";
  }

  return latestInterestingTaskLog(logs) ?? "Task is running in Proxmox.";
}

function templateIdParts(template: Pick<LiveTemplate, "node" | "storage" | "volid">) {
  return {
    node: template.node,
    storage: template.storage,
    volid: template.volid,
  };
}

export function encodeTemplateId(template: Pick<LiveTemplate, "node" | "storage" | "volid">, siteId?: string) {
  const payload: Record<string, unknown> = templateIdParts(template);
  if (siteId) payload.siteId = siteId;
  return Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
}

export function decodeTemplateId(id: string): { node: string; storage: string; volid: string; siteId: string | null } {
  try {
    const decoded = JSON.parse(Buffer.from(id, "base64url").toString("utf8")) as {
      node?: unknown; storage?: unknown; volid?: unknown; siteId?: unknown;
    };
    const node = String(decoded.node ?? "");
    const storage = String(decoded.storage ?? "");
    const volid = String(decoded.volid ?? "");
    const siteId = typeof decoded.siteId === "string" ? decoded.siteId : null;

    if (!node || !PROXMOX_NODE_NAME_REGEX.test(node)) {
      throw new Error("Invalid node in template ID.");
    }
    if (!storage || !/^[a-zA-Z0-9._-]+$/.test(storage)) {
      throw new Error("Invalid storage in template ID.");
    }
    if (!volid || !/^[a-zA-Z0-9][a-zA-Z0-9/:._-]*$/.test(volid) || /\.\./.test(volid)) {
      throw new Error("Invalid volid in template ID.");
    }

    return { node, storage, volid, siteId };
  } catch (error) {
    if (error instanceof Error && error.message.includes("template ID")) throw error;
    throw new Error("Invalid template ID format.");
  }
}

export function buildContainerNetworkConfig(input: {
  bridge: string;
  gateway: string;
  ipv4Cidr: string;
  mode: string;
}) {
  const parts = [`name=eth0`, `bridge=${input.bridge}`];
  if (input.mode === "static") {
    parts.push(`ip=${input.ipv4Cidr}`);
    if (input.gateway) {
      parts.push(`gw=${input.gateway}`);
    }
  } else {
    parts.push("ip=dhcp");
  }
  return parts.join(",");
}

export function encodeDeploymentId(node: string, vmid: number, type: "lxc" | "qemu" = "lxc", siteId?: string) {
  const payload: Record<string, unknown> = { node, vmid, type };
  const activeSiteId = getRequestConfigHolder().config?.siteId ?? siteConfigALS.getStore()?.siteId ?? null;
  const resolvedSiteId = siteId ?? (activeSiteId && activeSiteId !== "__env__" ? activeSiteId : null);

  if (resolvedSiteId) payload.siteId = resolvedSiteId;
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeDeploymentId(id: string): { node: string; vmid: number; type: "lxc" | "qemu"; siteId: string | null } {
  try {
    const decoded = JSON.parse(Buffer.from(id, "base64url").toString("utf8")) as {
      node?: unknown; type?: unknown; vmid?: unknown; siteId?: unknown;
    };
    const node = String(decoded.node ?? "");
    const vmid = Number(decoded.vmid);
    const type = decoded.type === "qemu" ? "qemu" as const : "lxc" as const;
    const siteId = typeof decoded.siteId === "string" ? decoded.siteId : null;

    if (!node || !PROXMOX_NODE_NAME_REGEX.test(node)) {
      throw new Error("Invalid node name in deployment ID.");
    }
    if (!Number.isInteger(vmid) || vmid <= 0) {
      throw new Error("Invalid VMID in deployment ID.");
    }

    return { node, vmid, type, siteId };
  } catch (error) {
    if (error instanceof Error && error.message.includes("deployment ID")) throw error;
    throw new Error("Invalid deployment ID format.");
  }
}

function formatStatusLabel(status?: string) {
  if (!status) {
    return "unknown";
  }

  return status.replace(/-/g, " ");
}

function parseTags(value?: string) {
  if (!value) {
    return [];
  }

  return value
    .split(/[;,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseIpFromNet(value?: string) {
  if (!value) {
    return "Unavailable";
  }

  const parts = value.split(",");
  const ipValue = parts.find((part) => part.startsWith("ip="));

  if (!ipValue) {
    return "Unavailable";
  }

  const parsed = ipValue.slice(3);

  if (parsed === "dhcp" || parsed === "manual") {
    return parsed.toUpperCase();
  }

  return parsed.split("/")[0]?.trim() || "Unavailable";
}

export type NetworkInfo = {
  dns: string;
  gateway: string;
  hwAddress: string;
  interfaceName: string;
  ipAddress: string;
  searchDomain: string;
  subnet: string;
};

async function getRuntimeNetworkInfo(
  node: string,
  vmid: number,
  config?: ProxmoxLxcConfigResponse | null,
): Promise<NetworkInfo | null> {
  const result = await safeRequest<ProxmoxLxcInterfaceResponse[]>(
    `/nodes/${node}/lxc/${vmid}/interfaces`,
  );

  if (!result.data) return null;

  for (const iface of result.data) {
    if (iface.name === "lo") continue;

    if (iface.inet) {
      const [ip, prefix] = iface.inet.split("/");
      const net0Parts = (config?.net0 ?? "").split(",");
      const gwPart = net0Parts.find((p) => p.startsWith("gw="));

      return {
        dns: config?.nameserver ?? "",
        gateway: gwPart?.slice(3) ?? "",
        hwAddress: iface.hwaddr ?? "",
        interfaceName: iface.name ?? "",
        ipAddress: ip,
        searchDomain: config?.searchdomain ?? "",
        subnet: prefix ? `/${prefix}` : "",
      };
    }
  }

  return null;
}

async function getRuntimeIp(node: string, vmid: number): Promise<string | null> {
  const info = await getRuntimeNetworkInfo(node, vmid);
  return info?.ipAddress ?? null;
}

async function getVmRuntimeIp(node: string, vmid: number): Promise<string | null> {
  const result = await safeRequest<ProxmoxQemuAgentNetworkResponse>(
    `/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`,
  );

  if (!result.data?.result) return null;

  for (const iface of result.data.result) {
    if (iface.name === "lo" || iface.name === "Loopback Pseudo-Interface 1") continue;

    for (const addr of iface["ip-addresses"] ?? []) {
      if (addr["ip-address-type"] === "ipv4" && addr["ip-address"]) {
        return addr["ip-address"];
      }
    }
  }

  return null;
}

export function parseEnvText(value?: string) {
  if (!value) {
    return [];
  }

  return value
    .split("\u0000")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf("=");

      if (separatorIndex < 0) {
        return {
          key: entry,
          value: "",
        };
      }

      return {
        key: entry.slice(0, separatorIndex),
        value: entry.slice(separatorIndex + 1),
      };
    });
}

export function envPairsToText(value?: string) {
  return parseEnvText(value)
    .map((entry) => `${entry.key}=${entry.value}`)
    .join("\n");
}

export function envTextToString(input: string) {
  const normalizedLines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const entries = normalizedLines.map((line) => {
    const separatorIndex = line.indexOf("=");

    if (separatorIndex < 1) {
      throw new Error(
        `Invalid env line "${line}". Use KEY=value format for every non-empty line.`,
      );
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(
        `Invalid env key "${key}". Keys must match [A-Za-z_][A-Za-z0-9_]*.`,
      );
    }

    return `${key}=${value}`;
  });

  return entries.join("\u0000");
}

async function listNodesInternal() {
  const result = await safeRequest<ProxmoxNodeResponse[]>("/nodes");

  if (result.data) {
    result.data.sort((a, b) => a.node.localeCompare(b.node));
  }

  return result;
}

function mapLiveNodes(nodes: ProxmoxNodeResponse[] | null | undefined): LiveNode[] {
  return (
    nodes?.map((node) => ({
      fingerprint: node.ssl_fingerprint ?? "Unavailable",
      name: node.node,
      status: node.status ?? "unknown",
    })) ?? []
  );
}

async function getLiveNodeIndex() {
  const issues: ProxmoxIssue[] = [];
  const nodesResult = await listNodesInternal();

  if (nodesResult.issue) {
    issues.push(nodesResult.issue);
  }

  return {
    issues,
    nodes: mapLiveNodes(nodesResult.data),
  };
}

async function getNextIdResult() {
  return safeRequest<string>("/cluster/nextid");
}

async function getTemplateContentIndex(node: string, storage: string) {
  const cacheKey = `${node}:${storage}`;
  const cached = templateContentIndexCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const inflight = templateContentIndexInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const requestPromise = safeRequest<ProxmoxStorageContentResponse[]>(
    `/nodes/${node}/storage/${storage}/content?content=vztmpl`,
  )
    .then((result) => {
      const index = new Map<string, { ctime: number; size: number }>();

      for (const entry of result.data ?? []) {
        index.set(entry.volid, {
          ctime: entry.ctime ?? 0,
          size: entry.size ?? 0,
        });
      }

      templateContentIndexCache.set(cacheKey, {
        expiresAt: Date.now() + TEMPLATE_CONTENT_INDEX_TTL_MS,
        value: index,
      });

      return index;
    })
    .finally(() => {
      templateContentIndexInflight.delete(cacheKey);
    });

  templateContentIndexInflight.set(cacheKey, requestPromise);

  return requestPromise;
}

function aggregateClusterResources(metrics: LiveNodeMetrics[]) {
  if (metrics.length === 0) {
    return null;
  }

  const cpuSamples = metrics
    .map((metric) => metric.cpuRatio)
    .filter((value): value is number => value != null);
  const loadEntries = [0, 1, 2].map((index) => {
    const samples = metrics
      .map((metric) => metric.loadAverage[index])
      .filter((value): value is number => value != null);

    if (samples.length === 0) {
      return 0;
    }

    return samples.reduce((sum, value) => sum + value, 0) / samples.length;
  });

  return {
    cpuRatio:
      cpuSamples.length > 0
        ? cpuSamples.reduce((sum, value) => sum + value, 0) / cpuSamples.length
        : null,
    loadAverage: loadEntries,
    memoryTotalBytes: metrics.reduce(
      (sum, metric) => sum + (metric.memoryTotalBytes ?? 0),
      0,
    ),
    memoryUsedBytes: metrics.reduce(
      (sum, metric) => sum + (metric.memoryUsedBytes ?? 0),
      0,
    ),
    rootfsTotalBytes: metrics.reduce(
      (sum, metric) => sum + (metric.rootfsTotalBytes ?? 0),
      0,
    ),
    rootfsUsedBytes: metrics.reduce(
      (sum, metric) => sum + (metric.rootfsUsedBytes ?? 0),
      0,
    ),
    swapTotalBytes: metrics.reduce(
      (sum, metric) => sum + (metric.swapTotalBytes ?? 0),
      0,
    ),
    swapUsedBytes: metrics.reduce(
      (sum, metric) => sum + (metric.swapUsedBytes ?? 0),
      0,
    ),
  };
}

async function listNodeMetricsInternal(nodes: LiveNode[]) {
  const issues: ProxmoxIssue[] = [];
  const metrics: LiveNodeMetrics[] = [];

  const results = await Promise.all(
    nodes.map(async (node) => {
      const result = await safeRequest<ProxmoxNodeStatusResponse>(
        `/nodes/${node.name}/status`,
      );
      return { node, result };
    }),
  );

  for (const { node, result } of results) {
    if (result.issue) {
      issues.push(result.issue);
      continue;
    }

    const status = result.data ?? {};

    metrics.push({
      cpuRatio: normalizeMaybeNumber(status.cpu),
      loadAverage: parseLoadAverage(status.loadavg),
      memoryTotalBytes: normalizeMaybeNumber(status.memory?.total),
      memoryUsedBytes: normalizeMaybeNumber(status.memory?.used),
      node: node.name,
      rootfsTotalBytes: normalizeMaybeNumber(status.rootfs?.total),
      rootfsUsedBytes: normalizeMaybeNumber(status.rootfs?.used),
      swapTotalBytes: normalizeMaybeNumber(status.swap?.total),
      swapUsedBytes: normalizeMaybeNumber(status.swap?.used),
      uptimeSeconds: normalizeMaybeNumber(status.uptime),
    });
  }

  return {
    issues,
    metrics,
  };
}

type ProxmoxRRDDataPoint = {
  cpu?: number;
  memtotal?: number;
  memused?: number;
  netin?: number;
  netout?: number;
  roottotal?: number;
  rootused?: number;
  swaptotal?: number;
  swapused?: number;
  time?: number;
};

export type RRDChartData = {
  /** Unix milliseconds, aligned 1:1 with the metric arrays. */
  categories: number[];
  cpu: number[];
  memoryPercent: number[];
  netIn: number[];
  netOut: number[];
  storagePercent: number[];
};

async function fetchNodeRRDData(
  nodeName: string,
  timeframe: "hour" | "day" | "week" | "month" | "year" = "day",
) {
  return safeRequest<ProxmoxRRDDataPoint[]>(
    `/nodes/${nodeName}/rrddata?timeframe=${timeframe}&cf=AVERAGE`,
  );
}

type ProxmoxGuestRrdPoint = {
  time?: number;
  cpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  netin?: number;
  netout?: number;
  diskread?: number;
  diskwrite?: number;
};

export type GuestMetricSeries = {
  timeframe: string;
  points: number;
  /** Unix milliseconds, aligned with the percent series. */
  categories: number[];
  cpuPercent: { avg: number; peak: number; series: number[] };
  memPercent: { avg: number; peak: number; series: number[] };
  netInKBps: { avg: number; peak: number };
  netOutKBps: { avg: number; peak: number };
  issue: string | null;
};

export async function getGuestRrdData(
  node: string,
  vmid: number,
  type: "lxc" | "qemu",
  timeframe: "hour" | "day" | "week" | "month" | "year" = "day",
): Promise<GuestMetricSeries> {
  const safeNode = validateNodeName(node);
  const safeVmid = validatePositiveInteger(vmid, "VMID");
  const kind = type === "qemu" ? "qemu" : "lxc";
  const result = await safeRequest<ProxmoxGuestRrdPoint[]>(
    `/nodes/${safeNode}/${kind}/${safeVmid}/rrddata?timeframe=${timeframe}&cf=AVERAGE`,
  );

  const empty: GuestMetricSeries = {
    timeframe,
    points: 0,
    categories: [],
    cpuPercent: { avg: 0, peak: 0, series: [] },
    memPercent: { avg: 0, peak: 0, series: [] },
    netInKBps: { avg: 0, peak: 0 },
    netOutKBps: { avg: 0, peak: 0 },
    issue: result.issue?.message ?? null,
  };
  const data = result.data ?? [];
  if (data.length === 0) return empty;

  const round = (n: number, d = 1) => {
    const f = 10 ** d;
    return Math.round(n * f) / f;
  };
  const summarise = (values: number[]) => {
    const valid = values.filter((v) => Number.isFinite(v));
    if (valid.length === 0) return { avg: 0, peak: 0 };
    return {
      avg: round(valid.reduce((a, b) => a + b, 0) / valid.length),
      peak: round(Math.max(...valid)),
    };
  };

  const categories: number[] = [];
  const cpuSeries: number[] = [];
  const memSeries: number[] = [];
  const netIn: number[] = [];
  const netOut: number[] = [];

  for (const p of data) {
    if (!p.time) continue;
    categories.push(p.time * 1000);
    cpuSeries.push(round((p.cpu ?? 0) * 100));
    memSeries.push(
      p.maxmem && p.maxmem > 0 && p.mem != null ? round((p.mem / p.maxmem) * 100) : 0,
    );
    netIn.push((p.netin ?? 0) / 1024);
    netOut.push((p.netout ?? 0) / 1024);
  }

  return {
    timeframe,
    points: categories.length,
    categories,
    cpuPercent: { ...summarise(cpuSeries), series: cpuSeries },
    memPercent: { ...summarise(memSeries), series: memSeries },
    netInKBps: summarise(netIn),
    netOutKBps: summarise(netOut),
    issue: result.issue?.message ?? null,
  };
}

export async function getClusterRRDData(
  timeframe: "hour" | "day" | "week" | "month" | "year" = "day",
): Promise<RRDChartData> {
  const empty: RRDChartData = { categories: [], cpu: [], memoryPercent: [], netIn: [], netOut: [], storagePercent: [] };

  const config = getActiveSiteConfig();
  let defaultNode = config.defaultNode;

  if (!defaultNode) {
    const nodesResult = await safeRequest<{ node: string; status: string }[]>("/nodes");
    const onlineNode = nodesResult.data?.find((n) => n.status === "online");
    if (!onlineNode) {
      console.error("[rrd] No defaultNode configured and no online nodes found");
      return empty;
    }
    defaultNode = onlineNode.node;
    console.log(`[rrd] No defaultNode configured, auto-discovered: ${defaultNode}`);
  }

  const results = [
    await Promise.race([
      fetchNodeRRDData(defaultNode, timeframe),
      new Promise<{ data: null; issue: ProxmoxIssue }>((resolve) =>
        setTimeout(() => resolve({ data: null, issue: { endpoint: `/nodes/${defaultNode}/rrddata`, message: "RRD fetch timed out", requiredPrivileges: [] } }), 5000),
      ),
    ]),
  ];

  const validResults = results.filter((r) => r.data && r.data.length > 0);
  if (validResults.length === 0) {
    console.error(`[rrd] No valid RRD results for node="${defaultNode}" tf="${timeframe}"`, results.map(r => ({ hasData: !!r.data, dataLen: r.data?.length, issue: r.issue?.message })));
    return empty;
  }

  const lengths = validResults.map((r) => r.data!.length);
  const minLength = Math.min(...lengths);

  const categories: number[] = [];
  const cpu: number[] = [];
  const memoryPercent: number[] = [];
  const storagePercent: number[] = [];
  const netIn: number[] = [];
  const netOut: number[] = [];

  for (let i = 0; i < minLength; i++) {
    const points = validResults.map((r) => r.data![i]);

    const time = points[0]?.time;
    if (!time) continue;

    categories.push(time * 1000);

    const cpuValues = points.map((p) => p.cpu).filter((v): v is number => v != null && !isNaN(v));
    cpu.push(cpuValues.length > 0 ? +(((cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length) * 100).toFixed(1)) : 0);

    const memPercents = points.map((p) => {
      if (p.memtotal && p.memtotal > 0 && p.memused != null) {
        return (p.memused / p.memtotal) * 100;
      }
      return null;
    }).filter((v): v is number => v != null);
    memoryPercent.push(memPercents.length > 0 ? +((memPercents.reduce((a, b) => a + b, 0) / memPercents.length).toFixed(1)) : 0);

    const storagePercents = points.map((p) => {
      if (p.roottotal && p.roottotal > 0 && p.rootused != null) {
        return (p.rootused / p.roottotal) * 100;
      }
      return null;
    }).filter((v): v is number => v != null);
    storagePercent.push(storagePercents.length > 0 ? +((storagePercents.reduce((a, b) => a + b, 0) / storagePercents.length).toFixed(1)) : 0);

    const netInSum = points.reduce((sum, p) => sum + (p.netin ?? 0), 0);
    const netOutSum = points.reduce((sum, p) => sum + (p.netout ?? 0), 0);
    netIn.push(Math.round(netInSum / 1024 / 1024));
    netOut.push(Math.round(netOutSum / 1024 / 1024));
  }

  return { categories, cpu, memoryPercent, netIn, netOut, storagePercent };
}

function sortStoragePools(left: LiveStoragePool, right: LiveStoragePool) {
  if (left.shared !== right.shared) {
    return left.shared ? -1 : 1;
  }

  const leftUsage = left.usageRatio ?? -1;
  const rightUsage = right.usageRatio ?? -1;

  if (leftUsage !== rightUsage) {
    return rightUsage - leftUsage;
  }

  if (left.node !== right.node) {
    return left.node.localeCompare(right.node);
  }

  return left.storage.localeCompare(right.storage);
}

async function listStoragePoolsInternal(nodes: LiveNode[]) {
  const issues: ProxmoxIssue[] = [];
  const seen = new Set<string>();
  const pools: LiveStoragePool[] = [];

  const results = await Promise.all(
    nodes.map(async (node) => {
      const storageResult = await safeRequest<ProxmoxStorageResponse[]>(
        `/nodes/${node.name}/storage`,
      );
      return { node, storageResult };
    }),
  );

  for (const { node, storageResult } of results) {
    if (storageResult.issue) {
      issues.push(storageResult.issue);
      continue;
    }

    for (const storage of storageResult.data ?? []) {
      if (storage.enabled === 0 || storage.active === 0) {
        continue;
      }

      const key = getStorageScopeKey(node.name, storage);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      pools.push(mapStoragePool(node.name, storage));
    }
  }

  pools.sort(sortStoragePools);

  return {
    issues,
    pools,
  };
}

async function listDeploymentsInternal(nodes: LiveNode[]) {
  const issues: ProxmoxIssue[] = [];

  const listResults = await Promise.all(
    nodes.map(async (node) => {
      const result = await safeRequest<ProxmoxLxcListResponse[]>(
        `/nodes/${node.name}/lxc`,
      );
      return { node, result };
    }),
  );

  const containers: { node: LiveNode; container: ProxmoxLxcListResponse }[] = [];
  for (const { node, result } of listResults) {
    if (result.issue) {
      issues.push(result.issue);
      continue;
    }
    for (const container of result.data ?? []) {
      containers.push({ node, container });
    }
  }

  // The /interfaces endpoint is slow, so only containers without a static IP use it.
  const configResults = await Promise.all(
    containers.map(async ({ node, container }) => {
      const config = await safeRequest<ProxmoxLxcConfigResponse>(
        `/nodes/${node.name}/lxc/${container.vmid}/config`,
      );

      const isRunning = container.status === "running";
      const staticIp = config.data ? parseIpFromNet(config.data.net0) : "Unavailable";
      const isDynamic =
        staticIp === "Unavailable" || staticIp === "DHCP" || staticIp === "MANUAL";

      const runtimeIp = isRunning && isDynamic
        ? await getRuntimeIp(node.name, container.vmid)
        : null;

      return { node, container, config, runtimeIp };
    }),
  );

  const deployments: LiveDeployment[] = configResults.map(
    ({ node, container, config, runtimeIp }) => ({
      cpu:
        container.cpus && container.cpus > 0
          ? `${container.cpus} vCPU`
          : "Unavailable",
      cpuUsage: typeof container.cpu === "number" ? container.cpu : null,
      disk: formatBytes(container.maxdisk ?? 0),
      diskTotalBytes: container.maxdisk ?? null,
      diskUsedBytes: typeof container.disk === "number" ? container.disk : null,
      environmentMode: "Runtime env",
      id: encodeDeploymentId(node.name, container.vmid),
      ipAddress: runtimeIp || (config.data ? parseIpFromNet(config.data.net0) : "Unavailable"),
      memTotalBytes: container.maxmem ?? null,
      memUsedBytes: typeof container.mem === "number" ? container.mem : null,
      memory: formatBytes(container.maxmem ?? 0),
      name: container.name ?? `CT ${container.vmid}`,
      node: node.name,
      rawStatus: container.status ?? "unknown",
      statusLabel: formatStatusLabel(container.status),
      tagList: parseTags(container.tags),
      tainerMeta: parseTainerMeta(config.data?.description ?? ""),
      templateName: config.data?.ostemplate
        ? titleFromTemplateFile(
            config.data.ostemplate.split("/").at(-1) ?? config.data.ostemplate,
          )
        : "Proxmox LXC",
      type: "lxc" as const,
      uptime: formatUptime(container.uptime),
      vmid: container.vmid,
    }),
  );

  deployments.sort((left, right) => left.vmid - right.vmid);

  return {
    deployments,
    issues,
  };
}

async function listVmsInternal(nodes: LiveNode[]) {
  const issues: ProxmoxIssue[] = [];

  const listResults = await Promise.all(
    nodes.map(async (node) => {
      const result = await safeRequest<ProxmoxQemuListResponse[]>(
        `/nodes/${node.name}/qemu`,
      );
      return { node, result };
    }),
  );

  const vms: { node: LiveNode; vm: ProxmoxQemuListResponse }[] = [];
  for (const { node, result } of listResults) {
    if (result.issue) {
      issues.push(result.issue);
      continue;
    }
    for (const vm of result.data ?? []) {
      if (vm.template) continue;
      vms.push({ node, vm });
    }
  }

  const configResults = await Promise.all(
    vms.map(async ({ node, vm }) => {
      const isRunning = vm.status === "running";
      const [config, runtimeIp] = await Promise.all([
        safeRequest<ProxmoxQemuConfigResponse>(
          `/nodes/${node.name}/qemu/${vm.vmid}/config`,
        ),
        isRunning ? getVmRuntimeIp(node.name, vm.vmid) : null,
      ]);
      return { node, vm, config, runtimeIp };
    }),
  );

  const deployments: LiveDeployment[] = configResults.map(
    ({ node, vm, config, runtimeIp }) => ({
      cpu:
        vm.cpus && vm.cpus > 0
          ? `${vm.cpus} vCPU`
          : "Unavailable",
      cpuUsage: typeof vm.cpu === "number" ? vm.cpu : null,
      disk: formatBytes(vm.maxdisk ?? 0),
      diskTotalBytes: vm.maxdisk ?? null,
      diskUsedBytes: typeof vm.disk === "number" ? vm.disk : null,
      environmentMode: "QEMU VM",
      id: encodeDeploymentId(node.name, vm.vmid, "qemu"),
      ipAddress: runtimeIp || "Unavailable",
      memTotalBytes: vm.maxmem ?? null,
      memUsedBytes: typeof vm.mem === "number" ? vm.mem : null,
      memory: formatBytes(vm.maxmem ?? 0),
      name: vm.name ?? `VM ${vm.vmid}`,
      node: node.name,
      rawStatus: vm.status ?? "unknown",
      statusLabel: formatStatusLabel(vm.status),
      tagList: parseTags(vm.tags),
      tainerMeta: parseTainerMeta(config.data?.description ?? ""),
      templateName: extractVmIsoVolid(config.data ?? {})
        ? titleFromTemplateFile(extractVmIsoVolid(config.data ?? {}).split("/").at(-1) ?? "QEMU VM")
        : "QEMU VM",
      type: "qemu" as const,
      uptime: formatUptime(vm.uptime),
      vmid: vm.vmid,
    }),
  );

  deployments.sort((left, right) => left.vmid - right.vmid);

  return {
    deployments,
    issues,
  };
}

async function listDashboardDeploymentsInternal(nodes: LiveNode[]) {
  const issues: ProxmoxIssue[] = [];
  const deployments: LiveDeployment[] = [];

  const results = await Promise.all(
    nodes.map(async (node) => {
      const [containersResult, vmsResult] = await Promise.all([
        safeRequest<ProxmoxLxcListResponse[]>(`/nodes/${node.name}/lxc`),
        safeRequest<ProxmoxQemuListResponse[]>(`/nodes/${node.name}/qemu`),
      ]);

      return { containersResult, node, vmsResult };
    }),
  );

  for (const { containersResult, node, vmsResult } of results) {
    if (containersResult.issue) {
      issues.push(containersResult.issue);
    }

    for (const container of containersResult.data ?? []) {
      deployments.push({
        cpu: "Unavailable",
        cpuUsage: typeof container.cpu === "number" ? container.cpu : null,
        disk: formatBytes(container.maxdisk ?? 0),
        diskTotalBytes: container.maxdisk ?? null,
        diskUsedBytes: typeof container.disk === "number" ? container.disk : null,
        environmentMode: "Runtime env",
        id: encodeDeploymentId(node.name, container.vmid),
        ipAddress: "Unavailable",
        memTotalBytes: container.maxmem ?? null,
        memUsedBytes: typeof container.mem === "number" ? container.mem : null,
        memory: formatBytes(container.maxmem ?? 0),
        name: container.name ?? `CT ${container.vmid}`,
        node: node.name,
        rawStatus: container.status ?? "unknown",
        statusLabel: formatStatusLabel(container.status),
        tagList: parseTags(container.tags),
        tainerMeta: null,
        templateName: "Proxmox LXC",
        type: "lxc",
        uptime: formatUptime(container.uptime),
        vmid: container.vmid,
      });
    }

    if (vmsResult.issue) {
      issues.push(vmsResult.issue);
    }

    for (const vm of vmsResult.data ?? []) {
      if (vm.template) {
        continue;
      }

      deployments.push({
        cpu: "Unavailable",
        cpuUsage: typeof vm.cpu === "number" ? vm.cpu : null,
        disk: formatBytes(vm.maxdisk ?? 0),
        diskTotalBytes: vm.maxdisk ?? null,
        diskUsedBytes: typeof vm.disk === "number" ? vm.disk : null,
        environmentMode: "QEMU VM",
        id: encodeDeploymentId(node.name, vm.vmid, "qemu"),
        ipAddress: "Unavailable",
        memTotalBytes: vm.maxmem ?? null,
        memUsedBytes: typeof vm.mem === "number" ? vm.mem : null,
        memory: formatBytes(vm.maxmem ?? 0),
        name: vm.name ?? `VM ${vm.vmid}`,
        node: node.name,
        rawStatus: vm.status ?? "unknown",
        statusLabel: formatStatusLabel(vm.status),
        tagList: parseTags(vm.tags),
        tainerMeta: null,
        templateName: "QEMU VM",
        type: "qemu",
        uptime: formatUptime(vm.uptime),
        vmid: vm.vmid,
      });
    }
  }

  deployments.sort((left, right) => left.vmid - right.vmid);

  return {
    deployments,
    issues,
  };
}

async function listTemplatesInternal(nodes: LiveNode[]) {
  const issues: ProxmoxIssue[] = [];
  const templates: LiveTemplate[] = [];

  const storageResults = await Promise.all(
    nodes.map(async (node) => {
      const storageResult = await safeRequest<ProxmoxStorageResponse[]>(
        `/nodes/${node.name}/storage`,
      );
      return { node, storageResult };
    }),
  );

  // Shared pools can be queried once; node-local pools with the same name must remain distinct.
  const seenStorage = new Set<string>();
  const storageToQuery: { node: LiveNode; storage: ProxmoxStorageResponse }[] = [];

  for (const { node, storageResult } of storageResults) {
    if (storageResult.issue) {
      issues.push(storageResult.issue);
      continue;
    }

    for (const storage of storageResult.data ?? []) {
      if (!parseStorageContentTypes(storage.content).includes("vztmpl")) {
        continue;
      }

      const key = getStorageScopeKey(node.name, storage);
      if (seenStorage.has(key)) {
        continue;
      }
      seenStorage.add(key);
      storageToQuery.push({ node, storage });
    }
  }

  const contentResults = await Promise.all(
    storageToQuery.map(async ({ node, storage }) => {
      const contentResult = await safeRequest<ProxmoxStorageContentResponse[]>(
        `/nodes/${node.name}/storage/${storage.storage}/content?content=vztmpl`,
      );
      return { node, storage, contentResult };
    }),
  );

  for (const { node, storage, contentResult } of contentResults) {
    if (contentResult.issue) {
      issues.push(contentResult.issue);
      continue;
    }

    for (const entry of contentResult.data ?? []) {
      const fileName = entry.volid.split("/").at(-1) ?? entry.volid;

      templates.push({
        createdAt: entry.ctime
          ? new Date(entry.ctime * 1000).toISOString()
          : null,
        fileName,
        id: encodeTemplateId({
          node: node.name,
          storage: storage.storage,
          volid: entry.volid,
        }),
        name: titleFromTemplateFile(fileName),
        node: node.name,
        sizeLabel: formatBytes(entry.size ?? 0),
        storage: storage.storage,
        volid: entry.volid,
      });
    }
  }

  templates.sort((left, right) => left.fileName.localeCompare(right.fileName));

  return {
    issues,
    templates,
  };
}

function sortTemplateTargets(left: TemplateTarget, right: TemplateTarget) {
  if (left.shared !== right.shared) {
    return left.shared ? -1 : 1;
  }

  if (left.node !== right.node) {
    return left.node.localeCompare(right.node);
  }

  return left.storage.localeCompare(right.storage);
}

async function listTemplateTargetsInternal(nodes: LiveNode[]) {
  const issues: ProxmoxIssue[] = [];
  const seen = new Set<string>();
  const targets: TemplateTarget[] = [];

  const results = await Promise.all(
    nodes.map(async (node) => {
      const storageResult = await safeRequest<ProxmoxStorageResponse[]>(
        `/nodes/${node.name}/storage`,
      );

      return { node, storageResult };
    }),
  );

  for (const { node, storageResult } of results) {
    if (storageResult.issue) {
      issues.push(storageResult.issue);
      continue;
    }

    for (const storage of storageResult.data ?? []) {
      if (
        storage.enabled === 0 ||
        storage.active === 0 ||
        !parseStorageContentTypes(storage.content).includes("vztmpl")
      ) {
        continue;
      }

      const key = getStorageScopeKey(node.name, storage);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      targets.push({
        node: node.name,
        shared: Boolean(storage.shared),
        storage: storage.storage,
      });
    }
  }

  targets.sort(sortTemplateTargets);

  return {
    issues,
    targets,
  };
}

async function listRootfsTargetsInternal(nodes: LiveNode[]) {
  const storageResult = await listStoragePoolsInternal(nodes);

  return {
    issues: storageResult.issues,
    targets: storageResult.pools
      .filter((pool) => pool.isRootfsCapable)
      .map((pool) => ({
        availableBytes: pool.availableBytes,
        node: pool.node,
        shared: pool.shared,
        storage: pool.storage,
        totalBytes: pool.totalBytes,
        type: pool.type,
        usageRatio: pool.usageRatio,
        usedBytes: pool.usedBytes,
      })),
  };
}

function mapAvailableTemplate(
  template: ProxmoxAplInfoResponse,
  target: TemplateTarget,
): AvailableTemplate | null {
  if (
    template.type !== "lxc" ||
    template.section !== "system" ||
    !template.template ||
    !template.location
  ) {
    return null;
  }

  return {
    architecture: template.architecture ?? "unknown",
    description: template.description?.trim() || "No description provided.",
    fileName: template.template,
    headline: template.headline?.trim() || titleFromTemplateFile(template.template),
    location: template.location,
    node: target.node,
    os: template.os ?? "unknown",
    section: template.section,
    source: template.source ?? "unknown",
    storage: target.storage,
    version: template.version ?? "unknown",
  };
}

async function listAvailableTemplatesInternal(target: TemplateTarget | null) {
  if (!target) {
    return {
      issues: [] as ProxmoxIssue[],
      templates: [] as AvailableTemplate[],
    };
  }

  const result = await safeRequest<ProxmoxAplInfoResponse[]>(
    `/nodes/${target.node}/aplinfo`,
  );

  if (result.issue) {
    return {
      issues: [result.issue],
      templates: [],
    };
  }

  const templates = (result.data ?? [])
    .map((template) => mapAvailableTemplate(template, target))
    .filter((template): template is AvailableTemplate => Boolean(template))
    .sort((left, right) => left.headline.localeCompare(right.headline));

  return {
    issues: [] as ProxmoxIssue[],
    templates,
  };
}

export async function getOverviewData(): Promise<OverviewData> {
  const issues: ProxmoxIssue[] = [];
  const [versionResult, nextIdResult, nodesResult] = await Promise.all([
    safeRequest<{ release?: string; version?: string }>("/version"),
    getNextIdResult(),
    listNodesInternal(),
  ]);

  if (versionResult.issue) issues.push(versionResult.issue);
  if (nextIdResult.issue) issues.push(nextIdResult.issue);
  if (nodesResult.issue) issues.push(nodesResult.issue);

  const nodes = mapLiveNodes(nodesResult.data);

  const [deploymentResult, vmResult, templateResult, templateTargetResult, nodeMetricsResult, storagePoolResult] = await Promise.all([
    listDeploymentsInternal(nodes),
    listVmsInternal(nodes),
    listTemplatesInternal(nodes),
    listTemplateTargetsInternal(nodes),
    listNodeMetricsInternal(nodes),
    listStoragePoolsInternal(nodes),
  ]);
  const availableTemplateResult = await listAvailableTemplatesInternal(
    templateTargetResult.targets[0] ?? null,
  );

  issues.push(
    ...deploymentResult.issues,
    ...vmResult.issues,
    ...templateResult.issues,
    ...templateTargetResult.issues,
    ...availableTemplateResult.issues,
    ...nodeMetricsResult.issues,
    ...storagePoolResult.issues,
  );

  return {
    availableTemplates: availableTemplateResult.templates,
    clusterResources: aggregateClusterResources(nodeMetricsResult.metrics),
    connected: hasSiteConfig(),
    deployments: [...deploymentResult.deployments, ...vmResult.deployments].sort((a, b) => a.vmid - b.vmid),
    issues: dedupeIssues(issues),
    nextId: nextIdResult.data,
    nodeMetrics: nodeMetricsResult.metrics,
    nodes,
    storagePools: storagePoolResult.pools,
    templates: templateResult.templates,
    version: versionResult.data?.version ?? null,
  };
}

export async function getDashboardOverviewData(): Promise<DashboardOverviewData> {
  const { issues, nodes } = await getLiveNodeIndex();
  const [deploymentResult, nodeMetricsResult] = await Promise.all([
    listDashboardDeploymentsInternal(nodes),
    listNodeMetricsInternal(nodes),
  ]);

  issues.push(
    ...deploymentResult.issues,
    ...nodeMetricsResult.issues,
  );

  return {
    clusterResources: aggregateClusterResources(nodeMetricsResult.metrics),
    deployments: deploymentResult.deployments,
    issues: dedupeIssues(issues),
    nodeMetrics: nodeMetricsResult.metrics,
    nodes,
  };
}

export async function getNextId() {
  const result = await getNextIdResult();
  return result.data;
}

export async function getTemplateInventory() {
  const { issues, nodes } = await getLiveNodeIndex();
  const templateResult = await listTemplatesInternal(nodes);

  issues.push(...templateResult.issues);

  return {
    issues: dedupeIssues(issues),
    templates: templateResult.templates,
  };
}

export async function getTemplateLibraryIndex() {
  const { issues, nodes } = await getLiveNodeIndex();
  const [templateResult, targetResult] = await Promise.all([
    listTemplatesInternal(nodes),
    listTemplateTargetsInternal(nodes),
  ]);

  issues.push(...templateResult.issues, ...targetResult.issues);

  return {
    issues: dedupeIssues(issues),
    targets: targetResult.targets,
    templates: templateResult.templates,
  };
}

export async function getTemplateAuthoringIndex() {
  const { issues, nodes } = await getLiveNodeIndex();
  const [templateResult, rootfsResult] = await Promise.all([
    listTemplatesInternal(nodes),
    listRootfsTargetsInternal(nodes),
  ]);

  issues.push(...templateResult.issues, ...rootfsResult.issues);

  return {
    issues: dedupeIssues(issues),
    rootfsTargets: rootfsResult.targets,
    templates: templateResult.templates,
  };
}

export async function getTemplateIndex() {
  const issues: ProxmoxIssue[] = [];
  const [{ issues: nodeIssues, nodes }, nextIdResult] = await Promise.all([
    getLiveNodeIndex(),
    getNextIdResult(),
  ]);

  issues.push(...nodeIssues);
  if (nextIdResult.issue) issues.push(nextIdResult.issue);

  const targetsPromise = listTemplateTargetsInternal(nodes);
  const availablePromise = targetsPromise.then((tr) =>
    listAvailableTemplatesInternal(tr.targets[0] ?? null),
  );

  const [templateResult, targetResult, rootfsResult, availableTemplateResult] =
    await Promise.all([
      listTemplatesInternal(nodes),
      targetsPromise,
      listRootfsTargetsInternal(nodes),
      availablePromise,
    ]);

  issues.push(
    ...templateResult.issues,
    ...targetResult.issues,
    ...rootfsResult.issues,
    ...availableTemplateResult.issues,
  );

  return {
    availableTemplates: availableTemplateResult.templates,
    defaultNode: hasSiteConfig() ? getActiveSiteConfig().defaultNode : null,
    defaultRootfsStorage: hasSiteConfig() ? getActiveSiteConfig().defaultRootfsStorage : "",
    issues: dedupeIssues(issues),
    nextId: nextIdResult.data,
    rootfsTargets: rootfsResult.targets,
    targets: targetResult.targets,
    templates: templateResult.templates,
  };
}

export async function getTemplateDetail(id: string) {
  const [templateInventory, nextIdResult] = await Promise.all([
    getTemplateInventory(),
    getNextIdResult(),
  ]);
  const issues = [...templateInventory.issues];

  if (nextIdResult.issue) {
    issues.push(nextIdResult.issue);
  }

  return {
    issues: dedupeIssues(issues),
    nextId: nextIdResult.data,
    template: templateInventory.templates.find((entry) => entry.id === id) ?? null,
  };
}

export async function getRootfsTargets() {
  const { issues, nodes } = await getLiveNodeIndex();
  const rootfsResult = await listRootfsTargetsInternal(nodes);

  issues.push(...rootfsResult.issues);

  return {
    issues: dedupeIssues(issues),
    targets: rootfsResult.targets,
  };
}

export async function getDeploymentIndex() {
  const { issues, nodes } = await getLiveNodeIndex();
  const [deploymentResult, vmResult] = await Promise.all([
    listDeploymentsInternal(nodes),
    listVmsInternal(nodes),
  ]);

  issues.push(...deploymentResult.issues, ...vmResult.issues);

  return {
    deployments: [...deploymentResult.deployments, ...vmResult.deployments].sort(
      (left, right) => left.vmid - right.vmid,
    ),
    issues: dedupeIssues(issues),
  };
}

export async function getContainerEnvText(node: string, vmid: number): Promise<string> {
  const safeNode = validateNodeName(node);
  const safeVmid = validatePositiveInteger(vmid, "VMID");
  const result = await safeRequest<ProxmoxLxcConfigResponse>(
    `/nodes/${safeNode}/lxc/${safeVmid}/config`,
  );
  if (!result.data?.env) return "";
  return envPairsToText(result.data.env);
}

export async function getDeploymentDetail(id: string): Promise<LiveDeploymentDetail | null> {
  const { node, vmid, type } = decodeDeploymentId(id);

  if (type === "qemu") {
    return getVmDetail(id);
  }

  const issues: ProxmoxIssue[] = [];
  const [configResult, statusResult] = await Promise.all([
    safeRequest<ProxmoxLxcConfigResponse>(`/nodes/${node}/lxc/${vmid}/config`),
    safeRequest<ProxmoxLxcStatusResponse>(
      `/nodes/${node}/lxc/${vmid}/status/current`,
    ),
  ]);

  const networkInfo = await getRuntimeNetworkInfo(node, vmid, configResult.data);

  if (configResult.issue) issues.push(configResult.issue);
  if (statusResult.issue) issues.push(statusResult.issue);

  if (!configResult.data && !statusResult.data) {
    return null;
  }

  const config = configResult.data ?? {};
  const status = statusResult.data ?? {};

  const lxcCoresConfigured = toOptionalNumber(config.cores);
  const lxcMemoryConfiguredMb = toOptionalNumber(config.memory);
  const lxcSwapConfiguredMb = toOptionalNumber(config.swap);

  return {
    configAccessible: Boolean(configResult.data),
    coresConfigured: lxcCoresConfigured,
    cpu:
      status.cpus && status.cpus > 0
        ? `${status.cpus} vCPU`
        : typeof config.cores === "number" || typeof config.cores === "string"
          ? `${config.cores} vCPU`
          : "Unavailable",
    cpuUsage: typeof status.cpu === "number" ? status.cpu : null,
    description: config.description ?? "",
    digest: config.digest ?? "",
    disk: formatBytes(status.maxdisk ?? 0),
    diskTotalBytes: status.maxdisk ?? null,
    diskUsedBytes: typeof status.disk === "number" ? status.disk : null,
    environmentMode: config.env ? "Runtime env" : "No env configured",
    envCount: parseEnvText(config.env).length,
    envText: envPairsToText(config.env),
    guestOsType: "linux",
    id,
    ipAddress: networkInfo?.ipAddress || parseIpFromNet(config.net0),
    issues: dedupeIssues(issues),
    memTotalBytes: status.maxmem ?? null,
    memUsedBytes: typeof status.mem === "number" ? status.mem : null,
    memory: formatBytes(
      status.maxmem ??
        (typeof config.memory === "number" ? config.memory * 1024 * 1024 : 0),
    ),
    memoryConfiguredMb: lxcMemoryConfiguredMb,
    swapConfiguredMb: lxcSwapConfiguredMb,
    name: status.name ?? config.hostname ?? `CT ${vmid}`,
    networkInfo,
    node,
    ostemplate: config.ostemplate ?? "Unavailable",
    rawStatus: status.status ?? "unknown",
    resourceUsage: status.status === "running"
      ? {
          cpuRatio: status.cpu ?? 0,
          diskReadBytes: status.diskread ?? 0,
          diskTotalBytes: status.maxdisk ?? 0,
          diskUsedBytes: status.disk ?? 0,
          diskWriteBytes: status.diskwrite ?? 0,
          memTotalBytes: status.maxmem ?? 0,
          memUsedBytes: status.mem ?? 0,
          netInBytes: status.netin ?? 0,
          netOutBytes: status.netout ?? 0,
        }
      : null,
    rootfs: config.rootfs ?? "Unavailable",
    statusLabel: formatStatusLabel(status.status),
    tagList: parseTags(config.tags),
    tainerMeta: parseTainerMeta(config.description ?? ""),
    templateName: config.ostemplate
      ? titleFromTemplateFile(config.ostemplate.split("/").at(-1) ?? config.ostemplate)
      : "Proxmox LXC",
    type: "lxc" as const,
    uptime: formatUptime(status.uptime),
    vmid,
  };
}

async function getVmDetail(id: string): Promise<LiveDeploymentDetail | null> {
  const { node, vmid } = decodeDeploymentId(id);
  const issues: ProxmoxIssue[] = [];
  const [configResult, statusResult] = await Promise.all([
    safeRequest<ProxmoxQemuConfigResponse>(`/nodes/${node}/qemu/${vmid}/config`),
    safeRequest<ProxmoxQemuStatusResponse>(
      `/nodes/${node}/qemu/${vmid}/status/current`,
    ),
  ]);

  if (configResult.issue) issues.push(configResult.issue);
  if (statusResult.issue) issues.push(statusResult.issue);

  if (!configResult.data && !statusResult.data) {
    return null;
  }

  const config = configResult.data ?? {};
  const status = statusResult.data ?? {};

  const runtimeIp = status.status === "running"
    ? await getVmRuntimeIp(node, vmid)
    : null;

  const isoVolid = extractVmIsoVolid(config);
  const isoFileName = isoVolid.split("/").at(-1) ?? "";

  const qemuCoresConfigured = toOptionalNumber(config.cores);
  const qemuMemoryConfiguredMb = toOptionalNumber(config.memory);

  return {
    configAccessible: Boolean(configResult.data),
    coresConfigured: qemuCoresConfigured,
    cpu:
      status.cpus && status.cpus > 0
        ? `${status.cpus} vCPU`
        : typeof config.cores === "number" || typeof config.cores === "string"
          ? `${Number(config.cores) * Number(config.sockets || 1)} vCPU`
          : "Unavailable",
    cpuUsage: typeof status.cpu === "number" ? status.cpu : null,
    description: config.description ?? "",
    digest: config.digest ?? "",
    disk: formatBytes(status.maxdisk ?? 0),
    diskTotalBytes: status.maxdisk ?? null,
    diskUsedBytes: typeof status.disk === "number" ? status.disk : null,
    environmentMode: "QEMU VM",
    envCount: 0,
    envText: "",
    guestOsType: config.ostype ?? undefined,
    id,
    ipAddress: runtimeIp || "Unavailable",
    issues: dedupeIssues(issues),
    memTotalBytes: status.maxmem ?? null,
    memUsedBytes: typeof status.mem === "number" ? status.mem : null,
    memory: formatBytes(
      status.maxmem ??
        (typeof config.memory === "number" ? config.memory * 1024 * 1024 : 0),
    ),
    memoryConfiguredMb: qemuMemoryConfiguredMb,
    swapConfiguredMb: null,
    name: status.name ?? config.name ?? `VM ${vmid}`,
    networkInfo: null,
    node,
    ostemplate: isoVolid || "No ISO",
    rawStatus: status.status ?? "unknown",
    resourceUsage: status.status === "running"
      ? {
          cpuRatio: status.cpu ?? 0,
          diskReadBytes: status.diskread ?? 0,
          diskTotalBytes: status.maxdisk ?? 0,
          diskUsedBytes: status.disk ?? 0,
          diskWriteBytes: status.diskwrite ?? 0,
          memTotalBytes: status.maxmem ?? 0,
          memUsedBytes: status.mem ?? 0,
          netInBytes: status.netin ?? 0,
          netOutBytes: status.netout ?? 0,
        }
      : null,
    rootfs: config.scsi0 ?? config.ide0 ?? "Unavailable",
    statusLabel: formatStatusLabel(status.status),
    tagList: parseTags(config.tags),
    tainerMeta: parseTainerMeta(config.description ?? ""),
    templateName: isoFileName
      ? titleFromTemplateFile(isoFileName)
      : "QEMU VM",
    type: "qemu",
    uptime: formatUptime(status.uptime),
    vmid,
    vmCpuType: config.cpu,
    vmSockets: typeof config.sockets === "number" ? config.sockets : typeof config.sockets === "string" ? Number(config.sockets) : undefined,
    vmMachineType: config.machine,
    vmScsiHw: config.scsihw,
    vmVga: config.vga,
    vmIso: isoVolid || undefined,
  };
}

export async function createContainer(node: string, params: URLSearchParams) {
  const safeNode = validateNodeName(node);

  return proxmoxRequest<string>(`/nodes/${safeNode}/lxc`, {
    method: "POST",
    params,
  });
}

export async function migrateContainer(
  node: string,
  vmid: number,
  target: string,
) {
  const safeNode = validateNodeName(node);
  const safeVmid = validatePositiveInteger(vmid, "VMID");
  const safeTarget = validateNodeName(target, "target node");
  const params = new URLSearchParams();
  params.set("target", safeTarget);
  params.set("restart", "1");

  return proxmoxRequest<string>(`/nodes/${safeNode}/lxc/${safeVmid}/migrate`, {
    method: "POST",
    params,
  });
}

export async function getNodes(): Promise<{
  nodes: LiveNode[];
  metrics: LiveNodeMetrics[];
}> {
  const nodesResult = await listNodesInternal();
  const nodes = mapLiveNodes(nodesResult.data);
  const result = await listNodeMetricsInternal(nodes);

  return { nodes, metrics: result.metrics };
}

export function getBestNode(
  nodes: LiveNode[],
  metrics: LiveNodeMetrics[],
): string | null {
  let bestNode: string | null = null;
  let bestScore = -1;

  for (const node of nodes) {
    if (node.status !== "online") continue;

    const m = metrics.find((entry) => entry.node === node.name);
    if (!m) continue;

    const freeMemory = (m.memoryTotalBytes ?? 0) - (m.memoryUsedBytes ?? 0);
    const freeCpu = 1 - (m.cpuRatio ?? 1);
    const score = freeMemory * 0.7 + freeCpu * 1e12 * 0.3;

    if (score > bestScore) {
      bestScore = score;
      bestNode = node.name;
    }
  }

  return bestNode;
}

export async function deleteContainer(node: string, vmid: number) {
  const safeNode = validateNodeName(node);
  const safeVmid = validatePositiveInteger(vmid, "VMID");

  return proxmoxRequest<string>(`/nodes/${safeNode}/lxc/${safeVmid}`, {
    method: "DELETE",
  });
}

export async function importTemplateFromUrl(
  node: string,
  storage: string,
  params: URLSearchParams,
) {
  const safeNode = validateNodeName(node);
  const safeStorage = validateStorageName(storage);

  return proxmoxRequest<string>(
    `/nodes/${safeNode}/storage/${safeStorage}/download-url`,
    {
      method: "POST",
      params,
    },
  );
}

export async function getTemplateFileInfo(
  node: string,
  volid: string,
): Promise<{ size: number; ctime: number } | null> {
  const safeNode = validateNodeName(node);
  const colonIdx = volid.indexOf(":");
  if (colonIdx < 1) return null;
  const storage = validateStorageName(volid.slice(0, colonIdx));
  const index = await getTemplateContentIndex(safeNode, storage);

  return index.get(volid) ?? null;
}

export async function pullOciRegistryTemplate(
  node: string,
  storage: string,
  reference: string,
) {
  const safeNode = validateNodeName(node);
  const safeStorage = validateStorageName(storage);
  const params = new URLSearchParams();
  params.set("reference", reference);

  return proxmoxRequest<string>(
    `/nodes/${safeNode}/storage/${safeStorage}/oci-registry-pull`,
    {
      method: "POST",
      params,
    },
  );
}

const UPID_REGEX = /^UPID:[a-zA-Z0-9._-]+:[0-9A-Fa-f]+:[0-9A-Fa-f]+:[0-9A-Fa-f]+:[a-zA-Z0-9_-]+:[^:]*:[^:]+:$/;

export function validateUpid(upid: string): string {
  if (!UPID_REGEX.test(upid)) {
    throw new Error("Invalid Proxmox task UPID format.");
  }
  return upid;
}

export async function getTaskSnapshot(
  node: string,
  upid: string,
): Promise<ProxmoxTaskSnapshot> {
  const safeNode = validateNodeName(node);
  const safeUpid = validateUpid(upid);

  const [statusResult, logResult] = await Promise.all([
    safeRequest<ProxmoxTaskStatusResponse>(`/nodes/${safeNode}/tasks/${safeUpid}/status`),
    safeRequest<ProxmoxTaskLogEntryResponse[]>(`/nodes/${safeNode}/tasks/${safeUpid}/log`),
  ]);

  if (!statusResult.data) {
    throw new Error(
      statusResult.issue?.message || "Failed to load task status from Proxmox.",
    );
  }

  const logs = logResult.data ?? [];
  const taskStatus = normalizeTaskState(
    statusResult.data.status,
    statusResult.data.exitstatus,
    logs,
  );
  const exitStatus = statusResult.data.exitstatus ?? null;

  return {
    completed: taskStatus !== "running",
    exitStatus,
    latestLog: latestInterestingTaskLog(logs),
    message: buildTaskMessage(taskStatus, exitStatus, logs),
    node: safeNode,
    progress: estimateTaskProgress(
      taskStatus,
      statusResult.data.type ?? "task",
      logs,
    ),
    status: taskStatus,
    taskId: statusResult.data.id ?? "",
    taskType: statusResult.data.type ?? "task",
    upid: safeUpid,
  };
}

export async function getSkippedCustomLxcConfigLines(
  node: string,
  upid: string,
): Promise<string[]> {
  const safeNode = validateNodeName(node);
  const safeUpid = validateUpid(upid);

  const logs = await proxmoxRequest<ProxmoxTaskLogEntryResponse[]>(
    `/nodes/${safeNode}/tasks/${safeUpid}/log`,
  );

  const lines = logs
    .map((entry) => entry.t?.trim())
    .filter((line): line is string => Boolean(line));

  const warningIndex = lines.findIndex(
    (line) => line === "WARN: skipping custom lxc options, restore manually as root:",
  );

  if (warningIndex < 0) {
    return [];
  }

  const skippedLines: string[] = [];

  for (const line of lines.slice(warningIndex + 1)) {
    if (!line || line === "TASK OK" || line.startsWith("TASK WARNINGS")) {
      break;
    }

    if (/^-{3,}$/.test(line)) {
      continue;
    }

    if (!line.startsWith("lxc.") || !line.includes(":")) {
      continue;
    }

    skippedLines.push(line);
  }

  return [...new Set(skippedLines)];
}

export async function getLatestDeploymentActivity(
  node: string,
  vmid: number,
): Promise<DeploymentActivity | null> {
  const safeNode = validateNodeName(node);
  const safeVmid = validatePositiveInteger(vmid, "VMID");
  const params = new URLSearchParams();

  params.set("vmid", String(safeVmid));

  const result = await safeRequest<ProxmoxTaskListEntryResponse[]>(
    `/nodes/${safeNode}/tasks`,
    { params },
  );

  const activities = (result.data ?? [])
    .map((task) => deploymentActivityFromTask(task))
    .filter((activity): activity is DeploymentActivity => Boolean(activity));

  if (activities.length === 0) {
    return null;
  }

  activities.sort((left, right) => {
    const leftTime = left.occurredAt ? new Date(left.occurredAt).getTime() : 0;
    const rightTime = right.occurredAt ? new Date(right.occurredAt).getTime() : 0;

    return rightTime - leftTime;
  });

  return activities[0] ?? null;
}

export async function waitForTask(node: string, upid: string): Promise<void> {
  const safeNode = validateNodeName(node);
  const safeUpid = validateUpid(upid);

  while (true) {
    const snapshot = await getTaskSnapshot(safeNode, safeUpid);

    if (snapshot.completed) {
      if (snapshot.status === "error") {
        throw new Error(snapshot.message || "Proxmox task failed.");
      }
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 500));
  }
}


export async function updateContainerConfig(
  node: string,
  vmid: number,
  params: URLSearchParams,
) {
  const safeNode = validateNodeName(node);
  const safeVmid = validatePositiveInteger(vmid, "VMID");

  return proxmoxRequest<string>(`/nodes/${safeNode}/lxc/${safeVmid}/config`, {
    method: "PUT",
    params,
  });
}

export async function runContainerLifecycleAction(
  node: string,
  vmid: number,
  action: ContainerLifecycleAction,
) {
  const safeNode = validateNodeName(node);
  const safeVmid = validatePositiveInteger(vmid, "VMID");
  const endpointAction = action === "restart" ? "reboot" : action;

  return proxmoxRequest<string>(
    `/nodes/${safeNode}/lxc/${safeVmid}/status/${endpointAction}`,
    {
      method: "POST",
    },
  );
}

export async function createVm(node: string, params: URLSearchParams) {
  const safeNode = validateNodeName(node);

  return proxmoxRequest<string>(`/nodes/${safeNode}/qemu`, {
    method: "POST",
    params,
  });
}

export async function deleteVm(node: string, vmid: number) {
  const safeNode = validateNodeName(node);
  const safeVmid = validatePositiveInteger(vmid, "VMID");

  return proxmoxRequest<string>(`/nodes/${safeNode}/qemu/${safeVmid}`, {
    method: "DELETE",
  });
}

export async function runVmLifecycleAction(
  node: string,
  vmid: number,
  action: VmLifecycleAction,
) {
  const safeNode = validateNodeName(node);
  const safeVmid = validatePositiveInteger(vmid, "VMID");
  const endpointAction = action === "restart" ? "reboot" : action;

  return proxmoxRequest<string>(
    `/nodes/${safeNode}/qemu/${safeVmid}/status/${endpointAction}`,
    {
      method: "POST",
    },
  );
}

export async function updateVmConfig(
  node: string,
  vmid: number,
  params: URLSearchParams,
) {
  const safeNode = validateNodeName(node);
  const safeVmid = validatePositiveInteger(vmid, "VMID");

  return proxmoxRequest<string>(`/nodes/${safeNode}/qemu/${safeVmid}/config`, {
    method: "PUT",
    params,
  });
}

export async function syncProxmoxManagedTagColor(tag: string, color: string) {
  const normalizedTag = tag.trim();

  if (!normalizedTag) {
    return;
  }

  const current = await proxmoxRequest<ProxmoxClusterOptionsResponse | null>("/cluster/options");
  const tagStyleOptions = parseTagStyleOptions(current?.["tag-style"]);
  const colorMap = parseTagStyleColorMap(tagStyleOptions.get("color-map"));
  const nextColorSpec = getProxmoxTagColorSpec(color);

  if (colorMap.get(normalizedTag) === nextColorSpec) {
    return;
  }

  colorMap.set(normalizedTag, nextColorSpec);

  tagStyleOptions.set("color-map", serializeTagStyleColorMap(colorMap));

  const params = new URLSearchParams();
  params.set("tag-style", serializeTagStyleOptions(tagStyleOptions));

  await proxmoxRequest<string>("/cluster/options", {
    method: "PUT",
    params,
  });
  invalidateProxmoxGetCache("/cluster/options");
}

export async function removeProxmoxManagedTagColor(tag: string) {
  const normalizedTag = tag.trim();

  if (!normalizedTag) {
    return;
  }

  const current = await proxmoxRequest<ProxmoxClusterOptionsResponse | null>("/cluster/options");
  const tagStyleOptions = parseTagStyleOptions(current?.["tag-style"]);
  const colorMap = parseTagStyleColorMap(tagStyleOptions.get("color-map"));

  if (!colorMap.delete(normalizedTag)) {
    return;
  }

  if (colorMap.size > 0) {
    tagStyleOptions.set("color-map", serializeTagStyleColorMap(colorMap));
  } else {
    tagStyleOptions.delete("color-map");
  }

  const params = new URLSearchParams();
  const nextTagStyle = serializeTagStyleOptions(tagStyleOptions);

  if (nextTagStyle) {
    params.set("tag-style", nextTagStyle);
  } else {
    params.set("delete", "tag-style");
  }

  await proxmoxRequest<string>("/cluster/options", {
    method: "PUT",
    params,
  });
  invalidateProxmoxGetCache("/cluster/options");
}

export async function resolveCloudInitSnippetStorage(node: string) {
  const safeNode = validateNodeName(node);
  const requestedStorage = process.env.PROXMOX_CLOUD_INIT_SNIPPET_STORAGE?.trim();

  if (requestedStorage) {
    const safeStorage = validateStorageName(requestedStorage, "snippet storage");
    const storageResult = await safeRequest<ProxmoxStorageResponse[]>(`/nodes/${safeNode}/storage`);
    const storage = (storageResult.data ?? []).find((entry) => entry.storage === safeStorage);

    if (!storage) {
      throw new Error(`Snippet storage "${safeStorage}" is not visible on node ${safeNode}.`);
    }

    if (!parseStorageContentTypes(storage.content).includes("snippets")) {
      throw new Error(`Storage "${safeStorage}" does not support Proxmox snippets.`);
    }

    return safeStorage;
  }

  const storageResult = await safeRequest<ProxmoxStorageResponse[]>(`/nodes/${safeNode}/storage`);
  const snippetStorage = (storageResult.data ?? []).find((entry) =>
    parseStorageContentTypes(entry.content).includes("snippets"),
  );

  if (!snippetStorage) {
    throw new Error(
      "No snippet-capable Proxmox storage is available. Configure one with `snippets` content before deploying SSH-ready VMs.",
    );
  }

  return snippetStorage.storage;
}

export async function uploadStorageSnippet(input: {
  content: string;
  fileName: string;
  node: string;
  storage: string;
}) {
  const config = getActiveSiteConfig();

  const safeNode = validateNodeName(input.node);
  const safeStorage = validateStorageName(input.storage);
  const sanitizedFileName = input.fileName.trim().replace(/[^a-zA-Z0-9._-]/g, "-");

  if (!sanitizedFileName) {
    throw new Error("Snippet filename is required.");
  }

  const boundary = `----tainer-snippet-${Date.now().toString(16)}`;
  const multipartBody = Buffer.from(
    [
      `--${boundary}\r\n`,
      'Content-Disposition: form-data; name="content"\r\n\r\n',
      "snippets\r\n",
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="filename"; filename="${sanitizedFileName}"\r\n`,
      "Content-Type: text/plain\r\n\r\n",
      input.content,
      "\r\n",
      `--${boundary}--\r\n`,
    ].join(""),
    "utf8",
  );

  const url = buildProxmoxUrl(`/api2/json/nodes/${safeNode}/storage/${safeStorage}/upload`, config.apiUrl);

  const pveAuth = await getPveTicket(config);
  const uploadTlsOpts = url.protocol === "https:" ? await buildTlsOptions(config) : {};
  const uploadRequestModule = url.protocol === "https:" ? https : http;

  const result = await new Promise<string>((resolve, reject) => {
    const request = uploadRequestModule.request(
      url,
      {
        headers: {
          Cookie: `PVEAuthCookie=${pveAuth.ticket}`,
          CSRFPreventionToken: pveAuth.csrfToken,
          "Content-Length": multipartBody.byteLength,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        method: "POST",
        ...uploadTlsOpts,
      },
      (response) => {
        let raw = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          try {
            const parsed = parseJson<string>(raw);

            if (parsed.message) {
              reject(new ProxmoxApiError(parsed.message, url.pathname));
              return;
            }

            resolve(parsed.data as string);
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on("error", (error) => {
      reject(new ProxmoxApiError(error.message, url.pathname));
    });
    request.write(multipartBody);
    request.end();
  });

  return result;
}

export async function migrateVm(
  node: string,
  vmid: number,
  target: string,
) {
  const safeNode = validateNodeName(node);
  const safeVmid = validatePositiveInteger(vmid, "VMID");
  const safeTarget = validateNodeName(target, "target node");
  const params = new URLSearchParams();
  params.set("target", safeTarget);
  params.set("online", "1");

  return proxmoxRequest<string>(`/nodes/${safeNode}/qemu/${safeVmid}/migrate`, {
    method: "POST",
    params,
  });
}

export async function listIsoImages(nodes: LiveNode[]) {
  const issues: ProxmoxIssue[] = [];

  const storageResults = await Promise.all(
    nodes.map(async (node) => {
      const storageResult = await safeRequest<ProxmoxStorageResponse[]>(
        `/nodes/${node.name}/storage`,
      );
      return { node, storageResult };
    }),
  );

  const seenStorage = new Set<string>();
  const storageToQuery: { node: LiveNode; storage: ProxmoxStorageResponse }[] = [];

  for (const { node, storageResult } of storageResults) {
    if (storageResult.issue) {
      issues.push(storageResult.issue);
      continue;
    }

    for (const storage of storageResult.data ?? []) {
      if (!parseStorageContentTypes(storage.content).includes("iso")) {
        continue;
      }

      if (seenStorage.has(storage.storage)) {
        continue;
      }
      seenStorage.add(storage.storage);
      storageToQuery.push({ node, storage });
    }
  }

  const contentResults = await Promise.all(
    storageToQuery.map(async ({ node, storage }) => {
      const contentResult = await safeRequest<ProxmoxStorageContentResponse[]>(
        `/nodes/${node.name}/storage/${storage.storage}/content?content=iso`,
      );
      return { node, storage, contentResult };
    }),
  );

  type IsoImage = {
    createdAt: string | null;
    fileName: string;
    node: string;
    sizeLabel: string;
    storage: string;
    volid: string;
  };

  const images: IsoImage[] = [];
  for (const { node, storage, contentResult } of contentResults) {
    if (contentResult.issue) {
      issues.push(contentResult.issue);
      continue;
    }

    for (const entry of contentResult.data ?? []) {
      const fileName = entry.volid.split("/").at(-1) ?? entry.volid;
      images.push({
        createdAt: entry.ctime ? new Date(entry.ctime * 1000).toISOString() : null,
        fileName,
        node: node.name,
        sizeLabel: formatBytes(entry.size ?? 0),
        storage: storage.storage,
        volid: entry.volid,
      });
    }
  }

  images.sort((a, b) => a.fileName.localeCompare(b.fileName));

  return { images, issues };
}

export type IsoImage = {
  createdAt: string | null;
  fileName: string;
  node: string;
  sizeLabel: string;
  storage: string;
  volid: string;
};

export async function getIsoStorageTargets(nodes: LiveNode[]) {
  const storageResult = await listStoragePoolsInternal(nodes);

  return {
    issues: storageResult.issues,
    targets: storageResult.pools.filter((pool) => pool.isIsoCapable),
  };
}

export async function getDiskStorageTargets(nodes: LiveNode[]) {
  const storageResult = await listStoragePoolsInternal(nodes);

  return {
    issues: storageResult.issues,
    targets: storageResult.pools.filter(
      (pool) => pool.contentTypes.includes("images") || pool.contentTypes.includes("rootdir"),
    ),
  };
}

export function getProxmoxDefaults() {
  if (!hasSiteConfig()) {
    return {
      defaultNode: "",
      defaultRootfsStorage: "",
      defaultVmStorage: "",
      defaultIsoStorage: "",
    };
  }

  const config = getActiveSiteConfig();

  return {
    defaultNode: config.defaultNode,
    defaultRootfsStorage: config.defaultRootfsStorage,
    defaultVmStorage: config.defaultVmStorage,
    defaultIsoStorage: config.defaultIsoStorage,
  };
}

type ProxmoxBackupJobResponse = {
  all?: number;
  compress?: string;
  dow?: string;
  enabled?: number;
  exclude?: string;
  id?: string;
  mailnotification?: string;
  mailto?: string;
  maxfiles?: number;
  mode?: string;
  node?: string;
  "prune-backups"?: string;
  schedule?: string;
  starttime?: string;
  storage?: string;
  type?: string;
  vmid?: string;
};

type ProxmoxBackupArchiveResponse = {
  content?: string;
  ctime?: number;
  format?: string;
  notes?: string;
  size?: number;
  subtype?: string;
  verification?: { state?: string; upid?: string };
  volid: string;
  vmid?: number;
};

export type ProxmoxBackupStoragePool = {
  availableBytes: number | null;
  contentTypes: string[];
  issues: string[];
  node: string;
  shared: boolean;
  storage: string;
  totalBytes: number | null;
  type: string;
  usageRatio: number | null;
  usedBytes: number | null;
};

export type ProxmoxBackupArchive = {
  ctime: number;
  ctimeIso: string;
  format: string;
  node: string;
  notes: string;
  sizeBytes: number;
  storage: string;
  subtype: string;
  vmid: number;
  volid: string;
};

export type ProxmoxBackupJob = {
  all: boolean;
  compress: string;
  dow: string;
  enabled: boolean;
  id: string;
  mode: string;
  node: string;
  pruneBackups: string;
  schedule: string;
  storage: string;
  type: string;
  vmids: number[];
};

export type ProtectionReason = {
  level: "error" | "warning";
  message: string;
};

export type ProtectionStatus = "protected" | "unprotected" | "warning";

export type ProxmoxBackupCoverage = {
  lastBackupAge: number | null;
  lastBackupDate: string | null;
  protectionReasons: ProtectionReason[];
  protectionStatus: ProtectionStatus;
  totalArchives: number;
};

export type ProxmoxDeploymentBackupInfo = {
  archives: ProxmoxBackupArchive[];
  coverage: ProxmoxBackupCoverage;
  mountWarnings: ProtectionReason[];
};

export type ProxmoxBackupSummary = {
  backupStoragePools: ProxmoxBackupStoragePool[];
  issues: ProxmoxIssue[];
  jobs: ProxmoxBackupJob[];
  recentArchives: ProxmoxBackupArchive[];
  unprotectedVmids: number[];
};

export type LxcMountInfo = {
  backup: boolean;
  isBind: boolean;
  mountPoint: string;
  source: string;
  volume: string;
};

function parseBackupStoragePool(
  node: string,
  storage: ProxmoxStorageResponse,
): ProxmoxBackupStoragePool {
  const contentTypes = parseStorageContentTypes(storage.content);
  const issues: string[] = [];

  if (storage.enabled === 0) {
    issues.push("Storage is disabled");
  }

  if (storage.active === 0) {
    issues.push("Storage is not active/accessible");
  }

  const total = normalizeMaybeNumber(storage.total);
  const avail = normalizeMaybeNumber(storage.avail);

  if (total != null && total === 0) {
    issues.push("Storage reports zero capacity");
  }

  if (total != null && avail != null && total > 0 && avail / total < 0.05) {
    issues.push("Storage has less than 5% free space");
  }

  return {
    availableBytes: avail,
    contentTypes,
    issues,
    node,
    shared: Boolean(storage.shared),
    storage: storage.storage,
    totalBytes: total,
    type: storage.type ?? "unknown",
    usageRatio: normalizeMaybeNumber(storage.used_fraction),
    usedBytes: normalizeMaybeNumber(storage.used),
  };
}

export async function listBackupStoragePools(): Promise<{
  issues: ProxmoxIssue[];
  pools: ProxmoxBackupStoragePool[];
}> {
  const nodesResult = await safeRequest<ProxmoxNodeResponse[]>("/nodes");

  if (nodesResult.issue || !nodesResult.data) {
    return {
      issues: nodesResult.issue ? [nodesResult.issue] : [],
      pools: [],
    };
  }

  const issues: ProxmoxIssue[] = [];
  const seen = new Set<string>();
  const pools: ProxmoxBackupStoragePool[] = [];

  const results = await Promise.all(
    nodesResult.data.map(async (pveNode) => {
      const storageResult = await safeRequest<ProxmoxStorageResponse[]>(
        `/nodes/${pveNode.node}/storage`,
      );
      return { node: pveNode.node, storageResult };
    }),
  );

  for (const { node, storageResult } of results) {
    if (storageResult.issue) {
      issues.push(storageResult.issue);
      continue;
    }

    for (const storage of storageResult.data ?? []) {
      const contentTypes = parseStorageContentTypes(storage.content);

      if (!contentTypes.includes("backup")) {
        continue;
      }

      const key = getStorageScopeKey(node, storage);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      pools.push(parseBackupStoragePool(node, storage));
    }
  }

  return { issues, pools };
}

export async function getBackupStorageHealth(): Promise<{
  healthyPools: ProxmoxBackupStoragePool[];
  issues: ProxmoxIssue[];
  unhealthyPools: ProxmoxBackupStoragePool[];
}> {
  const { issues, pools } = await listBackupStoragePools();
  const healthyPools: ProxmoxBackupStoragePool[] = [];
  const unhealthyPools: ProxmoxBackupStoragePool[] = [];

  for (const pool of pools) {
    if (pool.issues.length > 0) {
      unhealthyPools.push(pool);
    } else {
      healthyPools.push(pool);
    }
  }

  return { healthyPools, issues, unhealthyPools };
}

export async function listScheduledBackupJobs(): Promise<{
  issues: ProxmoxIssue[];
  jobs: ProxmoxBackupJob[];
}> {
  const result = await safeRequest<ProxmoxBackupJobResponse[]>(
    "/cluster/backup",
  );

  if (result.issue || !result.data) {
    return {
      issues: result.issue ? [result.issue] : [],
      jobs: [],
    };
  }

  const jobs: ProxmoxBackupJob[] = result.data.map((job) => ({
    all: job.all === 1,
    compress: job.compress ?? "lzo",
    dow: job.dow ?? "",
    enabled: job.enabled !== 0,
    id: job.id ?? "",
    mode: job.mode ?? "snapshot",
    node: job.node ?? "",
    pruneBackups: job["prune-backups"] ?? "",
    schedule: job.schedule ?? job.starttime ?? "",
    storage: job.storage ?? "",
    type: job.type ?? "vzdump",
    vmids: job.vmid
      ? job.vmid
          .split(",")
          .map((id) => Number.parseInt(id.trim(), 10))
          .filter((id) => !Number.isNaN(id))
      : [],
  }));

  return { issues: [], jobs };
}

export async function listBackupsForVm(
  node: string,
  vmid: number,
): Promise<{
  archives: ProxmoxBackupArchive[];
  issues: ProxmoxIssue[];
}> {
  const { issues, pools } = await listBackupStoragePools();
  const archives: ProxmoxBackupArchive[] = [];

  const results = await Promise.all(
    pools
      .filter((pool) => pool.issues.length === 0)
      .map(async (pool) => {
        const storageNode = pool.shared ? node : pool.node;
        const result = await safeRequest<ProxmoxBackupArchiveResponse[]>(
          `/nodes/${storageNode}/storage/${pool.storage}/content`,
          { params: new URLSearchParams({ content: "backup", vmid: String(vmid) }) },
        );
        return { pool, result };
      }),
  );

  for (const { pool, result } of results) {
    if (result.issue) {
      issues.push(result.issue);
      continue;
    }

    for (const archive of result.data ?? []) {
      if (archive.content !== "backup") continue;

      archives.push({
        ctime: archive.ctime ?? 0,
        ctimeIso: archive.ctime
          ? new Date(archive.ctime * 1000).toISOString()
          : "",
        format: archive.format ?? "unknown",
        node: pool.node,
        notes: archive.notes ?? "",
        sizeBytes: archive.size ?? 0,
        storage: pool.storage,
        subtype: archive.subtype ?? "",
        vmid: archive.vmid ?? vmid,
        volid: archive.volid,
      });
    }
  }

  archives.sort((a, b) => b.ctime - a.ctime);

  return { archives, issues };
}

export async function listAllBackups(): Promise<{
  archives: ProxmoxBackupArchive[];
  issues: ProxmoxIssue[];
}> {
  const nodesResult = await safeRequest<ProxmoxNodeResponse[]>("/nodes");

  if (nodesResult.issue || !nodesResult.data) {
    return {
      archives: [],
      issues: nodesResult.issue ? [nodesResult.issue] : [],
    };
  }

  const { issues, pools } = await listBackupStoragePools();
  const archives: ProxmoxBackupArchive[] = [];
  const firstNode = nodesResult.data[0]?.node ?? "";

  const results = await Promise.all(
    pools
      .filter((pool) => pool.issues.length === 0)
      .map(async (pool) => {
        const storageNode = pool.shared ? firstNode : pool.node;
        const result = await safeRequest<ProxmoxBackupArchiveResponse[]>(
          `/nodes/${storageNode}/storage/${pool.storage}/content`,
          { params: new URLSearchParams({ content: "backup" }) },
        );
        return { pool, result };
      }),
  );

  for (const { pool, result } of results) {
    if (result.issue) {
      issues.push(result.issue);
      continue;
    }

    for (const archive of result.data ?? []) {
      if (archive.content !== "backup") continue;

      archives.push({
        ctime: archive.ctime ?? 0,
        ctimeIso: archive.ctime
          ? new Date(archive.ctime * 1000).toISOString()
          : "",
        format: archive.format ?? "unknown",
        node: pool.node,
        notes: archive.notes ?? "",
        sizeBytes: archive.size ?? 0,
        storage: pool.storage,
        subtype: archive.subtype ?? "",
        vmid: archive.vmid ?? 0,
        volid: archive.volid,
      });
    }
  }

  archives.sort((a, b) => b.ctime - a.ctime);

  return { archives, issues };
}

export async function triggerBackup(
  node: string,
  vmid: number,
  storage: string,
  options?: {
    compress?: string;
    mode?: string;
    notes?: string;
  },
): Promise<string> {
  const validatedNode = validateNodeName(node);
  const validatedVmid = validatePositiveInteger(vmid, "vmid");
  const validatedStorage = validateStorageName(storage);

  const params = new URLSearchParams({
    compress: options?.compress ?? "zstd",
    mode: options?.mode ?? "snapshot",
    storage: validatedStorage,
    vmid: String(validatedVmid),
  });

  if (options?.notes) {
    params.set("notes-template", options.notes);
  }

  const upid = await proxmoxRequest<string>(
    `/nodes/${validatedNode}/vzdump`,
    { method: "POST", params },
  );

  return upid;
}

export async function restoreBackup(
  node: string,
  targetVmid: number,
  archiveVolid: string,
  storage: string,
  options?: { force?: boolean },
): Promise<string> {
  const validatedNode = validateNodeName(node);
  const validatedVmid = validatePositiveInteger(targetVmid, "vmid");
  const validatedStorage = validateStorageName(storage);

  const isLxc = archiveVolid.includes("vzdump-lxc-");

  if (isLxc) {
    const params = new URLSearchParams({
      ostemplate: archiveVolid,
      restore: "1",
      storage: validatedStorage,
      vmid: String(validatedVmid),
    });
    if (options?.force) {
      params.set("force", "1");
    }

    const upid = await proxmoxRequest<string>(
      `/nodes/${validatedNode}/lxc`,
      { method: "POST", params },
    );
    return upid;
  }

  const qemuParams = new URLSearchParams({
    archive: archiveVolid,
    storage: validatedStorage,
    vmid: String(validatedVmid),
  });
  if (options?.force) {
    qemuParams.set("force", "1");
  }

  const upid = await proxmoxRequest<string>(
    `/nodes/${validatedNode}/qemu`,
    { method: "POST", params: qemuParams },
  );

  return upid;
}

export async function deleteBackup(
  node: string,
  storage: string,
  volid: string,
): Promise<string | null> {
  const validatedNode = validateNodeName(node);
  const validatedStorage = validateStorageName(storage);
  const validatedVolid = validateBackupVolid(volid, validatedStorage);

  const upid = await proxmoxRequest<string | null>(
    `/nodes/${validatedNode}/storage/${validatedStorage}/content/${validatedVolid}`,
    { method: "DELETE" },
  );

  return upid ?? null;
}

export function parseLxcMountPoints(
  config: Record<string, unknown>,
): LxcMountInfo[] {
  const mounts: LxcMountInfo[] = [];

  for (const [key, value] of Object.entries(config)) {
    if (!/^mp\d+$/.test(key) || typeof value !== "string") {
      continue;
    }

    const parts = value.split(",").map((s) => s.trim());
    const volume = parts[0] ?? "";
    let mountPoint = "";
    let backup = true;
    let isBind = false;

    for (const part of parts.slice(1)) {
      if (part.startsWith("mp=")) {
        mountPoint = part.slice(3);
      }

      if (part === "backup=0") {
        backup = false;
      }
    }

    if (volume.startsWith("/")) {
      isBind = true;
      backup = false; // bind mounts are excluded from vzdump archives
    }

    mounts.push({
      backup,
      isBind,
      mountPoint: mountPoint || key,
      source: key,
      volume,
    });
  }

  return mounts;
}

export async function getLxcMountPoints(
  node: string,
  vmid: number,
): Promise<LxcMountInfo[]> {
  const result = await safeRequest<ProxmoxLxcConfigResponse>(
    `/nodes/${node}/lxc/${vmid}/config`,
  );

  if (!result.data) {
    return [];
  }

  return parseLxcMountPoints(result.data as Record<string, unknown>);
}

export function computeBackupCoverage(
  vmid: number,
  type: "lxc" | "qemu",
  archives: ProxmoxBackupArchive[],
  jobs: ProxmoxBackupJob[],
  backupPools: ProxmoxBackupStoragePool[],
  mountPoints: LxcMountInfo[],
  slaHours: number,
): ProxmoxBackupCoverage {
  const reasons: ProtectionReason[] = [];
  const now = Date.now();

  const healthyPools = backupPools.filter((p) => p.issues.length === 0);
  if (healthyPools.length === 0) {
    reasons.push({
      level: "error",
      message: "No healthy backup storage is currently available",
    });
  }

  const coveredByJob = jobs.some(
    (job) =>
      job.enabled &&
      (job.all || job.vmids.includes(vmid)),
  );

  if (!coveredByJob) {
    reasons.push({
      level: "warning",
      message: `No scheduled backup job includes VMID ${vmid}`,
    });
  }

  const vmArchives = archives.filter((a) => a.vmid === vmid);
  const latestArchive = vmArchives[0] ?? null;
  const lastBackupAge =
    latestArchive ? (now - latestArchive.ctime * 1000) / 3600000 : null;
  const lastBackupDate = latestArchive?.ctimeIso ?? null;

  if (!latestArchive) {
    reasons.push({
      level: "error",
      message: `No backup archives exist for VMID ${vmid}`,
    });
  } else if (slaHours > 0 && lastBackupAge != null && lastBackupAge > slaHours) {
    reasons.push({
      level: "warning",
      message: `Last backup is ${Math.round(lastBackupAge)}h old, exceeding the ${slaHours}h SLA`,
    });
  }

  if (type === "lxc") {
    for (const mp of mountPoints) {
      if (mp.isBind) {
        reasons.push({
          level: "warning",
          message: `Bind mount ${mp.volume} at ${mp.mountPoint} is not included in archive data`,
        });
      } else if (!mp.backup) {
        reasons.push({
          level: "warning",
          message: `Mount point ${mp.source} (${mp.mountPoint}) is excluded from vzdump backups (backup=0)`,
        });
      }
    }
  }

  const usedStorages = new Set(vmArchives.map((a) => a.storage));
  for (const pool of backupPools) {
    if (usedStorages.has(pool.storage) && pool.issues.length > 0) {
      reasons.push({
        level: "warning",
        message: `Backup storage "${pool.storage}" has issues: ${pool.issues.join(", ")}`,
      });
    }
  }

  let protectionStatus: ProtectionStatus = "protected";

  if (reasons.some((r) => r.level === "error")) {
    protectionStatus = "unprotected";
  } else if (reasons.length > 0) {
    protectionStatus = "warning";
  }

  return {
    lastBackupAge,
    lastBackupDate,
    protectionReasons: reasons,
    protectionStatus,
    totalArchives: vmArchives.length,
  };
}

export async function getDeploymentBackupInfo(
  node: string,
  vmid: number,
  type: "lxc" | "qemu",
  slaHours: number,
): Promise<ProxmoxDeploymentBackupInfo> {
  const [backupResult, jobsResult, storageResult, mountPoints] =
    await Promise.all([
      listBackupsForVm(node, vmid),
      listScheduledBackupJobs(),
      listBackupStoragePools(),
      type === "lxc" ? getLxcMountPoints(node, vmid) : Promise.resolve([]),
    ]);

  const mountWarnings: ProtectionReason[] = [];
  for (const mp of mountPoints) {
    if (mp.isBind) {
      mountWarnings.push({
        level: "warning",
        message: `Bind mount ${mp.volume} at ${mp.mountPoint} is not included in archive data`,
      });
    } else if (!mp.backup) {
      mountWarnings.push({
        level: "warning",
        message: `Mount point ${mp.source} (${mp.mountPoint}) is excluded from vzdump backups (backup=0)`,
      });
    }
  }

  const coverage = computeBackupCoverage(
    vmid,
    type,
    backupResult.archives,
    jobsResult.jobs,
    storageResult.pools,
    mountPoints,
    slaHours,
  );

  return {
    archives: backupResult.archives,
    coverage,
    mountWarnings,
  };
}

export async function getBackupOverview(): Promise<ProxmoxBackupSummary> {
  const [storageResult, jobsResult, archivesResult, deploymentsResult] =
    await Promise.all([
      listBackupStoragePools(),
      listScheduledBackupJobs(),
      listAllBackups(),
      getDeploymentIndex(),
    ]);

  const issues = [
    ...storageResult.issues,
    ...jobsResult.issues,
    ...archivesResult.issues,
  ];

  const backedUpVmids = new Set(archivesResult.archives.map((a) => a.vmid));
  const allVmids = deploymentsResult.deployments.map((d) => d.vmid);
  const unprotectedVmids = allVmids.filter((vmid) => !backedUpVmids.has(vmid));

  return {
    backupStoragePools: storageResult.pools,
    issues: dedupeIssues(issues),
    jobs: jobsResult.jobs,
    recentArchives: archivesResult.archives.slice(0, 50),
    unprotectedVmids,
  };
}

const SNAPSHOT_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/;

function validateSnapName(name: string): string {
  const normalized = name.trim();
  if (!SNAPSHOT_NAME_REGEX.test(normalized)) {
    throw new Error("Invalid snapshot name. Use 1-40 alphanumeric characters, hyphens, or underscores.");
  }
  return normalized;
}

type ProxmoxSnapshotResponse = {
  description?: string;
  name: string;
  parent?: string;
  snaptime?: number;
  vmstate?: number;
};

export async function listSnapshots(
  node: string,
  vmid: number,
  type: "lxc" | "qemu",
): Promise<LiveSnapshot[]> {
  const safeNode = validateNodeName(node);
  const safeVmid = validatePositiveInteger(vmid, "VMID");

  const raw = await proxmoxRequest<ProxmoxSnapshotResponse[]>(
    `/nodes/${safeNode}/${type}/${safeVmid}/snapshot`,
  );

  return (raw ?? [])
    .filter((s) => s.name !== "current")
    .map((s) => ({
      createdAt: s.snaptime ? new Date(s.snaptime * 1000).toISOString() : null,
      description: s.description?.trim() ?? "",
      hasVmState: (s.vmstate ?? 0) > 0,
      name: s.name,
      parent: s.parent ?? null,
    }))
    .sort((a, b) => {
      if (!a.createdAt || !b.createdAt) return 0;
      return b.createdAt.localeCompare(a.createdAt);
    });
}

export async function createSnapshot(
  node: string,
  vmid: number,
  type: "lxc" | "qemu",
  snapname: string,
  description?: string,
): Promise<string> {
  const safeNode = validateNodeName(node);
  const safeVmid = validatePositiveInteger(vmid, "VMID");
  const safeName = validateSnapName(snapname);

  const params = new URLSearchParams({ snapname: safeName });
  if (description?.trim()) {
    params.set("description", description.trim());
  }

  return proxmoxRequest<string>(
    `/nodes/${safeNode}/${type}/${safeVmid}/snapshot`,
    { method: "POST", params },
  );
}

export async function deleteSnapshot(
  node: string,
  vmid: number,
  type: "lxc" | "qemu",
  snapname: string,
): Promise<string> {
  const safeNode = validateNodeName(node);
  const safeVmid = validatePositiveInteger(vmid, "VMID");
  const safeName = validateSnapName(snapname);

  return proxmoxRequest<string>(
    `/nodes/${safeNode}/${type}/${safeVmid}/snapshot/${safeName}`,
    { method: "DELETE" },
  );
}

export async function rollbackSnapshot(
  node: string,
  vmid: number,
  type: "lxc" | "qemu",
  snapname: string,
): Promise<string> {
  const safeNode = validateNodeName(node);
  const safeVmid = validatePositiveInteger(vmid, "VMID");
  const safeName = validateSnapName(snapname);

  return proxmoxRequest<string>(
    `/nodes/${safeNode}/${type}/${safeVmid}/snapshot/${safeName}/rollback`,
    { method: "POST" },
  );
}

type ProxmoxAptUpdateResponse = {
  ChangeLogUrl?: string;
  Description: string;
  NewVersion: string;
  OldVersion: string;
  Origin: string;
  Package: string;
  Priority: string;
  Section: string;
  Title: string;
};

export type NodeAptUpdate = {
  currentVersion: string;
  description: string;
  newVersion: string;
  origin: string;
  packageName: string;
  priority: string;
  section: string;
  title: string;
};

export async function getNodeAptUpdates(node: string): Promise<NodeAptUpdate[]> {
  const safeNode = validateNodeName(node);
  const raw = await proxmoxRequest<ProxmoxAptUpdateResponse[]>(
    `/nodes/${safeNode}/apt/update`,
  );
  return (raw ?? []).map((item) => ({
    currentVersion: item.OldVersion ?? "",
    description: item.Description ?? "",
    newVersion: item.NewVersion ?? "",
    origin: item.Origin ?? "",
    packageName: item.Package,
    priority: item.Priority ?? "optional",
    section: item.Section ?? "",
    title: item.Title ?? item.Package,
  }));
}

export async function refreshNodeAptIndex(node: string): Promise<string> {
  const safeNode = validateNodeName(node);
  return proxmoxRequest<string>(
    `/nodes/${safeNode}/apt/update`,
    { method: "POST" },
  );
}

export type ProxmoxNetworkInterface = {
  active?: number;
  address?: string;
  autostart?: number;
  bridge_ports?: string;
  cidr?: string;
  gateway?: string;
  iface: string;
  method?: string;
  netmask?: string;
  type: string;
  [key: string]: unknown;
};

export type ProxmoxDnsConfig = {
  dns1?: string;
  dns2?: string;
  dns3?: string;
  search?: string;
};

export async function getNodeNetworkConfig(node: string): Promise<ProxmoxNetworkInterface[]> {
  const safeNode = validateNodeName(node);
  return proxmoxRequest<ProxmoxNetworkInterface[]>(`/nodes/${safeNode}/network`) ?? [];
}

export async function getNodeDnsConfig(node: string): Promise<ProxmoxDnsConfig> {
  const safeNode = validateNodeName(node);
  return proxmoxRequest<ProxmoxDnsConfig>(`/nodes/${safeNode}/dns`) ?? {};
}

export async function getNodeHostsConfig(node: string): Promise<string> {
  const safeNode = validateNodeName(node);
  const result = await proxmoxRequest<{ data: string; digest: string }>(
    `/nodes/${safeNode}/hosts`,
  );
  return result?.data ?? "";
}

export async function getNodeTimeConfig(node: string): Promise<{ timezone: string }> {
  const safeNode = validateNodeName(node);
  const result = await proxmoxRequest<{ localtime: number; time: number; timezone: string }>(
    `/nodes/${safeNode}/time`,
  );
  return { timezone: result?.timezone ?? "unknown" };
}

export async function getStorageConfig(): Promise<unknown[]> {
  return proxmoxRequest<unknown[]>("/storage") ?? [];
}

export async function getClusterFirewallRules(): Promise<unknown[]> {
  return proxmoxRequest<unknown[]>("/cluster/firewall/rules") ?? [];
}

export async function getDeploymentNetSpecs(
  id: string,
): Promise<{ node: string; specs: Record<string, string> } | null> {
  const { node, vmid, type } = decodeDeploymentId(id);
  const path =
    type === "qemu"
      ? `/nodes/${node}/qemu/${vmid}/config`
      : `/nodes/${node}/lxc/${vmid}/config`;
  const config = await safeRequest<Record<string, unknown>>(path);
  if (!config.data) return null;
  const specs: Record<string, string> = {};
  for (const [key, value] of Object.entries(config.data)) {
    if (/^net\d+$/.test(key) && typeof value === "string") {
      specs[key] = value;
    }
  }
  return { node, specs };
}

function appendParams(
  params: URLSearchParams,
  source: Record<string, unknown>,
  options: { skipKeys?: ReadonlySet<string> } = {},
) {
  const skip = options.skipKeys ?? new Set<string>();
  for (const [key, value] of Object.entries(source)) {
    if (skip.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "boolean") {
      params.set(key, value ? "1" : "0");
      continue;
    }
    if (typeof value === "number") {
      params.set(key, String(value));
      continue;
    }
    if (typeof value === "string") {
      params.set(key, value);
      continue;
    }
    if (Array.isArray(value)) {
      params.set(key, value.join(","));
      continue;
    }
    // Nested objects would be sent as "[object Object]" and corrupt the config.
  }
}

const NETWORK_IFACE_READONLY_KEYS: ReadonlySet<string> = new Set([
  "active",
  "exists",
  "families",
  "iface",
  "method6",
  "priority",
]);

const STORAGE_READONLY_KEYS: ReadonlySet<string> = new Set([
  "digest",
  "storage",
  "type", // Proxmox rejects type on storage PUT.
]);

export async function updateNodeDnsConfig(
  node: string,
  config: ProxmoxDnsConfig,
): Promise<unknown> {
  const safeNode = validateNodeName(node);
  const params = new URLSearchParams();
  appendParams(params, config as Record<string, unknown>);
  return proxmoxRequest<unknown>(`/nodes/${safeNode}/dns`, {
    method: "PUT",
    params,
  });
}

export async function updateNodeHostsConfig(
  node: string,
  data: string,
  digest?: string,
): Promise<unknown> {
  const safeNode = validateNodeName(node);
  const params = new URLSearchParams();
  params.set("data", data);
  if (digest) params.set("digest", digest);
  return proxmoxRequest<unknown>(`/nodes/${safeNode}/hosts`, {
    method: "POST",
    params,
  });
}

export async function updateNodeTimeConfig(
  node: string,
  timezone: string,
): Promise<unknown> {
  const safeNode = validateNodeName(node);
  const params = new URLSearchParams();
  params.set("timezone", timezone);
  return proxmoxRequest<unknown>(`/nodes/${safeNode}/time`, {
    method: "PUT",
    params,
  });
}

/** Changes stay pending until reloadNodeNetwork() applies them. */
export async function updateNodeNetworkInterface(
  node: string,
  iface: string,
  config: Record<string, unknown>,
): Promise<unknown> {
  const safeNode = validateNodeName(node);
  const safeIface = iface.trim();
  if (!/^[a-zA-Z0-9_.:-]{1,40}$/.test(safeIface)) {
    throw new Error("Invalid network interface name.");
  }
  const params = new URLSearchParams();
  appendParams(params, config, { skipKeys: NETWORK_IFACE_READONLY_KEYS });
  // The network PUT requires type even though it cannot change it.
  if (typeof config.type === "string" && config.type) {
    params.set("type", config.type);
  }
  return proxmoxRequest<unknown>(`/nodes/${safeNode}/network/${safeIface}`, {
    method: "PUT",
    params,
  });
}

export async function createNodeNetworkInterface(
  node: string,
  config: Record<string, unknown>,
): Promise<unknown> {
  const safeNode = validateNodeName(node);
  const iface = typeof config.iface === "string" ? config.iface.trim() : "";
  const type = typeof config.type === "string" ? config.type : "";
  if (!iface || !type) {
    throw new Error("Network interface requires iface + type.");
  }
  const params = new URLSearchParams();
  appendParams(params, config, { skipKeys: NETWORK_IFACE_READONLY_KEYS });
  params.set("iface", iface);
  params.set("type", type);
  return proxmoxRequest<unknown>(`/nodes/${safeNode}/network`, {
    method: "POST",
    params,
  });
}

export async function reloadNodeNetwork(node: string): Promise<string | null> {
  const safeNode = validateNodeName(node);
  return proxmoxRequest<string | null>(`/nodes/${safeNode}/network`, {
    method: "PUT",
  });
}

export async function revertNodeNetworkChanges(node: string): Promise<unknown> {
  const safeNode = validateNodeName(node);
  return proxmoxRequest<unknown>(`/nodes/${safeNode}/network`, {
    method: "DELETE",
  });
}

export async function createStorageConfig(
  config: Record<string, unknown>,
): Promise<unknown> {
  const storage = typeof config.storage === "string" ? config.storage : "";
  const type = typeof config.type === "string" ? config.type : "";
  if (!storage || !type) {
    throw new Error("Storage config requires storage + type.");
  }
  const safeStorage = validateStorageName(storage);
  const params = new URLSearchParams();
  appendParams(params, config, { skipKeys: STORAGE_READONLY_KEYS });
  params.set("storage", safeStorage);
  params.set("type", type);
  return proxmoxRequest<unknown>(`/storage`, {
    method: "POST",
    params,
  });
}

export async function updateStorageConfig(
  storage: string,
  config: Record<string, unknown>,
): Promise<unknown> {
  const safeStorage = validateStorageName(storage);
  const params = new URLSearchParams();
  appendParams(params, config, { skipKeys: STORAGE_READONLY_KEYS });
  return proxmoxRequest<unknown>(`/storage/${safeStorage}`, {
    method: "PUT",
    params,
  });
}

export async function deleteStorageConfig(storage: string): Promise<unknown> {
  const safeStorage = validateStorageName(storage);
  return proxmoxRequest<unknown>(`/storage/${safeStorage}`, {
    method: "DELETE",
  });
}

const FIREWALL_RULE_NON_PARAM_KEYS: ReadonlySet<string> = new Set([
  "digest",
  "ipversion",
  "pos",
]);

export async function createClusterFirewallRule(
  rule: Record<string, unknown>,
): Promise<unknown> {
  const params = new URLSearchParams();
  appendParams(params, rule, { skipKeys: FIREWALL_RULE_NON_PARAM_KEYS });
  return proxmoxRequest<unknown>(`/cluster/firewall/rules`, {
    method: "POST",
    params,
  });
}

export async function deleteClusterFirewallRule(pos: number): Promise<unknown> {
  if (!Number.isInteger(pos) || pos < 0) {
    throw new Error("Invalid firewall rule position.");
  }
  return proxmoxRequest<unknown>(`/cluster/firewall/rules/${pos}`, {
    method: "DELETE",
  });
}

export async function getClusterStatusFingerprint(): Promise<string> {
  const { nodes } = await getLiveNodeIndex();
  const parts: string[] = nodes
    .map((node) => `node/${node.name}:${node.status}`)
    .sort();

  const lists = await Promise.all(
    nodes.map(async (node) => {
      const [lxc, qemu] = await Promise.all([
        safeRequest<ProxmoxLxcListResponse[]>(`/nodes/${node.name}/lxc`),
        safeRequest<ProxmoxQemuListResponse[]>(`/nodes/${node.name}/qemu`),
      ]);
      const entries: string[] = [];
      for (const ct of lxc.data ?? []) {
        entries.push(`ct/${node.name}/${ct.vmid}:${ct.status ?? "?"}`);
      }
      for (const vm of qemu.data ?? []) {
        entries.push(`vm/${node.name}/${vm.vmid}:${vm.status ?? "?"}`);
      }
      return entries;
    }),
  );
  parts.push(...lists.flat().sort());
  return parts.join("|");
}

export type GuestFirewallRule = {
  pos: number;
  type: string | null;
  action: string | null;
  proto: string | null;
  dport: string | null;
  sport: string | null;
  source: string | null;
  dest: string | null;
  enable: number | null;
  comment: string | null;
};

export type GuestFirewallOptions = {
  enable: boolean;
  policyIn: string;
  policyOut: string;
  dhcp: boolean;
};

function guestFirewallBase(node: string, vmid: number, type: "lxc" | "qemu") {
  const safeNode = validateNodeName(node);
  const safeVmid = validatePositiveInteger(vmid, "VMID");
  return `/nodes/${safeNode}/${type === "qemu" ? "qemu" : "lxc"}/${safeVmid}/firewall`;
}

export async function listGuestFirewallRules(
  node: string,
  vmid: number,
  type: "lxc" | "qemu",
): Promise<GuestFirewallRule[]> {
  const raw =
    (await proxmoxRequest<Array<Record<string, unknown>>>(
      `${guestFirewallBase(node, vmid, type)}/rules`,
    )) ?? [];
  return raw.map((r, i) => ({
    pos: typeof r.pos === "number" ? r.pos : i,
    type: typeof r.type === "string" ? r.type : null,
    action: typeof r.action === "string" ? r.action : null,
    proto: typeof r.proto === "string" ? r.proto : null,
    dport: r.dport != null ? String(r.dport) : null,
    sport: r.sport != null ? String(r.sport) : null,
    source: typeof r.source === "string" ? r.source : null,
    dest: typeof r.dest === "string" ? r.dest : null,
    enable: typeof r.enable === "number" ? r.enable : null,
    comment: typeof r.comment === "string" ? r.comment : null,
  }));
}

export async function getGuestFirewallOptions(
  node: string,
  vmid: number,
  type: "lxc" | "qemu",
): Promise<GuestFirewallOptions> {
  const raw =
    (await proxmoxRequest<Record<string, unknown>>(
      `${guestFirewallBase(node, vmid, type)}/options`,
    )) ?? {};
  return {
    enable: raw.enable === 1,
    policyIn: typeof raw.policy_in === "string" ? raw.policy_in : "DROP",
    policyOut: typeof raw.policy_out === "string" ? raw.policy_out : "ACCEPT",
    dhcp: raw.dhcp === 1,
  };
}

export async function setGuestFirewallEnabled(
  node: string,
  vmid: number,
  type: "lxc" | "qemu",
  enable: boolean,
): Promise<unknown> {
  const params = new URLSearchParams();
  params.set("enable", enable ? "1" : "0");
  return proxmoxRequest<unknown>(`${guestFirewallBase(node, vmid, type)}/options`, {
    method: "PUT",
    params,
  });
}

export async function createGuestFirewallRule(
  node: string,
  vmid: number,
  type: "lxc" | "qemu",
  rule: Record<string, unknown>,
): Promise<unknown> {
  const params = new URLSearchParams();
  appendParams(params, rule, { skipKeys: FIREWALL_RULE_NON_PARAM_KEYS });
  return proxmoxRequest<unknown>(`${guestFirewallBase(node, vmid, type)}/rules`, {
    method: "POST",
    params,
  });
}

export async function deleteGuestFirewallRule(
  node: string,
  vmid: number,
  type: "lxc" | "qemu",
  pos: number,
): Promise<unknown> {
  if (!Number.isInteger(pos) || pos < 0) {
    throw new Error("Invalid firewall rule position.");
  }
  return proxmoxRequest<unknown>(`${guestFirewallBase(node, vmid, type)}/rules/${pos}`, {
    method: "DELETE",
  });
}

export type GuestPenaltyData = {
  vmid: number;
  node: string;
  type: "lxc" | "qemu";
  failcnt?: number;
  cpuSteal?: number;
  /** QEMU balloon usage; host-reported mem counts the whole ballooned allocation. */
  guestMemUsedBytes?: number;
};

export async function fetchGuestPenaltyData(
  guests: { vmid: number; node: string; type: "lxc" | "qemu" }[],
): Promise<GuestPenaltyData[]> {
  const results = await Promise.all(
    guests.map(async (g) => {
      try {
        const endpoint =
          g.type === "lxc"
            ? `/nodes/${g.node}/lxc/${g.vmid}/status/current`
            : `/nodes/${g.node}/qemu/${g.vmid}/status/current`;

        const result = await safeRequest<Record<string, unknown>>(endpoint);
        if (!result.data) return null;

        const data = result.data;

        let guestMemUsedBytes: number | undefined;
        if (g.type === "qemu" && data.ballooninfo && typeof data.ballooninfo === "object") {
          const balloon = data.ballooninfo as Record<string, unknown>;
          const totalMem = typeof balloon.total_mem === "number" ? balloon.total_mem : null;
          const freeMem = typeof balloon.free_mem === "number" ? balloon.free_mem : null;
          if (totalMem !== null && freeMem !== null && totalMem > 0 && freeMem <= totalMem) {
            guestMemUsedBytes = totalMem - freeMem;
          }
        }

        const entry: GuestPenaltyData = {
          vmid: g.vmid,
          node: g.node,
          type: g.type,
          failcnt: typeof data.failcnt === "number" ? data.failcnt : undefined,
          cpuSteal: typeof data.steal === "number" ? data.steal : undefined,
          guestMemUsedBytes,
        };
        return entry;
      } catch {
        return null;
      }
    }),
  );

  return results.filter((r): r is GuestPenaltyData => r !== null);
}

function parsePsiAvg10(window: ProxmoxPsiWindow | undefined): number | null {
  if (!window) return null;
  const raw = window.avg10;
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function parseNodePressure(
  pressure: ProxmoxNodeStatusResponse["pressure"],
): NodePressure | null {
  if (!pressure) return null;
  const parsed: NodePressure = {
    cpuSomeAvg10: parsePsiAvg10(pressure.cpu?.some),
    memorySomeAvg10: parsePsiAvg10(pressure.memory?.some),
    memoryFullAvg10: parsePsiAvg10(pressure.memory?.full),
    ioSomeAvg10: parsePsiAvg10(pressure.io?.some),
    ioFullAvg10: parsePsiAvg10(pressure.io?.full),
  };
  const hasAny = Object.values(parsed).some((v) => v !== null);
  return hasAny ? parsed : null;
}

export type NodeMetricsWithLatency = LiveNodeMetrics & {
  latencyMs: number;
};

export async function getNodesWithPerNodeLatency(): Promise<{
  nodes: LiveNode[];
  metrics: NodeMetricsWithLatency[];
}> {
  const nodesResult = await listNodesInternal();
  const nodes = mapLiveNodes(nodesResult.data);

  const results = await Promise.all(
    nodes.map(async (node) => {
      const start = performance.now();
      const result = await safeRequest<ProxmoxNodeStatusResponse>(
        `/nodes/${node.name}/status`,
      );
      const latencyMs = performance.now() - start;
      return { node, result, latencyMs };
    }),
  );

  const metrics: NodeMetricsWithLatency[] = [];
  for (const { node, result, latencyMs } of results) {
    if (result.issue || !result.data) continue;

    const status = result.data;
    metrics.push({
      cpuRatio: normalizeMaybeNumber(status.cpu),
      loadAverage: parseLoadAverage(status.loadavg),
      memoryTotalBytes: normalizeMaybeNumber(status.memory?.total),
      memoryUsedBytes: normalizeMaybeNumber(status.memory?.used),
      node: node.name,
      pressure: parseNodePressure(status.pressure),
      rootfsTotalBytes: normalizeMaybeNumber(status.rootfs?.total),
      rootfsUsedBytes: normalizeMaybeNumber(status.rootfs?.used),
      swapTotalBytes: normalizeMaybeNumber(status.swap?.total),
      swapUsedBytes: normalizeMaybeNumber(status.swap?.used),
      uptimeSeconds: normalizeMaybeNumber(status.uptime),
      latencyMs,
    });
  }

  return { nodes, metrics };
}

