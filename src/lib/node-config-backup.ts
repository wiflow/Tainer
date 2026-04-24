import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";
import {
  getClusterFirewallRules,
  getNodeDnsConfig,
  getNodeHostsConfig,
  getNodeNetworkConfig,
  getNodeTimeConfig,
  getStorageConfig,
} from "@/lib/proxmox";

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
  };

  return mutateStore((store) => {
    store.snapshots.unshift(snapshot);

    if (store.snapshots.length > MAX_SNAPSHOTS) {
      store.snapshots = store.snapshots.slice(0, MAX_SNAPSHOTS);
    }

    return snapshot;
  });
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
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
