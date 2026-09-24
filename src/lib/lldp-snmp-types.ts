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
  index: number;
  name: string;
  alias: string;
  operStatus: SnmpOperStatus;
  adminStatus: SnmpAdminStatus;
  /** Bits per second. */
  speedBps: number | null;
  /** IANA ifType number, e.g. 6 = ethernetCsmacd. */
  type: number | null;
  mtu: number | null;
};

export type SnmpDeviceSnapshot = {
  siteId: string;
  chassisId: string;
  mgmtIp: string;
  sysName: string | null;
  sysDescr: string | null;
  agentHost: string;
  collectedAt: string;
  receivedAt: string;
  ports: SnmpPort[];
};

export type SnmpSnapshotsStore = {
  schemaVersion: 1;
  snapshots: SnmpDeviceSnapshot[];
};

export type SnmpSiteConfigRecord = {
  siteId: string;
  /** AES-256-GCM ciphertext (iv.tag.ct) that must never reach the client; null disables SNMP. */
  encryptedCommunity: string | null;
  version: "v2c";
  pollIntervalSeconds: number;
  /** Scheme, host and optional port, no path; null falls back to APP_URL or the request origin. */
  agentBaseUrl: string | null;
  updatedAt: string;
  updatedBy: string;
};

export type SnmpConfigStore = {
  schemaVersion: 1;
  sites: SnmpSiteConfigRecord[];
};
