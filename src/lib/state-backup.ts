import "server-only";

import { spawn } from "node:child_process";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, appendFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { getDataDirectoryPath, resolveDataFilePath } from "@/lib/app-data";
import { decryptText, encryptText } from "@/lib/crypto";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

/**
 * Backs up Tainer's OWN state — the data directory holding users, sessions,
 * 2FA secrets, encrypted site credentials, audit log, IP pools, policies —
 * as a single passphrase-encrypted archive. Tainer backs up guests; this
 * backs up Tainer.
 *
 * File format (.tsb): MAGIC(9) | salt(16) | iv(12) | AES-256-GCM(tar.gz) | tag(16).
 * The key is scrypt(passphrase, salt) — restoring needs only the passphrase
 * and `scripts/restore-state-backup.mjs`, deliberately NOT AUTH_SECRET, so a
 * total host loss stays recoverable.
 */

const DATA_FILE = "state-backup.json";
const MAGIC = Buffer.from("TAINERSB1", "utf8"); // 9 bytes
const FILE_PREFIX = "tainer-state-";
const FILE_SUFFIX = ".tsb";
const FILE_RX = /^tainer-state-[0-9T]{15}Z\.tsb$/;

// Top-level data-dir entries that never belong in a state backup: previous
// backups (recursion) and the Docker image library (large and re-pullable).
const EXCLUDED_ENTRIES = new Set(["state-backups", "docker-library"]);

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export type StateBackupLastRun = {
  at: string;
  ok: boolean;
  message: string;
  file: string | null;
  sizeBytes: number | null;
  trigger: "manual" | "scheduled";
};

export type StateBackupConfig = {
  enabled: boolean;
  /** UTC hour (0-23) after which the daily scheduled backup runs. */
  scheduleHourUtc: number;
  /** How many backup files to keep in the destination. */
  retention: number;
  /** Absolute destination directory; empty = <data>/state-backups. */
  destinationDir: string;
  /** AES-encrypted (AUTH_SECRET root) so the scheduler can run unattended. */
  passphraseEncrypted: string | null;
  updatedAt: string | null;
  lastRun: StateBackupLastRun | null;
};

const DEFAULT_CONFIG: StateBackupConfig = {
  enabled: false,
  scheduleHourUtc: 3,
  retention: 7,
  destinationDir: "",
  passphraseEncrypted: null,
  updatedAt: null,
  lastRun: null,
};

async function readConfig(): Promise<StateBackupConfig> {
  try {
    const raw = await readFile(await resolveDataFilePath(DATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<StateBackupConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      scheduleHourUtc:
        typeof parsed.scheduleHourUtc === "number" &&
        parsed.scheduleHourUtc >= 0 &&
        parsed.scheduleHourUtc <= 23
          ? Math.round(parsed.scheduleHourUtc)
          : DEFAULT_CONFIG.scheduleHourUtc,
      retention:
        typeof parsed.retention === "number" && parsed.retention >= 1
          ? Math.min(60, Math.round(parsed.retention))
          : DEFAULT_CONFIG.retention,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function writeConfig(config: StateBackupConfig) {
  await writeJsonFileAtomically(await resolveDataFilePath(DATA_FILE), config);
}

const mutateConfig = createStoreMutator("state-backup", readConfig, writeConfig);

export async function getStateBackupConfig(): Promise<StateBackupConfig> {
  return readConfig();
}

export function hasStateBackupPassphrase(config: StateBackupConfig): boolean {
  return Boolean(config.passphraseEncrypted);
}

export async function saveStateBackupConfig(input: {
  enabled: boolean;
  scheduleHourUtc: number;
  retention: number;
  destinationDir: string;
  /** New passphrase; null/empty keeps the existing one. */
  passphrase: string | null;
}): Promise<StateBackupConfig> {
  const passphraseEncrypted = input.passphrase?.trim()
    ? await encryptText(input.passphrase.trim())
    : null;
  return mutateConfig((config) => {
    config.enabled = input.enabled;
    config.scheduleHourUtc = Math.max(0, Math.min(23, Math.round(input.scheduleHourUtc)));
    config.retention = Math.max(1, Math.min(60, Math.round(input.retention)));
    config.destinationDir = input.destinationDir.trim();
    if (passphraseEncrypted) config.passphraseEncrypted = passphraseEncrypted;
    config.updatedAt = new Date().toISOString();
    return config;
  });
}

export function resolveDestinationDir(config: StateBackupConfig): string {
  return config.destinationDir.trim() || path.join(getDataDirectoryPath(), "state-backups");
}

export type StateBackupFile = {
  name: string;
  sizeBytes: number;
  createdAt: string;
};

export async function listStateBackups(
  config?: StateBackupConfig,
): Promise<StateBackupFile[]> {
  const destination = resolveDestinationDir(config ?? (await readConfig()));
  let names: string[];
  try {
    names = await readdir(destination);
  } catch {
    return [];
  }
  const files = await Promise.all(
    names
      .filter((name) => FILE_RX.test(name))
      .map(async (name): Promise<StateBackupFile | null> => {
        try {
          const info = await stat(path.join(destination, name));
          return {
            name,
            sizeBytes: info.size,
            createdAt: info.mtime.toISOString(),
          };
        } catch {
          return null;
        }
      }),
  );
  return files
    .filter((f): f is StateBackupFile => f !== null)
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Validated join so the download route can't be walked out of the dir. */
export function resolveBackupFilePath(destination: string, name: string): string {
  if (!FILE_RX.test(name)) {
    throw new Error("Invalid backup file name.");
  }
  return path.join(destination, name);
}

export type StateBackupResult = {
  ok: boolean;
  message: string;
  file: string | null;
  sizeBytes: number | null;
};

let backupInFlight = false;

export async function createStateBackup(
  trigger: "manual" | "scheduled",
): Promise<StateBackupResult> {
  if (backupInFlight) {
    return { ok: false, message: "A state backup is already running.", file: null, sizeBytes: null };
  }
  backupInFlight = true;
  try {
    const result = await runBackup();
    await mutateConfig((config) => {
      config.lastRun = {
        at: new Date().toISOString(),
        ok: result.ok,
        message: result.message,
        file: result.file,
        sizeBytes: result.sizeBytes,
        trigger,
      };
      return config;
    });
    return result;
  } finally {
    backupInFlight = false;
  }
}

async function runBackup(): Promise<StateBackupResult> {
  const config = await readConfig();
  if (!config.passphraseEncrypted) {
    return {
      ok: false,
      message: "No backup passphrase set — configure one in Settings first.",
      file: null,
      sizeBytes: null,
    };
  }
  const passphrase = await decryptText(config.passphraseEncrypted);

  const dataDir = getDataDirectoryPath();
  const destination = resolveDestinationDir(config);
  await mkdir(destination, { recursive: true });
  const destinationResolved = path.resolve(destination);

  // Explicit top-level entry list instead of tar --exclude patterns —
  // deterministic across tar implementations, and it lets us skip the
  // destination dir wherever the operator pointed it.
  const entries = (await readdir(dataDir)).filter((entry) => {
    if (EXCLUDED_ENTRIES.has(entry)) return false;
    const entryResolved = path.resolve(dataDir, entry);
    if (destinationResolved === entryResolved) return false;
    if (destinationResolved.startsWith(`${entryResolved}${path.sep}`)) return false;
    return true;
  });
  if (entries.length === 0) {
    return { ok: false, message: "Data directory is empty — nothing to back up.", file: null, sizeBytes: null };
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const fileName = `${FILE_PREFIX}${stamp}${FILE_SUFFIX}`;
  const finalPath = path.join(destination, fileName);
  const partialPath = `${finalPath}.partial`;

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, SCRYPT_PARAMS);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const tar = spawn("tar", ["-czf", "-", "-C", dataDir, ...entries], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let tarStderr = "";
  tar.stderr.on("data", (chunk: Buffer) => {
    tarStderr += chunk.toString("utf8").slice(0, 500);
  });
  // Attach before the pipeline drains — a fast tar can close before a
  // listener registered afterwards would ever fire.
  const tarExit = new Promise<number>((resolve) =>
    tar.on("close", (code) => resolve(code ?? 1)),
  );

  try {
    const out = createWriteStream(partialPath, { mode: 0o600 });
    out.write(MAGIC);
    out.write(salt);
    out.write(iv);
    await pipeline(tar.stdout, cipher, out);

    const exitCode = await tarExit;
    if (exitCode !== 0) {
      throw new Error(`tar exited with code ${exitCode}: ${tarStderr.trim()}`);
    }

    await appendFile(partialPath, cipher.getAuthTag());
    await rename(partialPath, finalPath);
    const info = await stat(finalPath);

    await pruneOldBackups(destination, config.retention);

    return {
      ok: true,
      message: `Backed up ${entries.length} top-level entries.`,
      file: fileName,
      sizeBytes: info.size,
    };
  } catch (error) {
    tar.kill();
    await rm(partialPath, { force: true }).catch(() => {});
    return {
      ok: false,
      message: error instanceof Error ? error.message : "State backup failed.",
      file: null,
      sizeBytes: null,
    };
  }
}

async function pruneOldBackups(destination: string, retention: number) {
  const files = await listStateBackups({
    ...DEFAULT_CONFIG,
    destinationDir: destination,
  });
  for (const file of files.slice(retention)) {
    await rm(path.join(destination, file.name), { force: true }).catch(() => {});
  }
}

/**
 * Scheduler hook — runs at most one scheduled backup per UTC day, once the
 * configured hour has passed. Called from the alert scheduler's 30s tick.
 */
export async function runStateBackupTick(): Promise<{ ran: boolean; error: string | null }> {
  const config = await readConfig();
  if (!config.enabled || !config.passphraseEncrypted) return { ran: false, error: null };

  const now = new Date();
  if (now.getUTCHours() < config.scheduleHourUtc) return { ran: false, error: null };

  const today = now.toISOString().slice(0, 10);
  const lastScheduled =
    config.lastRun?.trigger === "scheduled" ? config.lastRun.at.slice(0, 10) : null;
  // A failed scheduled attempt still counts for today — retrying every 30s
  // against a persistent failure (bad destination, full disk) would thrash.
  if (lastScheduled === today) return { ran: false, error: null };

  const result = await createStateBackup("scheduled");
  return { ran: true, error: result.ok ? null : result.message };
}
