import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";
import {
  createClusterFirewallRule,
  createNodeNetworkInterface,
  createStorageConfig,
  deleteClusterFirewallRule,
  deleteStorageConfig,
  getClusterFirewallRules,
  getNodeDnsConfig,
  getNodeHostsConfig,
  getNodeNetworkConfig,
  getNodeTimeConfig,
  getStorageConfig,
  reloadNodeNetwork,
  updateNodeDnsConfig,
  updateNodeHostsConfig,
  updateNodeNetworkInterface,
  updateNodeTimeConfig,
  updateStorageConfig,
} from "@/lib/proxmox";
import type { ProxmoxDnsConfig, ProxmoxNetworkInterface } from "@/lib/proxmox";

export type NodeConfigSnapshotTrigger = "manual" | "scheduled";

export type NodeConfigSnapshot = {
  configs: {
    dns: unknown;
    firewallRules: unknown[];
    hosts: string;
    network: unknown[];
    storage: unknown[];
    timezone: string;
  };
  createdAt: string;
  createdBy: string;
  id: string;
  label: string;
  nodeName: string;
  /** Set when the snapshot was created by a scheduled policy. */
  policyId?: string | null;
  /** Defaults to "manual" for legacy / pre-existing snapshots. */
  trigger?: NodeConfigSnapshotTrigger;
};

export type ConfigDiff = {
  after: string;
  before: string;
  changed: boolean;
  section: string;
};

const MAX_SNAPSHOTS = 100;

type ConfigSnapshotStore = {
  snapshots: NodeConfigSnapshot[];
};

async function readStore(): Promise<ConfigSnapshotStore> {
  try {
    const raw = await readFile(
      await resolveSiteDataFilePathFromContext("node-config-snapshots.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<ConfigSnapshotStore>;

    return {
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
    };
  } catch {
    return { snapshots: [] };
  }
}

async function writeStore(store: ConfigSnapshotStore) {
  const filePath = await resolveSiteDataFilePathFromContext("node-config-snapshots.json");
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("node-config-snapshots", readStore, writeStore);

export async function listConfigSnapshots(): Promise<NodeConfigSnapshot[]> {
  const store = await readStore();
  return [...store.snapshots].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export async function getConfigSnapshot(id: string): Promise<NodeConfigSnapshot | null> {
  const store = await readStore();
  return store.snapshots.find((s) => s.id === id) ?? null;
}

export async function deleteConfigSnapshot(id: string): Promise<boolean> {
  return mutateStore((store) => {
    const index = store.snapshots.findIndex((s) => s.id === id);
    if (index === -1) return false;
    store.snapshots.splice(index, 1);
    return true;
  });
}

export async function takeConfigSnapshot(
  nodeName: string,
  createdBy: string,
  label: string,
  options: {
    policyId?: string | null;
    /** Per-policy retention: keep at most this many snapshots from the same policy (0 = unlimited). */
    policyRetention?: number;
    trigger?: NodeConfigSnapshotTrigger;
  } = {},
): Promise<NodeConfigSnapshot> {
  const [networkResult, dnsResult, hostsResult, timeResult, storageResult, firewallResult] =
    await Promise.allSettled([
      getNodeNetworkConfig(nodeName),
      getNodeDnsConfig(nodeName),
      getNodeHostsConfig(nodeName),
      getNodeTimeConfig(nodeName),
      getStorageConfig(),
      getClusterFirewallRules(),
    ]);

  const snapshot: NodeConfigSnapshot = {
    configs: {
      dns: dnsResult.status === "fulfilled" ? dnsResult.value : null,
      firewallRules: firewallResult.status === "fulfilled" ? firewallResult.value : [],
      hosts: hostsResult.status === "fulfilled" ? hostsResult.value : "",
      network: networkResult.status === "fulfilled" ? networkResult.value : [],
      storage: storageResult.status === "fulfilled" ? storageResult.value : [],
      timezone: timeResult.status === "fulfilled" ? timeResult.value.timezone : "unknown",
    },
    createdAt: new Date().toISOString(),
    createdBy,
    id: randomUUID(),
    label: label.trim() || `${nodeName} — ${new Date().toLocaleDateString()}`,
    nodeName,
    policyId: options.policyId ?? null,
    trigger: options.trigger ?? "manual",
  };

  return mutateStore((store) => {
    store.snapshots.unshift(snapshot);

    // Per-policy retention: drop the oldest snapshots from the SAME policy that
    // exceed the policy's retention count. Manual snapshots are unaffected.
    if (snapshot.policyId && options.policyRetention && options.policyRetention > 0) {
      const sameFromPolicy = store.snapshots
        .filter((s) => s.policyId === snapshot.policyId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const stale = sameFromPolicy.slice(options.policyRetention);
      if (stale.length > 0) {
        const staleIds = new Set(stale.map((s) => s.id));
        store.snapshots = store.snapshots.filter((s) => !staleIds.has(s.id));
      }
    }

    // Global cap (keeps the file from growing unbounded).
    if (store.snapshots.length > MAX_SNAPSHOTS) {
      store.snapshots = store.snapshots.slice(0, MAX_SNAPSHOTS);
    }

    return snapshot;
  });
}

/**
 * Identity keys we'll try in priority order when canonicalising arrays of
 * objects. Proxmox returns interface lists, storage lists, firewall rule lists
 * etc. in different orders on different reads — sorting by a stable identity
 * field makes semantically-equal arrays stringify identically.
 *
 * `pos` first because firewall rules use it and it's numeric (cheap), then
 * the named identifiers we know appear in the snapshot sections.
 */
const ARRAY_IDENTITY_KEYS = ["pos", "iface", "storage", "id", "name"] as const;

/**
 * Proxmox stores set-valued config fields as comma-separated strings ("vztmpl,
 * backup,iso") but treats them as unordered. Different reads can return the
 * same set with the elements in different orders, so we canonicalise these
 * specific fields by splitting, sorting, and rejoining.
 */
const COMMA_SET_FIELDS = new Set([
  "content",
  "nodes",
  "tags",
]);

function canonicaliseCsvSet(raw: string): string {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort()
    .join(",");
}

function findArrayIdentityKey(arr: unknown[]): string | null {
  if (arr.length === 0) return null;
  if (!arr.every((e) => e !== null && typeof e === "object" && !Array.isArray(e))) {
    return null;
  }
  for (const key of ARRAY_IDENTITY_KEYS) {
    if (arr.every((e) => key in (e as Record<string, unknown>))) {
      return key;
    }
  }
  return null;
}

/**
 * Recursively canonicalise: sort object keys, and sort arrays of objects by
 * a stable identity field (`pos`, `iface`, `storage`, `id`, `name`) when one
 * exists across every element. Arrays without a recognised identity key keep
 * their order — meaningful for ordered scalars or heterogeneous lists.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(sortKeysDeep);
    const idKey = findArrayIdentityKey(value);
    if (idKey) {
      return [...items].sort((a, b) => {
        const av = (a as Record<string, unknown>)[idKey];
        const bv = (b as Record<string, unknown>)[idKey];
        if (typeof av === "number" && typeof bv === "number") return av - bv;
        return String(av).localeCompare(String(bv));
      });
    }
    return items;
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const raw = source[key];
      if (
        COMMA_SET_FIELDS.has(key) &&
        typeof raw === "string" &&
        raw.includes(",")
      ) {
        sorted[key] = canonicaliseCsvSet(raw);
      } else {
        sorted[key] = sortKeysDeep(raw);
      }
    }
    return sorted;
  }
  return value;
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(sortKeysDeep(value), null, 2);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Scheduled-snapshot tick
// ---------------------------------------------------------------------------

import {
  listConfigSnapshotPolicies,
  markConfigSnapshotPolicyRun,
} from "@/lib/config-snapshot-policies";
import { runDuePolicies } from "@/lib/scheduler-utils";

export type ConfigSnapshotTickResult = {
  errors: string[];
  policiesEvaluated: number;
  snapshotsTaken: number;
};

/**
 * Iterate the active site's config-snapshot policies and capture a snapshot
 * for each one whose `nextRunAt` is due. Caller is responsible for setting
 * up site context (use `runConfigSnapshotTickAllSites()` for cluster-wide).
 */
export async function runConfigSnapshotTick(): Promise<ConfigSnapshotTickResult> {
  let policies;
  try {
    policies = await listConfigSnapshotPolicies();
  } catch (error) {
    return {
      errors: [
        `Failed to load config snapshot policies: ${error instanceof Error ? error.message : String(error)}`,
      ],
      policiesEvaluated: 0,
      snapshotsTaken: 0,
    };
  }

  const result = await runDuePolicies({
    isReady: (p) => Boolean(p.nodeName),
    markRun: markConfigSnapshotPolicyRun,
    policies,
    policyLabel: (p) => `Policy "${p.name}"`,
    runOne: async (policy) => {
      const label = `${policy.name} — ${new Date().toLocaleString()}`;
      await takeConfigSnapshot(policy.nodeName, `schedule:${policy.name}`, label, {
        policyId: policy.id,
        policyRetention: policy.retentionCount,
        trigger: "scheduled",
      });
    },
  });

  return {
    errors: result.errors,
    policiesEvaluated: result.policiesEvaluated,
    snapshotsTaken: result.ranCount,
  };
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export type RestoreSection =
  | "dns"
  | "firewallRules"
  | "hosts"
  | "network"
  | "storage"
  | "timezone";

export type RestoreSelection = Record<RestoreSection, boolean>;

export type RestoreOptions = {
  /**
   * If true, also remove storages / firewall rules that exist now but were
   * NOT in the snapshot. Without this, restore is purely additive — safer
   * default since deleting cluster-wide config has wide blast radius.
   */
  destructive?: boolean;
  /**
   * If true and the network section is restored, call `ifreload -a` on the
   * node afterwards to apply pending changes. Defaults to true.
   */
  reloadNetwork?: boolean;
};

export type RestoreSectionResult = {
  details: string[];
  errors: string[];
  section: RestoreSection;
  status: "ok" | "partial" | "failed" | "skipped";
};

export type RestoreResult = {
  networkReloadTriggered: boolean;
  sections: RestoreSectionResult[];
  snapshotId: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function restoreDns(snapshot: NodeConfigSnapshot): Promise<RestoreSectionResult> {
  const dns = asRecord(snapshot.configs.dns);
  if (!dns) {
    return {
      details: [],
      errors: ["Snapshot does not contain a DNS configuration."],
      section: "dns",
      status: "failed",
    };
  }

  try {
    await updateNodeDnsConfig(snapshot.nodeName, dns as ProxmoxDnsConfig);
    return {
      details: [`DNS settings applied to node ${snapshot.nodeName}.`],
      errors: [],
      section: "dns",
      status: "ok",
    };
  } catch (error) {
    return {
      details: [],
      errors: [error instanceof Error ? error.message : String(error)],
      section: "dns",
      status: "failed",
    };
  }
}

async function restoreHosts(snapshot: NodeConfigSnapshot): Promise<RestoreSectionResult> {
  if (typeof snapshot.configs.hosts !== "string") {
    return {
      details: [],
      errors: ["Snapshot does not contain a hosts file."],
      section: "hosts",
      status: "failed",
    };
  }

  try {
    await updateNodeHostsConfig(snapshot.nodeName, snapshot.configs.hosts);
    return {
      details: [`/etc/hosts written on node ${snapshot.nodeName}.`],
      errors: [],
      section: "hosts",
      status: "ok",
    };
  } catch (error) {
    return {
      details: [],
      errors: [error instanceof Error ? error.message : String(error)],
      section: "hosts",
      status: "failed",
    };
  }
}

async function restoreTimezone(snapshot: NodeConfigSnapshot): Promise<RestoreSectionResult> {
  const tz = snapshot.configs.timezone;
  if (typeof tz !== "string" || !tz || tz === "unknown") {
    return {
      details: [],
      errors: ["Snapshot does not contain a valid timezone."],
      section: "timezone",
      status: "failed",
    };
  }

  try {
    await updateNodeTimeConfig(snapshot.nodeName, tz);
    return {
      details: [`Timezone set to ${tz} on node ${snapshot.nodeName}.`],
      errors: [],
      section: "timezone",
      status: "ok",
    };
  } catch (error) {
    return {
      details: [],
      errors: [error instanceof Error ? error.message : String(error)],
      section: "timezone",
      status: "failed",
    };
  }
}

async function restoreNetwork(
  snapshot: NodeConfigSnapshot,
  options: RestoreOptions,
): Promise<{ result: RestoreSectionResult; reloaded: boolean }> {
  const interfaces = Array.isArray(snapshot.configs.network)
    ? (snapshot.configs.network as ProxmoxNetworkInterface[])
    : [];
  if (interfaces.length === 0) {
    return {
      result: {
        details: [],
        errors: ["Snapshot does not contain network interface data."],
        section: "network",
        status: "failed",
      },
      reloaded: false,
    };
  }

  let currentIfaces: ProxmoxNetworkInterface[] = [];
  try {
    currentIfaces = await getNodeNetworkConfig(snapshot.nodeName);
  } catch {
    // Continue — we'll attempt PUT and fall back to POST on per-iface error.
  }
  const currentByName = new Map(currentIfaces.map((i) => [i.iface, i] as const));

  const details: string[] = [];
  const errors: string[] = [];

  for (const iface of interfaces) {
    if (!iface || typeof iface.iface !== "string") continue;
    const exists = currentByName.has(iface.iface);
    try {
      if (exists) {
        await updateNodeNetworkInterface(snapshot.nodeName, iface.iface, iface);
        details.push(`Updated ${iface.iface}.`);
      } else {
        await createNodeNetworkInterface(snapshot.nodeName, iface);
        details.push(`Created ${iface.iface}.`);
      }
    } catch (error) {
      errors.push(
        `${iface.iface}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  let reloaded = false;
  const reloadRequested = options.reloadNetwork !== false;
  if (reloadRequested && errors.length === 0) {
    try {
      await reloadNodeNetwork(snapshot.nodeName);
      reloaded = true;
      details.push("Network reload (ifreload -a) triggered.");
    } catch (error) {
      errors.push(
        `Network reload failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (reloadRequested) {
    details.push("Skipped network reload because some interface updates failed.");
  }

  let status: RestoreSectionResult["status"];
  if (errors.length === 0) status = "ok";
  else if (details.length > 0) status = "partial";
  else status = "failed";

  return {
    result: { details, errors, section: "network", status },
    reloaded,
  };
}

async function restoreStorage(
  snapshot: NodeConfigSnapshot,
  options: RestoreOptions,
): Promise<RestoreSectionResult> {
  const snapStorages = Array.isArray(snapshot.configs.storage)
    ? snapshot.configs.storage.map(asRecord).filter((s): s is Record<string, unknown> => Boolean(s))
    : [];
  if (snapStorages.length === 0) {
    return {
      details: [],
      errors: ["Snapshot does not contain storage configuration."],
      section: "storage",
      status: "failed",
    };
  }

  let currentStorages: Record<string, unknown>[] = [];
  try {
    const raw = await getStorageConfig();
    currentStorages = raw
      .map(asRecord)
      .filter((s): s is Record<string, unknown> => Boolean(s));
  } catch {
    // best-effort; we'll still attempt creates and updates
  }
  const currentByName = new Map(
    currentStorages
      .filter((s) => typeof s.storage === "string")
      .map((s) => [String(s.storage), s] as const),
  );

  const details: string[] = [];
  const errors: string[] = [];

  // Add or update storages from the snapshot
  for (const snap of snapStorages) {
    const name = typeof snap.storage === "string" ? snap.storage : "";
    if (!name) continue;
    try {
      if (currentByName.has(name)) {
        await updateStorageConfig(name, snap);
        details.push(`Updated storage ${name}.`);
      } else {
        await createStorageConfig(snap);
        details.push(`Created storage ${name}.`);
      }
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Optionally remove storages that exist now but weren't in the snapshot
  if (options.destructive) {
    const snapNames = new Set(
      snapStorages
        .filter((s) => typeof s.storage === "string")
        .map((s) => String(s.storage)),
    );
    for (const [name] of currentByName) {
      if (snapNames.has(name)) continue;
      try {
        await deleteStorageConfig(name);
        details.push(`Removed storage ${name}.`);
      } catch (error) {
        errors.push(
          `Failed to remove ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  let status: RestoreSectionResult["status"];
  if (errors.length === 0) status = "ok";
  else if (details.length > 0) status = "partial";
  else status = "failed";

  return { details, errors, section: "storage", status };
}

async function restoreFirewall(
  snapshot: NodeConfigSnapshot,
  options: RestoreOptions,
): Promise<RestoreSectionResult> {
  const snapRules = Array.isArray(snapshot.configs.firewallRules)
    ? snapshot.configs.firewallRules
        .map(asRecord)
        .filter((r): r is Record<string, unknown> => Boolean(r))
    : [];
  if (snapRules.length === 0) {
    return {
      details: [],
      errors: ["Snapshot does not contain firewall rules."],
      section: "firewallRules",
      status: "failed",
    };
  }

  const details: string[] = [];
  const errors: string[] = [];

  if (options.destructive) {
    // Wipe all current rules in reverse order so positions don't shift
    let currentRules: Record<string, unknown>[] = [];
    try {
      const raw = await getClusterFirewallRules();
      currentRules = raw
        .map(asRecord)
        .filter((r): r is Record<string, unknown> => Boolean(r));
    } catch (error) {
      errors.push(
        `Could not read current rules: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const positions = currentRules
      .map((r) => (typeof r.pos === "number" ? r.pos : Number(r.pos)))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a);
    for (const pos of positions) {
      try {
        await deleteClusterFirewallRule(pos);
      } catch (error) {
        errors.push(
          `Failed to delete rule at pos ${pos}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (positions.length > 0) {
      details.push(`Cleared ${positions.length} existing rule(s).`);
    }
  }

  // Create rules in snapshot order; Proxmox prepends new rules at pos 0, so
  // iterate in reverse to preserve original ordering.
  const ordered = [...snapRules].sort((a, b) => {
    const ap = typeof a.pos === "number" ? a.pos : Number(a.pos ?? 0);
    const bp = typeof b.pos === "number" ? b.pos : Number(b.pos ?? 0);
    return bp - ap;
  });
  let added = 0;
  for (const rule of ordered) {
    try {
      await createClusterFirewallRule(rule);
      added++;
    } catch (error) {
      errors.push(
        `Failed to add rule: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (added > 0) {
    details.push(`Added ${added} rule(s) from snapshot.`);
  }

  let status: RestoreSectionResult["status"];
  if (errors.length === 0) status = "ok";
  else if (details.length > 0) status = "partial";
  else status = "failed";

  return { details, errors, section: "firewallRules", status };
}

export async function restoreConfigSnapshot(
  snapshotId: string,
  selection: RestoreSelection,
  options: RestoreOptions = {},
): Promise<RestoreResult> {
  const snapshot = await getConfigSnapshot(snapshotId);
  if (!snapshot) {
    throw new Error("Snapshot not found.");
  }

  const sections: RestoreSectionResult[] = [];
  let networkReloadTriggered = false;

  if (selection.dns) sections.push(await restoreDns(snapshot));
  if (selection.hosts) sections.push(await restoreHosts(snapshot));
  if (selection.timezone) sections.push(await restoreTimezone(snapshot));
  if (selection.network) {
    const { result, reloaded } = await restoreNetwork(snapshot, options);
    sections.push(result);
    networkReloadTriggered = reloaded;
  }
  if (selection.storage) sections.push(await restoreStorage(snapshot, options));
  if (selection.firewallRules) sections.push(await restoreFirewall(snapshot, options));

  // Sections explicitly not selected are reported as "skipped" so the UI can
  // render a complete picture of what was attempted vs ignored.
  const ALL_SECTIONS: RestoreSection[] = [
    "dns",
    "hosts",
    "timezone",
    "network",
    "storage",
    "firewallRules",
  ];
  const presentSections = new Set(sections.map((s) => s.section));
  for (const section of ALL_SECTIONS) {
    if (!presentSections.has(section) && !selection[section]) {
      sections.push({
        details: [],
        errors: [],
        section,
        status: "skipped",
      });
    }
  }

  return {
    networkReloadTriggered,
    sections,
    snapshotId,
  };
}

export function compareConfigSnapshots(
  a: NodeConfigSnapshot,
  b: NodeConfigSnapshot,
): ConfigDiff[] {
  const sections: Array<{ key: keyof NodeConfigSnapshot["configs"]; label: string }> = [
    { key: "network", label: "Network" },
    { key: "dns", label: "DNS" },
    { key: "hosts", label: "Hosts" },
    { key: "timezone", label: "Timezone" },
    { key: "storage", label: "Storage" },
    { key: "firewallRules", label: "Firewall Rules" },
  ];

  return sections.map(({ key, label }) => {
    const before = key === "hosts" || key === "timezone"
      ? String(a.configs[key])
      : prettyJson(a.configs[key]);
    const after = key === "hosts" || key === "timezone"
      ? String(b.configs[key])
      : prettyJson(b.configs[key]);

    return {
      after,
      before,
      changed: before !== after,
      section: label,
    };
  });
}
