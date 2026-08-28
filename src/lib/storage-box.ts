import "server-only";

import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { decryptText, encryptText } from "@/lib/crypto";
import { runNodeRootCommand } from "@/lib/proxmox-host";
import { getActiveSiteConfig, getStorageConfig, listBackupsForVm } from "@/lib/proxmox";
import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { runSshCommand } from "@/lib/ssh-command";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

/**
 * Hetzner Storage Box integration — off-site backup target.
 *
 * All SSH-based Storage Box services (SSH, SFTP, SCP, rsync) listen on
 * port 23. The box offers no shell: commands from a whitelist (ls, mkdir,
 * rm, df, install-ssh-key, …) are executed directly, so every remote call
 * here uses `raw` mode. Transfers run on the Proxmox node that holds the
 * archive; the panel only orchestrates.
 */

export const STORAGE_BOX_SSH_PORT = 23;

/** Panel- and node-side host key handling for *.your-storagebox.de. */
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
  /** Remote base directory (single path segment) for offloaded archives. */
  basePath: string;
  /** OpenSSH-format public key installed on the box for transfers. */
  publicKey: string | null;
  privateKeyEncrypted: string | null;
  keyInstalled: boolean;
  cifsStorageId: string | null;
  /** Hetzner Console API token (Bearer), sealed. Enables box management. */
  hetznerTokenEncrypted: string | null;
  /** The box's numeric id on api.hetzner.com, matched by hostname. */
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

/** Secret-free view for pages and client components. */
export type StorageBoxSummary = {
  configured: boolean;
  host: string;
  username: string;
  basePath: string;
  keyInstalled: boolean;
  cifsStorageId: string | null;
  hetznerConnected: boolean;
  hetznerBoxId: number | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string;
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

/* ── Config store ─────────────────────────────────────────────────────────── */

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
      basePath: "tainer-offsite",
      cifsStorageId: null,
      configured: false,
      hetznerBoxId: null,
      hetznerConnected: false,
      host: "",
      keyInstalled: false,
      lastTestMessage: "",
      lastTestOk: null,
      lastTestedAt: null,
      username: "",
    };
  }
  return {
    basePath: config.basePath,
    cifsStorageId: config.cifsStorageId,
    configured: true,
    hetznerBoxId: config.hetznerBoxId ?? null,
    hetznerConnected: Boolean(config.hetznerTokenEncrypted),
    host: config.host,
    keyInstalled: config.keyInstalled,
    lastTestMessage: config.lastTestMessage,
    lastTestOk: config.lastTestOk,
    lastTestedAt: config.lastTestedAt,
    username: config.username,
  };
}

/* ── Offload log ──────────────────────────────────────────────────────────── */

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

/* ── Box SSH plumbing ─────────────────────────────────────────────────────── */

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

/** Run a whitelisted command on the box (no shell — raw mode). */
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

/** `mkdir` each missing path level; the box's mkdir has no -p flag. */
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
  // Expected df-style output; numbers are 1K blocks on Hetzner boxes.
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

/* ── Connect / test ───────────────────────────────────────────────────────── */

function generateBoxKeyPair(comment: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  // OpenSSH public key line from the SPKI DER: the raw ed25519 key is the
  // final 32 bytes. Wire format: string "ssh-ed25519" + string key.
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
    // OpenSSH ≥ 7.8 accepts PKCS#8 PEM private keys directly.
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyLine: `ssh-ed25519 ${wire.toString("base64")} ${comment}`,
  };
}

export async function connectStorageBox(input: {
  host: string;
  username: string;
  password: string;
  basePath: string;
}): Promise<StorageBoxSummary> {
  const host = validateHost(input.host);
  const username = validateUsername(input.username);
  const basePath = validateBasePath(input.basePath);
  const password = input.password;
  if (!password) throw new Error("The Storage Box password is required to connect.");

  const site = getActiveSiteConfig();
  const passwordCredentials: BoxCredentials = { host, password, privateKey: null, username };

  // 1. Prove the credentials work at all.
  const dfOutput = await runBoxCommand(passwordCredentials, "df");

  // 2. Generate a dedicated transfer key and install it via the box's
  //    built-in `install-ssh-key` helper (reads the key from stdin).
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

  // 3. Create the base directory.
  await ensureRemoteDirectory(passwordCredentials, basePath);

  const timestamp = new Date().toISOString();
  const usage = parseDfOutput(dfOutput);
  const config: StorageBoxConfig = {
    basePath,
    cifsStorageId: null,
    createdAt: timestamp,
    hetznerBoxId: null,
    hetznerTokenEncrypted: null,
    host,
    keyInstalled,
    lastTestMessage: usage.totalBytes
      ? `Connected — ${(usage.usedBytes ?? 0) / 1024 ** 3 < 1 ? "<1" : Math.round((usage.usedBytes ?? 0) / 1024 ** 3)} of ${Math.round(usage.totalBytes / 1024 ** 3)} GiB used`
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
          hetznerBoxId: existing.hetznerBoxId ?? null,
          hetznerTokenEncrypted: existing.hetznerTokenEncrypted ?? null,
        }
      : config;
  });

  return getStorageBoxSummary();
}

/* ── Hetzner Console API token ────────────────────────────────────────────── */

/**
 * Seal a Hetzner Console API token and match the connected box by hostname.
 * The token enables management (services, snapshots, usage) via
 * api.hetzner.com — see hetzner-storage-api.ts.
 */
export async function setHetznerApiToken(token: string): Promise<{ boxId: number; boxName: string }> {
  const config = await getStorageBoxConfig();
  if (!config) throw new Error("Connect the Storage Box first.");
  if (!token.trim()) throw new Error("An API token is required.");

  const { listHetznerStorageBoxes } = await import("@/lib/hetzner-storage-api");
  const boxes = await listHetznerStorageBoxes(token.trim());
  if (boxes.length === 0) {
    throw new Error("The token is valid but no Storage Boxes are visible to it.");
  }

  // Match by hostname: the box `server` is uXXXXX.your-storagebox.de and
  // sub-account hosts share the main account's prefix.
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

/** Decrypted token + box id, or null when the API is not connected. */
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
        ? `Reachable — ${formatGiB(usage.usedBytes ?? 0)} of ${formatGiB(usage.totalBytes)} GiB used`
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

/* ── Remote listing ───────────────────────────────────────────────────────── */

export type RemoteArchive = {
  name: string;
  vmid: number;
  remoteDir: string;
};

/** Enumerate offloaded archives under basePath/<siteSlug>/<vmid>/. */
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
    return []; // site directory does not exist yet
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
      // unreadable vmid dir — skip
    }
  }

  return archives.sort((a, b) => b.name.localeCompare(a.name));
}

/* ── Offload (node → box) ─────────────────────────────────────────────────── */

const globalForOffload = globalThis as typeof globalThis & {
  __tainerOffloadQueue?: Promise<void>;
  __tainerOffloadActive?: number;
};

/**
 * Serialize transfers process-wide: one WAN copy at a time, mirroring the
 * backup engine's one-VM-at-a-time rule. The site context captured at
 * enqueue time propagates into the continuation (AsyncLocalStorage).
 */
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

/**
 * Copy the newest archive of a VM on the given storage to the Storage Box,
 * then prune remote copies beyond `remoteRetentionCount` (0 keeps all).
 * Fire-and-forget: the transfer runs on the offload queue.
 */
export async function scheduleArchiveOffload(input: {
  node: string;
  vmid: number;
  storage: string;
  policyId: string;
  policyName: string;
  remoteRetentionCount: number;
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

      // Resolve the archive's absolute path on the node.
      const localPath = (
        await runNodeRootCommand(input.node, `pvesm path ${shellSingleQuote(newest.volid)}`)
      ).trim();
      if (!localPath.startsWith("/")) {
        throw new Error(`Could not resolve a filesystem path for ${newest.volid}.`);
      }

      const credentials = await resolveBoxCredentials();
      await ensureRemoteDirectory(credentials, remoteDir);

      await transferFromNode({
        credentials,
        direction: "push",
        localPath,
        node: input.node,
        remotePath: `${remoteDir}/${archiveName}`,
      });

      await appendLogEntry({
        archive: archiveName,
        durationSeconds: Math.round((Date.now() - startedAt) / 1000),
        kind: "offload",
        message: `Offloaded to ${config.host}:${remoteDir}`,
        policyId: input.policyId,
        policyName: input.policyName,
        remotePath: `${remoteDir}/${archiveName}`,
        sizeBytes: newest.sizeBytes ?? null,
        status: "success",
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
    }
  });
}

async function pruneRemoteArchives(
  credentials: BoxCredentials,
  remoteDir: string,
  keepCount: number,
  vmid: number,
) {
  // vzdump file names embed the timestamp, so lexicographic order is
  // chronological within one VMID directory.
  const names = (await runBoxCommand(credentials, `ls ${shellSingleQuote(remoteDir)}`))
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => ARCHIVE_NAME_PATTERN.test(s))
    .sort()
    .reverse();

  for (const name of names.slice(keepCount)) {
    try {
      await runBoxCommand(credentials, `rm ${shellSingleQuote(`${remoteDir}/${name}`)}`);
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

/**
 * Run rsync on the Proxmox node, pushing to or pulling from the box with
 * the transfer key. The key is written to a root-only temp file for the
 * duration of the command and removed afterwards.
 */
async function transferFromNode(input: {
  credentials: BoxCredentials;
  direction: "push" | "pull";
  localPath: string;
  node: string;
  remotePath: string;
}) {
  const { credentials } = input;
  if (!credentials.privateKey) {
    throw new Error(
      "Transfers require the SSH key installed during connect. Reconnect the Storage Box to install it.",
    );
  }

  const keyPath = `/root/.tainer-offsite-${createHash("sha256").update(input.remotePath).digest("hex").slice(0, 8)}.key`;
  const sshOptions = `-p ${STORAGE_BOX_SSH_PORT} -i ${keyPath} -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o IdentitiesOnly=yes`;
  const remote = `${credentials.username}@${credentials.host}:${input.remotePath}`;
  const source = input.direction === "push" ? shellSingleQuote(input.localPath) : shellSingleQuote(remote);
  const target = input.direction === "push" ? shellSingleQuote(remote) : shellSingleQuote(input.localPath);

  const remoteCommand = [
    `install -m 600 /dev/stdin ${keyPath}`,
    `rsync --inplace --timeout=120 -e ${shellSingleQuote(`ssh ${sshOptions}`)} ${source} ${target}; rc=$?`,
    `rm -f ${keyPath}`,
    `exit $rc`,
  ].join(" && ");

  await runNodeRootCommand(input.node, remoteCommand, {
    input: credentials.privateKey,
    timeoutMs: TRANSFER_TIMEOUT_MS,
  });
}

/* ── Retrieve (box → node) ────────────────────────────────────────────────── */

/**
 * Pull an offloaded archive back onto a node's file-based backup storage so
 * Proxmox can restore from it natively. Returns the local path written.
 */
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
      `Storage "${input.targetStorage}" is not file-based — pick a directory storage for retrieval.`,
    );
  }

  const site = getActiveSiteConfig();
  const remoteDir = `${config.basePath}/${site.siteSlug}/${input.vmid}`;
  const localPath = `${target.path.replace(/\/+$/, "")}/dump/${archiveName}`;
  const credentials = await resolveBoxCredentials();

  const startedAt = Date.now();
  try {
    await runNodeRootCommand(input.node, `mkdir -p ${shellSingleQuote(`${target.path.replace(/\/+$/, "")}/dump`)}`);
    await transferFromNode({
      credentials,
      direction: "pull",
      localPath,
      node: input.node,
      remotePath: `${remoteDir}/${archiveName}`,
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
