export type SnmpOperStatus =
  | "up"
  | "down"
  | "testing"
  | "unknown"
  | "dormant"
  | "notPresent"
  | "lowerLayerDown";

export type SnmpAdminStatus = "up" | "down" | "testing" | "unknown";

export type SnmpPort = {
  /** ifIndex from the IF-MIB. Unique within a chassis. */
  index: number;
  /** ifDescr — usually the human port name (e.g. "GigabitEthernet1/0/1"). */
  name: string;
  /** ifAlias — operator-set description (e.g. "uplink-to-pve"). */
  alias: string;
  operStatus: SnmpOperStatus;
  adminStatus: SnmpAdminStatus;
  /** Bytes-per-second from ifHighSpeed * 1e6 (preferred) or ifSpeed. */
  speedBps: number | null;
  /** ifType (numeric, IANA-assigned). 6 = ethernetCsmacd, 53 = propVirtual. */
  type: number | null;
  mtu: number | null;
};

/**
 * One snapshot of a remote device's interface inventory, captured by an agent
 * running snmpwalk against the device's LLDP-advertised management IP.
 *
 * Keyed by `(siteId, chassisId)`. Replaced on every push, never appended —
 * the IF-MIB walk is idempotent and the agent's job is to keep our copy
 * fresh.
 */
export type SnmpDeviceSnapshot = {
  siteId: string;
  chassisId: string;
  mgmtIp: string;
  /** sysName from SNMP (often FQDN). May differ slightly from the LLDP name. */
  sysName: string | null;
  sysDescr: string | null;
  /** Agent hostname that ran the walk. */
  agentHost: string;
  /** Wall-clock time the agent's poll completed. */
  collectedAt: string;
  /** When the ingest endpoint stored the snapshot. */
  receivedAt: string;
  ports: SnmpPort[];
};

export type SnmpSnapshotsStore = {
  schemaVersion: 1;
  snapshots: SnmpDeviceSnapshot[];
};

/**
 * Per-site SNMP polling config. The community string is encrypted at rest
 * with the same AES-256-GCM helpers we use for 2FA / OIDC secrets — the
 * encrypted blob never leaves the server; the integration panel only ever
 * receives a `hasCommunity: boolean` indicator.
 */
export type SnmpSiteConfigRecord = {
  siteId: string;
  /** AES-256-GCM-encrypted ciphertext (iv.tag.ct). Null = SNMP disabled for site. */
  encryptedCommunity: string | null;
  /** SNMP version. Only "v2c" supported for now; "v3" placeholder for later. */
  version: "v2c";
  /** Poll cadence the agent uses, in seconds. 300 is the default. */
  pollIntervalSeconds: number;
  /**
   * Base URL (scheme + host + optional port, no path) the LLDP/SNMP agents
   * should POST to. Null means "derive from APP_URL / request origin" —
   * correct for internet-facing deployments, wrong for LAN boxes the nodes
   * reach by IP. The setup snippet bakes this into the agent's env file.
   */
  agentBaseUrl: string | null;
  updatedAt: string;
  updatedBy: string;
};

export type SnmpConfigStore = {
  schemaVersion: 1;
  sites: SnmpSiteConfigRecord[];
};
