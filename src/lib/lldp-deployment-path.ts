import "server-only";

import type { LldpNeighbor, LldpSiteSnapshots } from "@/lib/lldp-types";
import {
  getNodeNetworkConfig,
  type ProxmoxNetworkInterface,
} from "@/lib/proxmox";

export type DeploymentNetworkHop = {
  uplinkInterface: string;
  remote: {
    chassisId: string;
    systemName: string | null;
    portId: string;
    portDescription: string | null;
    vlanId: number | null;
  } | null;
};

export type DeploymentNetworkPathEntry = {
  netKey: string;
  bridge: string | null;
  vlanTag: number | null;
  uplinks: DeploymentNetworkHop[];
};

export type DeploymentNetworkPath = {
  agentHost: string | null;
  entries: DeploymentNetworkPathEntry[];
  freshestSnapshotAt: string | null;
};

export function parseNetSpec(spec: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      out[trimmed] = "true";
    } else {
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  }
  return out;
}

function findBridgeUplinks(
  interfaces: ProxmoxNetworkInterface[],
  bridgeName: string,
): string[] {
  const bridge = interfaces.find(
    (iface) => iface.iface === bridgeName && iface.type?.includes("bridge"),
  );
  if (!bridge?.bridge_ports) return [];
  const raw = bridge.bridge_ports.trim();
  if (!raw || raw === "none") return [];
  return raw.split(/\s+/).filter(Boolean);
}

function pickAgentHost(node: string, snapshots: LldpSiteSnapshots): string | null {
  if (snapshots.hosts[node]) return node;
  const shortNode = node.split(".")[0];
  if (snapshots.hosts[shortNode]) return shortNode;
  for (const agentHost of Object.keys(snapshots.hosts)) {
    if (agentHost.split(".")[0] === shortNode) return agentHost;
  }
  return null;
}

function findNeighbor(
  neighbors: LldpNeighbor[],
  uplink: string,
): LldpNeighbor | null {
  return neighbors.find((n) => n.localInterface === uplink) ?? null;
}

export async function resolveDeploymentNetworkPath(input: {
  node: string;
  netConfig: Record<string, string | undefined>;
  snapshots: LldpSiteSnapshots;
}): Promise<DeploymentNetworkPath | null> {
  const netKeys = Object.keys(input.netConfig)
    .filter((k) => /^net\d+$/.test(k))
    .sort();
  if (netKeys.length === 0) return null;

  const interfaces = await getNodeNetworkConfig(input.node).catch(() => []);
  const agentHost = pickAgentHost(input.node, input.snapshots);
  const snapshot = agentHost ? input.snapshots.hosts[agentHost] : null;
  const neighbors = snapshot?.neighbors ?? [];

  const entries: DeploymentNetworkPathEntry[] = [];
  for (const netKey of netKeys) {
    const rawSpec = input.netConfig[netKey];
    if (!rawSpec) continue;
    const parsed = parseNetSpec(rawSpec);
    const bridge = parsed.bridge ?? null;
    const vlanTagRaw = parsed.tag;
    const vlanTag = vlanTagRaw && /^\d+$/.test(vlanTagRaw) ? Number(vlanTagRaw) : null;

    const uplinkNames = bridge ? findBridgeUplinks(interfaces, bridge) : [];
    const uplinks: DeploymentNetworkHop[] = uplinkNames.map((uplink) => {
      const neighbor = findNeighbor(neighbors, uplink);
      return {
        uplinkInterface: uplink,
        remote: neighbor
          ? {
              chassisId: neighbor.chassisId,
              systemName: neighbor.systemName,
              portId: neighbor.portId,
              portDescription: neighbor.portDescription,
              vlanId: neighbor.vlanId,
            }
          : null,
      };
    });

    entries.push({ netKey, bridge, vlanTag, uplinks });
  }

  return {
    agentHost,
    entries,
    freshestSnapshotAt: snapshot?.receivedAt ?? null,
  };
}
