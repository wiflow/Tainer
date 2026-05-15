import "server-only";

import type { LldpNeighbor, LldpSiteSnapshots } from "@/lib/lldp-types";
import {
  getNodeNetworkConfig,
  type ProxmoxNetworkInterface,
} from "@/lib/proxmox";

/**
 * One physical link from the Proxmox host bridge to an upstream switch port,
 * surfaced from the LLDP snapshot that observed it.
 */
export type DeploymentNetworkHop = {
  /** The physical NIC on the Proxmox host that participates in the bridge. */
  uplinkInterface: string;
  /** Upstream device, if LLDP saw a neighbour on `uplinkInterface`. */
  remote: {
    chassisId: string;
    systemName: string | null;
    portId: string;
    portDescription: string | null;
    vlanId: number | null;
  } | null;
};

export type DeploymentNetworkPathEntry = {
  /** The container's `net0` / `net1` / etc. key. */
  netKey: string;
  /** Bridge on the Proxmox host the interface attaches to. */
  bridge: string | null;
  /** Other parameters parsed from the network spec (firewall, IP, etc.). */
  vlanTag: number | null;
  /** All physical NICs on the bridge plus their LLDP-derived upstream port. */
  uplinks: DeploymentNetworkHop[];
};

export type DeploymentNetworkPath = {
  agentHost: string | null;
  entries: DeploymentNetworkPathEntry[];
  freshestSnapshotAt: string | null;
};

/**
 * Parse one `netN=...` line from a Proxmox container/VM config. The string is
 * comma-separated `key=value` pairs (with some bare flags for QEMU).
 */
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

/**
 * Match a Proxmox node name to one of the agent hosts that has posted
 * snapshots for this site. PVE node names are usually short hostnames; agents
 * post `$(hostname)` which may be short or FQDN depending on system config.
 */
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

/**
 * Resolve the full chain { container netN → bridge → uplink NIC → switch + port }
 * for a deployment, using its config + node network config + LLDP snapshot.
 *
 * Returns null if the deployment has no network interfaces configured.
 * Returns entries with `uplinks: []` for bridges whose `bridge_ports` is
 * empty (e.g. an isolated host-only bridge with no upstream link).
 */
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
