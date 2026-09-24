import "server-only";

export type LldpNeighbor = {
  localInterface: string;
  localMac: string | null;
  /** Lowercase colon-separated when it looks like a MAC, otherwise verbatim. */
  chassisId: string;
  chassisIdSubtype: string | null;
  portId: string;
  portIdSubtype: string | null;
  portDescription: string | null;
  systemName: string | null;
  systemDescription: string | null;
  capabilities: string[];
  managementAddress: string | null;
  vlanId: number | null;
  ttlSeconds: number | null;
};

export type LldpSnapshot = {
  agentHost: string;
  collectedAt: string;
  receivedAt: string;
  sourceIp: string | null;
  neighbors: LldpNeighbor[];
};

export type LldpSiteSnapshots = {
  hosts: Record<string, LldpSnapshot>;
};

export type LldpToken = {
  id: string;
  siteId: string;
  label: string;
  /** Hex SHA-256 of the token; the plaintext is never stored. */
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

export type LldpDevice = {
  chassisId: string;
  systemName: string | null;
  systemDescription: string | null;
  capabilities: string[];
  managementAddress: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  ports: Record<string, LldpDevicePort>;
};

export type LldpDevicePort = {
  portId: string;
  portDescription: string | null;
  vlanId: number | null;
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
  freshestAt: string | null;
};

export type LldpDeviceAnnotation = {
  siteId: string;
  chassisId: string;
  friendlyName: string | null;
  portCountOverride: number | null;
  notes: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type LldpAnnotationsStore = {
  schemaVersion: 1;
  annotations: Record<string, LldpDeviceAnnotation>;
};
