export type SiteKind = "proxmox";

export type TlsMode = "full" | "insecure";

export type ProxmoxSitePayload = {
  apiUrl: string;
  /** Proxmox username, e.g. `root@pam` or `admin@pve`. */
  username: string;
  /** AES-256-GCM encrypted password. */
  passwordEncrypted: string;
  tlsMode: TlsMode;
  /** Optional TLS fingerprint for pinned certs. */
  tlsFingerprint: string | null;
  /** PEM-encoded custom CA certificate(s) for internal/corporate CAs. */
  tlsCustomCaPem: string | null;

  // Site defaults
  defaultNode: string;
  defaultRootfsStorage: string;
  defaultVmStorage: string;
  defaultIsoStorage: string;
  defaultBackupStorage: string;
  defaultBackupSlaHours: number;

  // SSH
  sshHostKeyPolicy: "strict" | "accept-new" | "auto" | "off";
  /** App-managed known-hosts content for this site. */
  consoleKnownHostsContent: string | null;
};

export type SiteLocation = {
  latitude: number;
  longitude: number;
};

export type SiteRecord = {
  id: string;
  slug: string;
  name: string;
  kind: SiteKind;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastValidatedAt: string | null;
  lastValidationOk: boolean | null;
  /** SSL fingerprints of all cluster nodes, stored during creation/validation. */
  nodeFingerprints?: string[];
  location: SiteLocation | null;
  payload: ProxmoxSitePayload;
};

export type SiteStore = {
  schemaVersion: 1;
  defaultSiteId: string | null;
  /** Set during auto-import of PROXMOX_* env vars on first upgrade boot. */
  legacyImportedEnvSiteId: string | null;
  sites: SiteRecord[];
};

export type ResolvedSiteConfig = {
  siteId: string;
  siteSlug: string;
  siteName: string;

  apiUrl: string;
  username: string;
  password: string;
  tlsInsecure: boolean;
  tlsFingerprint: string | null;
  /** PEM-encoded custom CA certificate(s) for internal/corporate CAs. */
  tlsCustomCaPem: string | null;

  defaultNode: string;
  defaultRootfsStorage: string;
  defaultVmStorage: string;
  defaultIsoStorage: string;
  defaultBackupStorage: string;
  defaultBackupSlaHours: number;

  sshHostKeyPolicy: "strict" | "accept-new" | "auto" | "off";
  consoleKnownHostsContent: string | null;
};

export type SiteInput = {
  name: string;
  kind: SiteKind;

  apiUrl: string;
  /** Proxmox username, e.g. `root@pam`. */
  username: string;
  /** Plaintext password — encrypted before persistence. */
  password: string;
  tlsMode: TlsMode;
  tlsFingerprint?: string | null;
  /** PEM-encoded custom CA certificate(s) for internal/corporate CAs. */
  tlsCustomCaPem?: string | null;

  defaultNode: string;
  defaultRootfsStorage?: string;
  defaultVmStorage?: string;
  defaultIsoStorage?: string;
  defaultBackupStorage?: string;
  defaultBackupSlaHours?: number;

  sshHostKeyPolicy?: "strict" | "accept-new" | "auto" | "off";
  consoleKnownHostsContent?: string | null;

  latitude?: number | null;
  longitude?: number | null;
};

export type SiteValidationResult = {
  ok: boolean;
  latencyMs: number;
  version: string | null;
  message?: string;
  /** Nodes discovered during validation, with their SSL fingerprints. */
  nodes?: { name: string; fingerprint: string }[];
};
