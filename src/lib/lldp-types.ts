import "server-only";

/**
 * Single LLDP neighbour as observed on one local interface of a Proxmox node.
 * Field names mirror the IETF LLDP MIB so a power-user can grep the raw frame
 * dump against this struct without translation.
 */
export type LldpNeighbor = {
  /** Local interface that observed this neighbour (e.g. "eno1", "ens1f0"). */
  localInterface: string;
  /** Local interface MAC, if reported. */
  localMac: string | null;
  /** Remote chassis identifier (typically a MAC). Canonicalised to lowercase
   *  colon-separated form when looks like a MAC; otherwise stored verbatim. */
  chassisId: string;
  /** Remote chassis ID subtype as reported (e.g. "mac", "ifname"). */
  chassisIdSubtype: string | null;
  /** Remote port identifier (e.g. "Ethernet1/14", "swp14"). */
  portId: string;
  portIdSubtype: string | null;
  /** Human description from the remote port. */
  portDescription: string | null;
  /** Remote system hostname. */
  systemName: string | null;
  /** Remote system description (vendor/model/version blob). */
  systemDescription: string | null;
  /** Advertised capabilities: bridge, router, wlan-access-point, etc. */
  capabilities: string[];
  /** First management IP reported (IPv4 preferred). */
  managementAddress: string | null;
  /** VLAN ID via LLDP-MED, if present. */
  vlanId: number | null;
  /** TTL from the LLDP frame in seconds. Used to age out stale neighbours. */
  ttlSeconds: number | null;
};

/**
 * Snapshot pushed by one Proxmox node's agent. Stored verbatim under
 * (siteId, agentHost). Replaced on every push; not appended.
 */
export type LldpSnapshot = {
  /** The agent's own hostname (from `lldpcli show chassis` or `hostname`). */
  agentHost: string;
  /** ISO timestamp when the agent ran lldpcli. */
  collectedAt: string;
  /** ISO timestamp when Tainer received the push. */
  receivedAt: string;
  /** Source IP we observed the push from (after proxy-trust resolution). */
  sourceIp: string | null;
  /** Neighbours observed across every local interface. */
  neighbors: LldpNeighbor[];
};

/**
 * Per-site collection of the latest snapshot per agent host.
 */
export type LldpSiteSnapshots = {
  /** Map of agentHost → latest snapshot. */
  hosts: Record<string, LldpSnapshot>;
};

/**
 * Bearer-token issued to one agent. The plaintext token is shown to the
 * operator exactly once at issuance; only the SHA-256 hash is persisted.
 */
export type LldpToken = {
  id: string;
  siteId: string;
  /** Operator-supplied hint (typically the Proxmox node name). */
  label: string;
  /** SHA-256 of the issued token, hex. */
  tokenHash: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
};

export type LldpTokensStore = {
  schemaVersion: 1;
  tokens: LldpToken[];
};

/**
 * Derived view: one device discovered across all snapshots for a site.
 * Built by aggregating neighbours by chassisId. Held in memory only.
 */
export type LldpDevice = {
  chassisId: string;
  systemName: string | null;
  systemDescription: string | null;
  capabilities: string[];
  managementAddress: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Map of remote portId → port info (only ports we have observed). */
  ports: Record<string, LldpDevicePort>;
};

export type LldpDevicePort = {
  portId: string;
  portDescription: string | null;
  vlanId: number | null;
  /** Local-side endpoint that observed this remote port. */
  connectedTo: {
    agentHost: string;
    localInterface: string;
    speedHint: string | null;
  };
  lastSeenAt: string;
};

export type LldpTopologyEdge = {
  agentHost: string;
  localInterface: string;
  chassisId: string;
  portId: string;
  vlanId: number | null;
  lastSeenAt: string;
};

export type LldpTopology = {
  agents: string[];
  devices: LldpDevice[];
  edges: LldpTopologyEdge[];
  /** ISO timestamp of the most recent push across all agents. */
  freshestAt: string | null;
};

/**
 * Operator-supplied metadata about a discovered device. Used to override
 * LLDP-advertised fields that are wrong/missing, and to set non-LLDP info
 * the operator knows out-of-band (manual chassis size for the front panel,
 * a free-text note explaining the role of the device, etc.).
 *
 * Annotations are additive: removing all overrides falls back to whatever
 * LLDP advertised.
 */
export type LldpDeviceAnnotation = {
  siteId: string;
  chassisId: string;
  /** Overrides systemName in listings, topology, and detail header. */
  friendlyName: string | null;
  /** Overrides the inferred port count on the front-panel mock. */
  portCountOverride: number | null;
  /** Free-text operator note shown on the device detail page. */
  notes: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type LldpAnnotationsStore = {
  schemaVersion: 1;
  /** Annotations keyed by `${siteId}::${chassisId}`. */
  annotations: Record<string, LldpDeviceAnnotation>;
};
