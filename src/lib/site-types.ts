export type SiteKind = "proxmox";

export type TlsMode = "full" | "insecure";

export type ProxmoxSitePayload = {
  apiUrl: string;
  username: string;
  passwordEncrypted: string;
  tlsMode: TlsMode;
  tlsFingerprint: string | null;
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

export type SiteLocation = {
  latitude: number;
  longitude: number;
  address?: string | null;
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
  nodeFingerprints?: string[];
  location: SiteLocation | null;
  /** ISO-3166-1 alpha-2 code. */
  countryCode: string | null;
  payload: ProxmoxSitePayload;
};

export type SiteStore = {
  schemaVersion: 1;
  defaultSiteId: string | null;
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
  username: string;
  password: string;
  tlsMode: TlsMode;
  tlsFingerprint?: string | null;
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
  address?: string | null;
  /** Empty string clears the country, undefined leaves it untouched. */
  countryCode?: string | null;
};

export type SiteValidationResult = {
  ok: boolean;
  latencyMs: number;
  version: string | null;
  message?: string;
  nodes?: { name: string; fingerprint: string }[];
};
