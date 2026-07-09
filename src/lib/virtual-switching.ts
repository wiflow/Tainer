import "server-only";

import {
  getNodeNetworkConfig,
  listGuestNetSummaries,
  type GuestNetSummary,
  type ProxmoxIssue,
} from "@/lib/proxmox";
import { parseNetSpec } from "@/lib/lldp-deployment-path";

/**
 * Model for the "virtual switching" view: each Proxmox node is a switch
 * chassis, each Linux bridge a section of its front panel, each guest NIC a
 * port on that bridge, and the bridge's physical slave interfaces the
 * uplinks. Assembled from the node network config plus every guest's
 * `netN=…` config lines — read-only here; mutations go through
 * `updateDeploymentNicAction`.
 */

/** QEMU netN model keys — the value of this key is the NIC's MAC address. */
const QEMU_NIC_MODELS = [
  "virtio",
  "e1000",
  "e1000e",
  "rtl8139",
  "vmxnet3",
] as const;

export type VirtualPort = {
  deploymentId: string;
  deploymentName: string;
  vmid: number;
  guestType: "lxc" | "qemu";
  running: boolean;
  /** Config key, e.g. "net0". */
  netKey: string;
  bridge: string;
  mac: string | null;
  /** In-guest interface name (LXC `name=` / QEMU model). */
  iface: string | null;
  vlanTag: number | null;
  /** Proxmox rate limit in MB/s, as configured. Null = unlimited. */
  rateMbps: number | null;
  firewall: boolean;
  linkDown: boolean;
  /** Configured address (LXC `ip=`); "DHCP" or null when not static. */
  ip: string | null;
};

export type BridgeSection = {
  /** Bridge interface name, e.g. "vmbr0". */
  name: string;
  /** Node-side address of the bridge, if any. */
  cidr: string | null;
  vlanAware: boolean;
  /** Physical slave interfaces (bond/NIC) carrying this bridge. */
  uplinks: { iface: string; active: boolean }[];
  ports: VirtualPort[];
  /** True when guests reference this bridge but the node config doesn't
   *  define it (config drift or a permissions gap). */
  missing: boolean;
};

export type VirtualSwitchNode = {
  node: string;
  online: boolean;
  bridges: BridgeSection[];
  /** Set when the node's network config could not be read. */
  configError: string | null;
};

export type VirtualSwitchingOverview = {
  nodes: VirtualSwitchNode[];
  issues: ProxmoxIssue[];
};

function parsePort(
  guest: GuestNetSummary,
  netKey: string,
  rawSpec: string,
): VirtualPort | null {
  const spec = parseNetSpec(rawSpec);
  const bridge = spec.bridge?.trim();
  if (!bridge) return null;

  let mac: string | null = null;
  let iface: string | null = null;
  if (guest.type === "lxc") {
    mac = spec.hwaddr ?? null;
    iface = spec.name ?? null;
  } else {
    for (const model of QEMU_NIC_MODELS) {
      if (spec[model] !== undefined) {
        mac = spec[model] || null;
        iface = model;
        break;
      }
    }
  }

  const tag = Number.parseInt(spec.tag ?? "", 10);
  const rate = Number.parseFloat(spec.rate ?? "");
  const ip =
    guest.type === "lxc" && spec.ip ? (spec.ip === "dhcp" ? "DHCP" : spec.ip) : null;

  return {
    deploymentId: guest.id,
    deploymentName: guest.name,
    vmid: guest.vmid,
    guestType: guest.type,
    running: guest.running,
    netKey,
    bridge,
    mac,
    iface,
    vlanTag: Number.isInteger(tag) && tag > 0 ? tag : null,
    rateMbps: Number.isFinite(rate) && rate > 0 ? rate : null,
    firewall: spec.firewall === "1",
    linkDown: spec.link_down === "1",
    ip,
  };
}

export async function getVirtualSwitchingOverview(): Promise<VirtualSwitchingOverview> {
  const { guests, nodes: liveNodes, issues } = await listGuestNetSummaries();

  const portsByNode = new Map<string, VirtualPort[]>();
  for (const guest of guests) {
    const ports = Object.entries(guest.netSpecs)
      .map(([netKey, rawSpec]) => parsePort(guest, netKey, rawSpec))
      .filter((p): p is VirtualPort => p !== null);
    if (!ports.length) continue;
    portsByNode.set(guest.node, [...(portsByNode.get(guest.node) ?? []), ...ports]);
  }

  const nodeNames = new Set(liveNodes.map((n) => n.name));
  for (const guest of guests) nodeNames.add(guest.node);

  const switchNodes = await Promise.all(
    Array.from(nodeNames)
      .sort()
      .map(async (node): Promise<VirtualSwitchNode> => {
        const live = liveNodes.find((n) => n.name === node);
        const online = live ? live.status === "online" : false;
        const nodePorts = portsByNode.get(node) ?? [];

        let interfaces: Awaited<ReturnType<typeof getNodeNetworkConfig>> = [];
        let configError: string | null = null;
        if (online) {
          try {
            interfaces = await getNodeNetworkConfig(node);
          } catch (error) {
            configError =
              error instanceof Error ? error.message : "Failed to read network config.";
          }
        } else {
          configError = "Node is offline — bridge layout unavailable.";
        }

        const physicalActive = new Map<string, boolean>();
        for (const iface of interfaces) {
          if (iface.type === "eth" || iface.type === "bond") {
            physicalActive.set(iface.iface, iface.active === 1);
          }
        }

        const bridges: BridgeSection[] = interfaces
          .filter((iface) => iface.type === "bridge")
          .map((iface) => {
            const uplinkNames =
              iface.bridge_ports && iface.bridge_ports.trim() !== "none"
                ? iface.bridge_ports.trim().split(/\s+/).filter(Boolean)
                : [];
            return {
              name: iface.iface,
              cidr: iface.cidr ?? iface.address ?? null,
              vlanAware:
                iface.bridge_vlan_aware === 1 || iface.bridge_vlan_aware === "1",
              uplinks: uplinkNames.map((name) => ({
                iface: name,
                active: physicalActive.get(name) ?? false,
              })),
              ports: [],
              missing: false,
            };
          });

        for (const port of nodePorts) {
          let section = bridges.find((b) => b.name === port.bridge);
          if (!section) {
            section = {
              name: port.bridge,
              cidr: null,
              vlanAware: false,
              uplinks: [],
              ports: [],
              missing: !configError,
            };
            bridges.push(section);
          }
          section.ports.push(port);
        }

        for (const bridge of bridges) {
          bridge.ports.sort(
            (a, b) => a.vmid - b.vmid || a.netKey.localeCompare(b.netKey),
          );
        }
        bridges.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        return { node, online, bridges, configError };
      }),
  );

  return { nodes: switchNodes, issues };
}
