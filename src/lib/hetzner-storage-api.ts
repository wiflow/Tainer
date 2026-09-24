import "server-only";

const API_BASE = "https://api.hetzner.com/v1";

export type HetznerAccessSettings = {
  reachable_externally: boolean;
  ssh_enabled: boolean;
  samba_enabled: boolean;
  webdav_enabled: boolean;
  zfs_enabled: boolean;
};

export type HetznerStorageBox = {
  id: number;
  name: string;
  username: string | null;
  server: string | null;
  status: string;
  location: string;
  storageBoxType: string;
  accessSettings: HetznerAccessSettings;
  /** Bytes. */
  totalSize: number | null;
  usedSize: number | null;
  usedBySnapshots: number | null;
};

export type HetznerSnapshot = {
  id: number;
  name: string;
  description: string;
  createdAt: string;
  /** Bytes of snapshot delta. */
  size: number | null;
};

export class HetznerApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "HetznerApiError";
    this.status = status;
  }
}

async function hetznerRequest<T>(
  token: string,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    method: options.method ?? "GET",
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    let message = `Hetzner API error (HTTP ${response.status})`;
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      if (payload.error?.message) message = payload.error.message;
    } catch {
      // non-JSON error body
    }
    if (response.status === 401) message = "Hetzner API token was rejected (401).";
    throw new HetznerApiError(message, response.status);
  }

  return (await response.json()) as T;
}

type RawStorageBox = {
  id: number;
  name?: string;
  username?: string | null;
  server?: string | null;
  status?: string;
  location?: { name?: string } | string | null;
  storage_box_type?: { name?: string } | string | null;
  access_settings?: Partial<HetznerAccessSettings>;
  stats?: { size?: number; size_data?: number; size_snapshots?: number } | null;
  storage_box?: never;
};

function nameOf(value: { name?: string } | string | null | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : (value.name ?? "");
}

function mapBox(raw: RawStorageBox): HetznerStorageBox {
  return {
    accessSettings: {
      reachable_externally: raw.access_settings?.reachable_externally ?? false,
      samba_enabled: raw.access_settings?.samba_enabled ?? false,
      ssh_enabled: raw.access_settings?.ssh_enabled ?? false,
      webdav_enabled: raw.access_settings?.webdav_enabled ?? false,
      zfs_enabled: raw.access_settings?.zfs_enabled ?? false,
    },
    id: raw.id,
    location: nameOf(raw.location),
    name: raw.name ?? "",
    server: raw.server ?? null,
    status: raw.status ?? "unknown",
    storageBoxType: nameOf(raw.storage_box_type),
    totalSize: null,
    username: raw.username ?? null,
    usedBySnapshots: raw.stats?.size_snapshots ?? null,
    usedSize: raw.stats?.size ?? null,
  };
}

export async function listHetznerStorageBoxes(token: string): Promise<HetznerStorageBox[]> {
  const payload = await hetznerRequest<{ storage_boxes?: RawStorageBox[] }>(
    token,
    "/storage_boxes",
  );
  return (payload.storage_boxes ?? []).map(mapBox);
}

export async function getHetznerStorageBox(
  token: string,
  boxId: number,
): Promise<HetznerStorageBox> {
  const payload = await hetznerRequest<{ storage_box?: RawStorageBox }>(
    token,
    `/storage_boxes/${boxId}`,
  );
  if (!payload.storage_box) throw new HetznerApiError("Storage Box not found.", 404);
  return mapBox(payload.storage_box);
}

export async function updateHetznerAccessSettings(
  token: string,
  boxId: number,
  settings: Partial<HetznerAccessSettings>,
): Promise<void> {
  await hetznerRequest(token, `/storage_boxes/${boxId}/actions/update_access_settings`, {
    body: settings,
    method: "POST",
  });
}

type RawSnapshot = {
  id: number;
  name?: string;
  description?: string;
  created?: string;
  stats?: { size?: number } | null;
};

export async function listHetznerSnapshots(
  token: string,
  boxId: number,
): Promise<HetznerSnapshot[]> {
  const payload = await hetznerRequest<{ snapshots?: RawSnapshot[] }>(
    token,
    `/storage_boxes/${boxId}/snapshots`,
  );
  return (payload.snapshots ?? [])
    .map((raw) => ({
      createdAt: raw.created ?? "",
      description: raw.description ?? "",
      id: raw.id,
      name: raw.name ?? "",
      size: raw.stats?.size ?? null,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createHetznerSnapshot(
  token: string,
  boxId: number,
  description: string,
): Promise<void> {
  await hetznerRequest(token, `/storage_boxes/${boxId}/snapshots`, {
    body: description ? { description } : {},
    method: "POST",
  });
}

export async function deleteHetznerSnapshot(
  token: string,
  boxId: number,
  snapshotId: number,
): Promise<void> {
  await hetznerRequest(token, `/storage_boxes/${boxId}/snapshots/${snapshotId}`, {
    method: "DELETE",
  });
}
