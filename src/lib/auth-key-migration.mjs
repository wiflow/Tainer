import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { access, chmod, copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const LEGACY_SECRET_FILE = "auth-secret.txt";
const AUDIT_LOG_FILE = "admin-audit-log.json";
const AUDIT_LOG_MAX_ENTRIES = 5000;
const KEY_MIGRATION_BACKUP_PREFIX = "pre-2.0-key-migration-";

const ENCRYPTED_PAYLOAD_RX = /^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/;
const ENCRYPTED_FIELD_NAMES = new Set([
  "encryptedBindPassword",
  "encryptedClientSecret",
  "encryptedCommunity",
  "encryptedKey",
  "encryptedToken",
  "encryptionKeyEncrypted",
  "hetznerTokenEncrypted",
  "passphraseEncrypted",
  "passwordEncrypted",
  "pendingTwoFactorSecret",
  "privateKeyEncrypted",
  "tokenSecretEncrypted",
  "twoFactorSecret",
]);

function encryptWithKey(key, value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptWithKey(key, value) {
  const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) return null;

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

function isMissing(error) {
  return error?.code === "ENOENT";
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listJsonFiles(dataDir, relativeDir) {
  let entries;
  try {
    entries = await readdir(path.join(dataDir, relativeDir), { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(relativeDir, entry.name));
}

async function listStoreFiles(dataDir) {
  const files = await listJsonFiles(dataDir, "");

  let siteDirs = [];
  try {
    siteDirs = await readdir(path.join(dataDir, "sites"), { withFileTypes: true });
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  for (const siteDir of siteDirs) {
    if (siteDir.isDirectory()) {
      files.push(...(await listJsonFiles(dataDir, path.join("sites", siteDir.name))));
    }
  }

  return files;
}

function reencryptValue(value, location, keys, stats) {
  const plaintext = decryptWithKey(keys.old, value);
  if (plaintext !== null) {
    stats.migrated += 1;
    return encryptWithKey(keys.next, plaintext);
  }

  if (decryptWithKey(keys.next, value) !== null) {
    stats.current += 1;
  } else {
    stats.failed.push(location);
  }
  return value;
}

function reencryptTree(node, location, keys, stats) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      const itemLocation = `${location}[${index}]`;
      if (typeof item === "string") {
        if (ENCRYPTED_PAYLOAD_RX.test(item)) node[index] = reencryptValue(item, itemLocation, keys, stats);
      } else {
        reencryptTree(item, itemLocation, keys, stats);
      }
    });
    return;
  }

  if (!node || typeof node !== "object") return;

  for (const [field, value] of Object.entries(node)) {
    const fieldLocation = location ? `${location}.${field}` : field;
    if (typeof value === "string") {
      if (ENCRYPTED_PAYLOAD_RX.test(value) || (value && ENCRYPTED_FIELD_NAMES.has(field))) {
        node[field] = reencryptValue(value, fieldLocation, keys, stats);
      }
    } else {
      reencryptTree(value, fieldLocation, keys, stats);
    }
  }
}

async function writeJsonFileAtomically(filePath, value, compact) {
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, compact ? undefined : 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(tempPath, 0o600);
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function backUpFiles(dataDir, backupDir, relativePaths) {
  await mkdir(backupDir, { mode: 0o700 });
  await chmod(backupDir, 0o700);

  for (const relativePath of relativePaths) {
    const target = path.join(backupDir, relativePath);
    const targetDir = path.dirname(target);
    if (targetDir !== backupDir) {
      await mkdir(targetDir, { mode: 0o700, recursive: true });
      for (let dir = targetDir; dir !== backupDir; dir = path.dirname(dir)) {
        await chmod(dir, 0o700);
      }
    }
    await copyFile(path.join(dataDir, relativePath), target);
    await chmod(target, 0o600);
  }
}

async function recordAuditEntry(dataDir, message) {
  const filePath = path.join(dataDir, AUDIT_LOG_FILE);
  let store = { entries: [] };
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    store = { ...parsed, entries: Array.isArray(parsed?.entries) ? parsed.entries : [] };
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  store.entries.unshift({
    action: "auth-key-migrated",
    actorEmail: "system",
    actorName: "Key migration",
    id: randomUUID(),
    message,
    recordedAt: new Date().toISOString(),
  });
  store.entries = store.entries.slice(0, AUDIT_LOG_MAX_ENTRIES);

  await writeJsonFileAtomically(filePath, store, false);
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export async function migrateLegacyAuthSecret({ dataDir, authSecret, log = (line) => console.error(line) }) {
  const secret = authSecret?.trim();
  if (!secret) return null;

  const secretPath = path.join(dataDir, LEGACY_SECRET_FILE);
  let rawSecret;
  try {
    rawSecret = await readFile(secretPath, "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw new Error(`Cannot read ${secretPath}: ${error.message}`);
  }

  const oldKey = Buffer.from(rawSecret.trim(), "base64");
  if (oldKey.length !== 32) {
    throw new Error(
      `${secretPath} does not hold a base64 encoded 32 byte key, so nothing can be migrated from it. ` +
        "Move it out of the data directory and start Tainer again.",
    );
  }
  const keys = { next: createHash("sha256").update(secret).digest(), old: oldKey };

  const reports = [];
  const skipped = [];
  const changes = [];
  for (const relativePath of await listStoreFiles(dataDir)) {
    const filePath = path.join(dataDir, relativePath);
    const text = await readFile(filePath, "utf8");
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      skipped.push(relativePath);
      continue;
    }

    const stats = { current: 0, failed: [], migrated: 0 };
    reencryptTree(data, "", keys, stats);
    if (stats.migrated + stats.current + stats.failed.length === 0) continue;

    reports.push({ file: relativePath, ...stats });
    if (stats.migrated > 0) {
      changes.push({ compact: !text.trimEnd().includes("\n"), data, filePath, relativePath });
    }
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const backupDir = path.join(dataDir, `${KEY_MIGRATION_BACKUP_PREFIX}${stamp}`);
  const backupList = [LEGACY_SECRET_FILE, ...changes.map((change) => change.relativePath)];
  if (await exists(path.join(dataDir, AUDIT_LOG_FILE))) backupList.push(AUDIT_LOG_FILE);

  try {
    await backUpFiles(dataDir, backupDir, backupList);
  } catch (error) {
    throw new Error(
      `Could not back up the data directory to ${backupDir} (${error.message}). Nothing was changed; ` +
        `${LEGACY_SECRET_FILE} is still in place and the next start tries again.`,
    );
  }

  for (const change of changes) {
    try {
      await writeJsonFileAtomically(change.filePath, change.data, change.compact);
    } catch (error) {
      throw new Error(
        `Could not write ${change.relativePath} (${error.message}). ${LEGACY_SECRET_FILE} is still in place and ` +
          `the next start finishes the migration. The original files are in ${backupDir}.`,
      );
    }
  }

  const totals = reports.reduce(
    (sum, report) => ({
      current: sum.current + report.current,
      failed: sum.failed + report.failed.length,
      migrated: sum.migrated + report.migrated,
    }),
    { current: 0, failed: 0, migrated: 0 },
  );

  let auditRecorded = true;
  try {
    await recordAuditEntry(
      dataDir,
      `Re-encrypted ${plural(totals.migrated, "stored secret")} from ${LEGACY_SECRET_FILE} with AUTH_SECRET; ` +
        `${totals.failed} could not be decrypted. Backup: ${path.basename(backupDir)}.`,
    );
  } catch {
    auditRecorded = false;
  }

  let secretRemoved = true;
  try {
    await rm(secretPath);
  } catch {
    secretRemoved = false;
  }

  const lines = [
    `[auth-key-migration] Found ${LEGACY_SECRET_FILE} from an earlier version and re-encrypted its stored secrets with AUTH_SECRET.`,
  ];
  for (const report of reports) {
    const parts = [`${report.migrated} migrated`];
    if (report.current) parts.push(`${report.current} already on AUTH_SECRET`);
    if (report.failed.length) parts.push(`${report.failed.length} failed (${report.failed.join(", ")})`);
    lines.push(`  ${report.file}: ${parts.join(", ")}`);
  }
  if (reports.length === 0) lines.push("  No encrypted values found.");
  lines.push(
    `  Total: ${totals.migrated} migrated, ${totals.current} already on AUTH_SECRET, ${totals.failed} failed.`,
  );
  if (totals.failed) {
    lines.push(
      "  Failed values decrypt with neither key and were left untouched. Enter those secrets again, " +
        "and reset 2FA for affected users (they can still sign in with a recovery code).",
    );
  }
  if (skipped.length) lines.push(`  Skipped files that are not valid JSON: ${skipped.join(", ")}`);
  lines.push(`  Backup of the original files and the old key: ${backupDir}`);
  lines.push(
    "  The backup contains the old key. Delete it once sign-in and every site have been checked.",
  );
  if (!auditRecorded) lines.push(`  Could not add the audit log entry to ${AUDIT_LOG_FILE}.`);
  if (!secretRemoved) {
    lines.push(`  Could not remove ${secretPath}. Delete it by hand; the backup keeps a copy.`);
  }
  log(lines.join("\n"));

  return { auditRecorded, backupDir, reports, secretRemoved, skipped, totals };
}
