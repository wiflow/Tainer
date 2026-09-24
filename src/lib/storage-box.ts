import "server-only";

import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { decryptText, encryptText } from "@/lib/crypto";
import { runNodeRootCommand } from "@/lib/proxmox-host";
import {
  getActiveSiteConfig,
  getDeploymentIndex,
  getStorageConfig,
  listBackupsForVm,
} from "@/lib/proxmox";
import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { runSshCommand } from "@/lib/ssh-command";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

export const STORAGE_BOX_SSH_PORT = 23;

const BOX_HOST_KEY_OPTIONS = ["-o", "StrictHostKeyChecking=accept-new"];

const HOST_PATTERN = /^[a-z0-9][a-z0-9.-]{2,253}$/i;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}$/i;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const ARCHIVE_NAME_PATTERN = /^vzdump-(lxc|qemu)-\d+-[A-Za-z0-9._-]+$/;

const OFFLOAD_LOG_LIMIT = 200;
const TRANSFER_TIMEOUT_MS = 6 * 60 * 60 * 1000;

export type StorageBoxConfig = {
  host: string;
  username: string;
  passwordEncrypted: string;
  basePath: string;
  publicKey: string | null;
  privateKeyEncrypted: string | null;
  keyInstalled: boolean;
  cifsStorageId: string | null;
  /** rsync --bwlimit in KiB/s, 0 means unlimited. */
  bandwidthLimitKbps: number;
  encryptEnabled: boolean;
  encryptionKeyEncrypted: string | null;
  hetznerTokenEncrypted: string | null;
  hetznerBoxId: number | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string;
  createdAt: string;
  updatedAt: string;
};

export type StorageBoxUsage = {
  usedBytes: number | null;
  totalBytes: number | null;
  raw: string;
};

/** Must stay secret-free: it is passed to client components. */
export type StorageBoxSummary = {
  configured: boolean;
  host: string;
  username: string;
  basePath: string;
  keyInstalled: boolean;
  cifsStorageId: string | null;
  bandwidthLimitKbps: number;
  encryptEnabled: boolean;
  hetznerConnected: boolean;
  hetznerBoxId: number | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string;
  queueDepth: number;
  currentTransfer: string | null;
};

export type OffloadLogEntry = {
  id: string;
  at: string;
  kind: "offload" | "retrieve" | "prune";
  status: "success" | "error";
  policyId: string | null;
  policyName: string | null;
  vmid: number | null;
  archive: string;
  remotePath: string;
  sizeBytes: number | null;
  durationSeconds: number | null;
  message: string;
};

type StorageBoxStore = {
  config: StorageBoxConfig | null;
};

type OffloadLogStore = {
  entries: OffloadLogEntry[];
};

function shellSingleQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function validateHost(host: string) {
  const normalized = host.trim().toLowerCase();
  if (!HOST_PATTERN.test(normalized)) {
    throw new Error("Invalid Storage Box host name.");
  }
  return normalized;
}

function validateUsername(username: string) {
  const normalized = username.trim();
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new Error("Invalid Storage Box username.");
  }
  return normalized;
}

function validateBasePath(basePath: string) {
  const normalized = basePath.trim().replace(/^\/+|\/+$/g, "");
  if (!normalized) return "tainer-offsite";
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (!PATH_SEGMENT_PATTERN.test(segment)) {
      throw new Error("Base path may only contain letters, digits, dots, dashes and underscores.");
    }
  }
  return segments.join("/");
}

function validateRemoteSegment(value: string, label: string) {
  if (!PATH_SEGMENT_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

async function readStore(): Promise<StorageBoxStore> {
  try {
    const raw = await readFile(
      await resolveSiteDataFilePathFromContext("storage-box.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<StorageBoxStore>;
    return { config: parsed.config ?? null };
  } catch {
    return { config: null };
  }
}

async function writeStore(store: StorageBoxStore) {
  const filePath = await resolveSiteDataFilePathFromContext("storage-box.json");
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("storage-box", readStore, writeStore);

export async function getStorageBoxConfig(): Promise<StorageBoxConfig | null> {
  const store = await readStore();
  return store.config;
}

export async function getStorageBoxSummary(): Promise<StorageBoxSummary> {
  const config = await getStorageBoxConfig();
  if (!config) {
    return {
      bandwidthLimitKbps: 0,
      basePath: "tainer-offsite",
      cifsStorageId: null,
      configured: false,
      currentTransfer: null,
      encryptEnabled: false,
      hetznerBoxId: null,
      hetznerConnected: false,
      host: "",
      keyInstalled: false,
      lastTestMessage: "",
      lastTestOk: null,
      lastTestedAt: null,
      queueDepth: 0,
      username: "",
    };
  }
  return {
    bandwidthLimitKbps: config.bandwidthLimitKbps ?? 0,
    basePath: config.basePath,
    cifsStorageId: config.cifsStorageId,
    configured: true,
    currentTransfer: getCurrentTransferLabel(),
    encryptEnabled: config.encryptEnabled ?? false,
    hetznerBoxId: config.hetznerBoxId ?? null,
    hetznerConnected: Boolean(config.hetznerTokenEncrypted),
    host: config.host,
    keyInstalled: config.keyInstalled,
    lastTestMessage: config.lastTestMessage,
    lastTestOk: config.lastTestOk,
    lastTestedAt: config.lastTestedAt,
    queueDepth: getOffloadQueueDepth(),
    username: config.username,
  };
}

async function readLog(): Promise<OffloadLogStore> {
  try {
    const raw = await readFile(
      await resolveSiteDataFilePathFromContext("storage-box-offload-log.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<OffloadLogStore>;
    return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    return { entries: [] };
  }
}

async function writeLog(store: OffloadLogStore) {
  const filePath = await resolveSiteDataFilePathFromContext("storage-box-offload-log.json");
  await writeJsonFileAtomically(filePath, store);
}

const mutateLog = createStoreMutator("storage-box-offload-log", readLog, writeLog);

export async function listOffloadLog(limit = 50): Promise<OffloadLogEntry[]> {
  const store = await readLog();
  return store.entries.slice(0, limit);
}

async function appendLogEntry(entry: Omit<OffloadLogEntry, "id" | "at">) {
  await mutateLog((store) => {
    store.entries.unshift({
      ...entry,
      at: new Date().toISOString(),
      id: randomUUID(),
    });
    if (store.entries.length > OFFLOAD_LOG_LIMIT) {
      store.entries.length = OFFLOAD_LOG_LIMIT;
    }
  });
}

export type OffsiteIndexEntry = {
  vmid: number;
  offloadedAt: string;
  verified: boolean;
  encrypted: boolean;
  sizeBytes: number | null;
};

type OffsiteIndexStore = {
  /** Keyed by the plain archive name (no .enc suffix). */
  archives: Record<string, OffsiteIndexEntry>;
};

async function readIndex(): Promise<OffsiteIndexStore> {
  try {
    const raw = await readFile(
      await resolveSiteDataFilePathFromContext("storage-box-index.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<OffsiteIndexStore>;
    return { archives: parsed.archives ?? {} };
  } catch {
    return { archives: {} };
  }
}

async function writeIndex(store: OffsiteIndexStore) {
  const filePath = await resolveSiteDataFilePathFromContext("storage-box-index.json");
  await writeJsonFileAtomically(filePath, store);
}

const mutateIndex = createStoreMutator("storage-box-index", readIndex, writeIndex);

export async function getOffsiteIndex(): Promise<Record<string, OffsiteIndexEntry>> {
  const store = await readIndex();
  return store.archives;
}

type BoxCredentials = {
  host: string;
  username: string;
  password: string | null;
  privateKey: string | null;
};

async function resolveBoxCredentials(): Promise<BoxCredentials> {
  const config = await getStorageBoxConfig();
  if (!config) throw new Error("No Storage Box is connected for this site.");

  return {
    host: config.host,
    password: config.passwordEncrypted ? await decryptText(config.passwordEncrypted) : null,
    privateKey:
      config.keyInstalled && config.privateKeyEncrypted
        ? await decryptText(config.privateKeyEncrypted)
        : null,
    username: config.username,
  };
}

/** The box has no shell, so only its whitelisted commands run, in raw mode. */
async function runBoxCommand(
  credentials: BoxCredentials,
  remoteCommand: string,
  options?: { input?: string; timeoutMs?: number },
) {
  return runSshCommand({
    destination: `${credentials.username}@${credentials.host}`,
    hostKeyOptions: BOX_HOST_KEY_OPTIONS,
    input: options?.input,
    password: credentials.password ?? undefined,
    port: STORAGE_BOX_SSH_PORT,
    privateKey: credentials.privateKey ?? undefined,
    raw: true,
    remoteCommand,
    timeoutMs: options?.timeoutMs ?? 20_000,
  });
}

/** The box's mkdir has no -p flag. */
async function ensureRemoteDirectory(credentials: BoxCredentials, remotePath: string) {
  const segments = remotePath.split("/").filter(Boolean);
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    try {
      await runBoxCommand(credentials, `mkdir ${shellSingleQuote(current)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (!/exists|failure/i.test(message)) throw err;
    }
  }
}

function parseDfOutput(output: string): StorageBoxUsage {
  for (const line of output.split("\n").slice(1)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length >= 3) {
      const total = Number(columns[1]);
      const used = Number(columns[2]);
      if (Number.isFinite(total) && Number.isFinite(used) && total > 0) {
        return { raw: output.trim(), totalBytes: total * 1024, usedBytes: used * 1024 };
      }
    }
  }
  return { raw: output.trim(), totalBytes: null, usedBytes: null };
}

function generateBoxKeyPair(comment: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  // The raw ed25519 key is the last 32 bytes of the SPKI DER.
  const der = publicKey.export({ format: "der", type: "spki" });
  const rawKey = der.subarray(der.length - 32);
  const typeLabel = Buffer.from("ssh-ed25519");
  const wire = Buffer.concat([
    Buffer.from([0, 0, 0, typeLabel.length]),
    typeLabel,
    Buffer.from([0, 0, 0, rawKey.length]),
    rawKey,
  ]);

  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyLine: `ssh-ed25519 ${wire.toString("base64")} ${comment}`,
  };
}

export async function connectStorageBox(input: {
  host: string;
  username: string;
  password: string;
  basePath: string;
  bandwidthLimitKbps: number;
  encryptEnabled: boolean;
}): Promise<StorageBoxSummary> {
  const host = validateHost(input.host);
  const username = validateUsername(input.username);
  const basePath = validateBasePath(input.basePath);
  const bandwidthLimitKbps = Math.max(0, Math.round(input.bandwidthLimitKbps || 0));
  const password = input.password;
  if (!password) throw new Error("The Storage Box password is required to connect.");

  const site = getActiveSiteConfig();
  const passwordCredentials: BoxCredentials = { host, password, privateKey: null, username };

  const dfOutput = await runBoxCommand(passwordCredentials, "df");

  const comment = `tainer-offsite-${site.siteSlug}`;
  const keyPair = generateBoxKeyPair(comment);
  let keyInstalled = false;
  try {
    await runBoxCommand(passwordCredentials, "install-ssh-key", {
      input: `${keyPair.publicKeyLine}\n`,
    });
    const keyCredentials: BoxCredentials = {
      host,
      password: null,
      privateKey: keyPair.privateKeyPem,
      username,
    };
    await runBoxCommand(keyCredentials, "df");
    keyInstalled = true;
  } catch (err) {
    console.error("[storage-box] SSH key installation failed, staying on password auth:", err);
  }

  await ensureRemoteDirectory(passwordCredentials, basePath);

  const timestamp = new Date().toISOString();
  const usage = parseDfOutput(dfOutput);
  const config: StorageBoxConfig = {
    bandwidthLimitKbps,
    basePath,
    cifsStorageId: null,
    createdAt: timestamp,
    encryptEnabled: input.encryptEnabled,
    encryptionKeyEncrypted: input.encryptEnabled
      ? await encryptText(randomBytes(32).toString("hex"))
      : null,
    hetznerBoxId: null,
    hetznerTokenEncrypted: null,
    host,
    keyInstalled,
    lastTestMessage: usage.totalBytes
      ? `Connected: ${(usage.usedBytes ?? 0) / 1024 ** 3 < 1 ? "<1" : Math.round((usage.usedBytes ?? 0) / 1024 ** 3)} of ${Math.round(usage.totalBytes / 1024 ** 3)} GiB used`
      : "Connected",
    lastTestOk: true,
    lastTestedAt: timestamp,
    username,
    passwordEncrypted: await encryptText(password),
    privateKeyEncrypted: keyInstalled ? await encryptText(keyPair.privateKeyPem) : null,
    publicKey: keyInstalled ? keyPair.publicKeyLine : null,
    updatedAt: timestamp,
  };

  await mutateStore((store) => {
    const existing = store.config;
    store.config = existing
      ? {
          ...config,
          cifsStorageId: existing.cifsStorageId,
          createdAt: existing.createdAt,
          // Replacing the key would orphan every already-encrypted remote archive.
          encryptionKeyEncrypted: existing.encryptionKeyEncrypted ?? config.encryptionKeyEncrypted,
          hetznerBoxId: existing.hetznerBoxId ?? null,
          hetznerTokenEncrypted: existing.hetznerTokenEncrypted ?? null,
        }
      : config;
  });

  return getStorageBoxSummary();
}

export async function setHetznerApiToken(token: string): Promise<{ boxId: number; boxName: string }> {
  const config = await getStorageBoxConfig();
  if (!config) throw new Error("Connect the Storage Box first.");
  if (!token.trim()) throw new Error("An API token is required.");

  const { listHetznerStorageBoxes } = await import("@/lib/hetzner-storage-api");
  const boxes = await listHetznerStorageBoxes(token.trim());
  if (boxes.length === 0) {
    throw new Error("The token is valid but no Storage Boxes are visible to it.");
  }

  // Sub-account hosts share the main account's uXXXXX prefix.
  const hostPrefix = config.host.split(".")[0].split("-")[0].toLowerCase();
  const match =
    boxes.find((box) => (box.server ?? "").toLowerCase() === config.host) ??
    boxes.find((box) => (box.server ?? "").toLowerCase().startsWith(`${hostPrefix}.`)) ??
    boxes.find((box) => (box.username ?? "").toLowerCase() === hostPrefix) ??
    (boxes.length === 1 ? boxes[0] : undefined);

  if (!match) {
    throw new Error(
      `None of the ${boxes.length} Storage Boxes on this token match ${config.host}.`,
    );
  }

  const sealed = await encryptText(token.trim());
  await mutateStore((store) => {
    if (store.config) {
      store.config.hetznerTokenEncrypted = sealed;
      store.config.hetznerBoxId = match.id;
      store.config.updatedAt = new Date().toISOString();
    }
  });

  return { boxId: match.id, boxName: match.name };
}

export async function clearHetznerApiToken(): Promise<void> {
  await mutateStore((store) => {
    if (store.config) {
      store.config.hetznerTokenEncrypted = null;
      store.config.hetznerBoxId = null;
      store.config.updatedAt = new Date().toISOString();
    }
  });
}

export async function getHetznerApiContext(): Promise<{ token: string; boxId: number } | null> {
  const config = await getStorageBoxConfig();
  if (!config?.hetznerTokenEncrypted || !config.hetznerBoxId) return null;
  return {
    boxId: config.hetznerBoxId,
    token: await decryptText(config.hetznerTokenEncrypted),
  };
}

export async function disconnectStorageBox(): Promise<void> {
  await mutateStore((store) => {
    store.config = null;
  });
}

export async function testStorageBox(): Promise<{ ok: boolean; message: string; usage: StorageBoxUsage | null }> {
  let result: { ok: boolean; message: string; usage: StorageBoxUsage | null };
  try {
    const credentials = await resolveBoxCredentials();
    const output = await runBoxCommand(credentials, "df");
    const usage = parseDfOutput(output);
    result = {
      message: usage.totalBytes
        ? `Reachable: ${formatGiB(usage.usedBytes ?? 0)} of ${formatGiB(usage.totalBytes)} GiB used`
        : "Reachable",
      ok: true,
      usage,
    };
  } catch (err) {
    result = {
      message: err instanceof Error ? err.message : "Connection failed",
      ok: false,
      usage: null,
    };
  }

  const timestamp = new Date().toISOString();
  await mutateStore((store) => {
    if (store.config) {
      store.config.lastTestedAt = timestamp;
      store.config.lastTestOk = result.ok;
      store.config.lastTestMessage = result.message;
      store.config.updatedAt = timestamp;
    }
  });

  return result;
}

function formatGiB(bytes: number) {
  const gib = bytes / 1024 ** 3;
  return gib < 1 && gib > 0 ? "<1" : String(Math.round(gib));
}

export async function markCifsStorageRegistered(storageId: string | null): Promise<void> {
  await mutateStore((store) => {
    if (store.config) {
      store.config.cifsStorageId = storageId;
      store.config.updatedAt = new Date().toISOString();
    }
  });
}

export type RemoteArchive = {
  name: string;
  vmid: number;
  remoteDir: string;
};

export async function listRemoteArchives(): Promise<RemoteArchive[]> {
  const config = await getStorageBoxConfig();
  if (!config) return [];

  const site = getActiveSiteConfig();
  const credentials = await resolveBoxCredentials();
  const siteDir = `${config.basePath}/${site.siteSlug}`;

  let vmidNames: string[] = [];
  try {
    vmidNames = (await runBoxCommand(credentials, `ls ${shellSingleQuote(siteDir)}`))
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s));
  } catch {
    return [];
  }

  const archives: RemoteArchive[] = [];
  for (const vmidName of vmidNames) {
    const remoteDir = `${siteDir}/${vmidName}`;
    try {
      const names = (await runBoxCommand(credentials, `ls ${shellSingleQuote(remoteDir)}`))
        .split(/\s+/)
        .map((s) => s.trim())
        .filter((s) => ARCHIVE_NAME_PATTERN.test(s));
      for (const name of names) {
        archives.push({ name, remoteDir, vmid: Number(vmidName) });
      }
    } catch {
    }
  }

  return archives.sort((a, b) => b.name.localeCompare(a.name));
}

const globalForOffload = globalThis as typeof globalThis & {
  __tainerOffloadQueue?: Promise<void>;
  __tainerOffloadActive?: number;
  __tainerCurrentTransfer?: string | null;
  __tainerLastReconcileAt?: number;
};

function enqueueTransfer(job: () => Promise<void>): void {
  const queue = globalForOffload.__tainerOffloadQueue ?? Promise.resolve();
  globalForOffload.__tainerOffloadActive = (globalForOffload.__tainerOffloadActive ?? 0) + 1;
  globalForOffload.__tainerOffloadQueue = queue
    .then(job)
    .catch((err) => {
      console.error("[storage-box] Offload job failed:", err);
    })
    .finally(() => {
      globalForOffload.__tainerOffloadActive = (globalForOffload.__tainerOffloadActive ?? 1) - 1;
    });
}

export function getOffloadQueueDepth(): number {
  return globalForOffload.__tainerOffloadActive ?? 0;
}

export function getCurrentTransferLabel(): string | null {
  return globalForOffload.__tainerCurrentTransfer ?? null;
}

export async function scheduleArchiveOffload(input: {
  node: string;
  vmid: number;
  storage: string;
  policyId: string;
  policyName: string;
  remoteRetentionCount: number;
  trigger?: "backup" | "reconcile";
}): Promise<void> {
  const config = await getStorageBoxConfig();
  if (!config) return;

  const site = getActiveSiteConfig();
  const siteSlug = validateRemoteSegment(site.siteSlug, "site slug");

  enqueueTransfer(async () => {
    const startedAt = Date.now();
    let archiveName = "";
    const remoteDir = `${config.basePath}/${siteSlug}/${input.vmid}`;
    try {
      const { archives } = await listBackupsForVm(input.node, input.vmid);
      const newest = archives
        .filter((a) => a.storage === input.storage)
        .sort((a, b) => b.ctime - a.ctime)[0];
      if (!newest) throw new Error(`No archive found on "${input.storage}" for VMID ${input.vmid}.`);

      archiveName = newest.volid.split("/").pop() ?? newest.volid;
      validateRemoteSegment(archiveName, "archive name");

      const index = await readIndex();
      if (index.archives[archiveName]?.verified) return;

      const localPath = (
        await runNodeRootCommand(input.node, `pvesm path ${shellSingleQuote(newest.volid)}`)
      ).trim();
      if (!localPath.startsWith("/")) {
        throw new Error(`Could not resolve a filesystem path for ${newest.volid}.`);
      }

      const credentials = await resolveBoxCredentials();
      await ensureRemoteDirectory(credentials, remoteDir);

      globalForOffload.__tainerCurrentTransfer = archiveName;
      const encrypted = config.encryptEnabled && Boolean(config.encryptionKeyEncrypted);
      const remoteName = encrypted ? `${archiveName}.enc` : archiveName;

      const verified = await transferFromNode({
        bandwidthLimitKbps: config.bandwidthLimitKbps ?? 0,
        credentials,
        direction: "push",
        encryptionKey: encrypted ? await decryptText(config.encryptionKeyEncrypted as string) : null,
        localPath,
        node: input.node,
        remotePath: `${remoteDir}/${remoteName}`,
      });

      await mutateIndex((store) => {
        store.archives[archiveName] = {
          encrypted,
          offloadedAt: new Date().toISOString(),
          sizeBytes: newest.sizeBytes ?? null,
          verified,
          vmid: input.vmid,
        };
      });

      await appendLogEntry({
        archive: archiveName,
        durationSeconds: Math.round((Date.now() - startedAt) / 1000),
        kind: "offload",
        message: `${input.trigger === "reconcile" ? "Backfilled" : "Offloaded"} to ${config.host}:${remoteDir}${encrypted ? " (encrypted)" : ""}, sha256 ${verified ? "verified" : "NOT verified"}`,
        policyId: input.policyId,
        policyName: input.policyName,
        remotePath: `${remoteDir}/${remoteName}`,
        sizeBytes: newest.sizeBytes ?? null,
        status: verified ? "success" : "error",
        vmid: input.vmid,
      });

      if (input.remoteRetentionCount > 0) {
        await pruneRemoteArchives(credentials, remoteDir, input.remoteRetentionCount, input.vmid);
      }
    } catch (err) {
      await appendLogEntry({
        archive: archiveName,
        durationSeconds: Math.round((Date.now() - startedAt) / 1000),
        kind: "offload",
        message: err instanceof Error ? err.message : "Offload failed",
        policyId: input.policyId,
        policyName: input.policyName,
        remotePath: remoteDir,
        sizeBytes: null,
        status: "error",
        vmid: input.vmid,
      }).catch(() => {});
    } finally {
      globalForOffload.__tainerCurrentTransfer = null;
    }
  });
}

async function pruneRemoteArchives(
  credentials: BoxCredentials,
  remoteDir: string,
  keepCount: number,
  vmid: number,
) {
  // vzdump names embed the timestamp, so lexicographic order is chronological.
  const names = (await runBoxCommand(credentials, `ls ${shellSingleQuote(remoteDir)}`))
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => ARCHIVE_NAME_PATTERN.test(s.replace(/\.enc$/, "")))
    .sort()
    .reverse();

  for (const name of names.slice(keepCount)) {
    try {
      await runBoxCommand(credentials, `rm ${shellSingleQuote(`${remoteDir}/${name}`)}`);
      const plainName = name.replace(/\.enc$/, "");
      await mutateIndex((store) => {
        delete store.archives[plainName];
      });
      await appendLogEntry({
        archive: name,
        durationSeconds: null,
        kind: "prune",
        message: `Remote retention (keep ${keepCount})`,
        policyId: null,
        policyName: null,
        remotePath: `${remoteDir}/${name}`,
        sizeBytes: null,
        status: "success",
        vmid,
      });
    } catch (err) {
      console.error(`[storage-box] Failed to prune remote archive ${name}:`, err);
    }
  }
}

const KEY_BOUNDARY = "-----TAINER-KEY-BOUNDARY-----";

async function transferFromNode(input: {
  bandwidthLimitKbps: number;
  credentials: BoxCredentials;
  direction: "push" | "pull";
  encryptionKey: string | null;
  localPath: string;
  node: string;
  remotePath: string;
}): Promise<boolean> {
  const { credentials } = input;
  if (!credentials.privateKey) {
    throw new Error(
      "Transfers require the SSH key installed during connect. Reconnect the Storage Box to install it.",
    );
  }

  const suffix = createHash("sha256").update(input.remotePath).digest("hex").slice(0, 8);
  const keyPath = `/root/.tainer-offsite-${suffix}.key`;
  const encKeyPath = `/root/.tainer-offsite-${suffix}.enckey`;
  const combinedPath = `/root/.tainer-offsite-${suffix}.stdin`;

  const sshOptions = `-p ${STORAGE_BOX_SSH_PORT} -i ${keyPath} -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o IdentitiesOnly=yes`;
  const bwlimit = input.bandwidthLimitKbps > 0 ? ` --bwlimit=${input.bandwidthLimitKbps}` : "";
  const destination = `${credentials.username}@${credentials.host}`;
  const remoteSpec = `${destination}:${input.remotePath}`;
  const q = shellSingleQuote;

  const stdinBundle = input.encryptionKey
    ? `${credentials.privateKey.trim()}\n${KEY_BOUNDARY}\n${input.encryptionKey}\n`
    : `${credentials.privateKey.trim()}\n`;
  const splitPrelude = [
    `install -m 600 /dev/stdin ${combinedPath}`,
    `awk -v a=${keyPath} -v b=${encKeyPath} '/^${KEY_BOUNDARY}$/{s=1;next} s{print >> b} !s{print >> a}' ${combinedPath}`,
    `chmod 600 ${keyPath}; touch ${encKeyPath}; chmod 600 ${encKeyPath}`,
  ].join(" && ");
  const cleanup = `rm -f ${keyPath} ${encKeyPath} ${combinedPath} /tmp/tainer-hash-${suffix}`;

  let payload: string;
  let checksummed = false;

  if (input.direction === "push" && input.encryptionKey) {
    checksummed = true;
    payload = [
      "set -o pipefail",
      `openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -pass file:${encKeyPath} < ${q(input.localPath)} | tee >(sha256sum | cut -d\" \" -f1 > /tmp/tainer-hash-${suffix}) | ssh ${sshOptions} ${q(destination)} ${q(`dd of=${input.remotePath} bs=1M`)}`,
      `local_hash=$(cat /tmp/tainer-hash-${suffix})`,
      `remote_hash=$(ssh ${sshOptions} ${q(destination)} ${q(`sha256sum ${input.remotePath}`)} | cut -d" " -f1)`,
      `[ -n "$local_hash" ] && [ "$local_hash" = "$remote_hash" ]`,
    ].join(" && ");
  } else if (input.direction === "push") {
    checksummed = true;
    payload = [
      `rsync --inplace --timeout=120${bwlimit} -e ${q(`ssh ${sshOptions}`)} ${q(input.localPath)} ${q(remoteSpec)}`,
      `local_hash=$(sha256sum ${q(input.localPath)} | cut -d" " -f1)`,
      `remote_hash=$(ssh ${sshOptions} ${q(destination)} ${q(`sha256sum ${input.remotePath}`)} | cut -d" " -f1)`,
      `[ -n "$local_hash" ] && [ "$local_hash" = "$remote_hash" ]`,
    ].join(" && ");
  } else if (input.encryptionKey) {
    payload = [
      "set -o pipefail",
      `ssh ${sshOptions} ${q(destination)} ${q(`dd if=${input.remotePath} bs=1M`)} | openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -pass file:${encKeyPath} > ${q(input.localPath)}`,
    ].join(" && ");
  } else {
    payload = `rsync --inplace --timeout=120${bwlimit} -e ${q(`ssh ${sshOptions}`)} ${q(remoteSpec)} ${q(input.localPath)}`;
  }

  const remoteCommand = `${splitPrelude} && bash -c ${q(payload)}; rc=$?; ${cleanup}; exit $rc`;

  try {
    await runNodeRootCommand(input.node, remoteCommand, {
      input: stdinBundle,
      timeoutMs: TRANSFER_TIMEOUT_MS,
    });
    return checksummed;
  } catch (err) {
    if (checksummed && err instanceof Error && !err.message.trim()) {
      throw new Error("Transfer completed but the sha256 comparison failed.");
    }
    throw err;
  }
}

const RECONCILE_INTERVAL_MS = 60 * 60 * 1000;

export async function reconcileOffloads(
  policies: { id: string; name: string; storage: string; offloadEnabled: boolean; offloadRetentionCount: number }[],
): Promise<void> {
  const offloadPolicies = policies.filter((p) => p.offloadEnabled && p.storage);
  if (offloadPolicies.length === 0) return;

  const config = await getStorageBoxConfig();
  if (!config) return;

  const now = Date.now();
  if (now - (globalForOffload.__tainerLastReconcileAt ?? 0) < RECONCILE_INTERVAL_MS) return;
  globalForOffload.__tainerLastReconcileAt = now;

  try {
    const index = await readIndex();
    const { deployments } = await getDeploymentIndex();

    for (const policy of offloadPolicies) {
      for (const deployment of deployments) {
        const { archives } = await listBackupsForVm(deployment.node, deployment.vmid);
        const newest = archives
          .filter((a) => a.storage === policy.storage)
          .sort((a, b) => b.ctime - a.ctime)[0];
        if (!newest) continue;

        const archiveName = newest.volid.split("/").pop() ?? "";
        if (!archiveName || index.archives[archiveName]?.verified) continue;

        console.log(`[storage-box] Reconcile: backfilling ${archiveName}`);
        await scheduleArchiveOffload({
          node: deployment.node,
          policyId: policy.id,
          policyName: policy.name,
          remoteRetentionCount: policy.offloadRetentionCount,
          storage: policy.storage,
          trigger: "reconcile",
          vmid: deployment.vmid,
        });
      }
    }
  } catch (err) {
    console.error("[storage-box] Reconciliation failed:", err);
  }
}

export async function retrieveArchive(input: {
  archiveName: string;
  vmid: number;
  node: string;
  targetStorage: string;
}): Promise<string> {
  const config = await getStorageBoxConfig();
  if (!config) throw new Error("No Storage Box is connected for this site.");

  const archiveName = validateRemoteSegment(input.archiveName, "archive name");
  if (!ARCHIVE_NAME_PATTERN.test(archiveName)) {
    throw new Error("Invalid archive name.");
  }

  const storages = (await getStorageConfig()) as { storage?: string; path?: string }[];
  const target = storages.find((s) => s?.storage === input.targetStorage);
  if (!target) throw new Error(`Unknown storage "${input.targetStorage}".`);
  if (!target.path) {
    throw new Error(
      `Storage "${input.targetStorage}" is not file-based. Pick a directory storage for retrieval.`,
    );
  }

  const site = getActiveSiteConfig();
  const remoteDir = `${config.basePath}/${site.siteSlug}/${input.vmid}`;
  const localPath = `${target.path.replace(/\/+$/, "")}/dump/${archiveName}`;
  const credentials = await resolveBoxCredentials();

  const index = await readIndex();
  const encrypted = index.archives[archiveName]?.encrypted ?? false;
  if (encrypted && !config.encryptionKeyEncrypted) {
    throw new Error("This archive is encrypted but the encryption key is missing from the config.");
  }
  const remoteName = encrypted ? `${archiveName}.enc` : archiveName;

  const startedAt = Date.now();
  try {
    await runNodeRootCommand(input.node, `mkdir -p ${shellSingleQuote(`${target.path.replace(/\/+$/, "")}/dump`)}`);
    await transferFromNode({
      bandwidthLimitKbps: config.bandwidthLimitKbps ?? 0,
      credentials,
      direction: "pull",
      encryptionKey: encrypted ? await decryptText(config.encryptionKeyEncrypted as string) : null,
      localPath,
      node: input.node,
      remotePath: `${remoteDir}/${remoteName}`,
    });
    await appendLogEntry({
      archive: archiveName,
      durationSeconds: Math.round((Date.now() - startedAt) / 1000),
      kind: "retrieve",
      message: `Retrieved to ${input.node}:${localPath}`,
      policyId: null,
      policyName: null,
      remotePath: `${remoteDir}/${archiveName}`,
      sizeBytes: null,
      status: "success",
      vmid: input.vmid,
    });
    return localPath;
  } catch (err) {
    await appendLogEntry({
      archive: archiveName,
      durationSeconds: Math.round((Date.now() - startedAt) / 1000),
      kind: "retrieve",
      message: err instanceof Error ? err.message : "Retrieve failed",
      policyId: null,
      policyName: null,
      remotePath: `${remoteDir}/${archiveName}`,
      sizeBytes: null,
      status: "error",
      vmid: input.vmid,
    }).catch(() => {});
    throw err;
  }
}
