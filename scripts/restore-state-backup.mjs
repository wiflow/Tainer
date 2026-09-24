#!/usr/bin/env node
// Format: "TAINERSB1" | salt(16) | iv(12) | AES-256-GCM(tar.gz) | tag(16), sizes in bytes.

import { createDecipheriv, scryptSync } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const MAGIC = "TAINERSB1";
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const [, , backupPath, targetDir] = process.argv;
if (!backupPath || !targetDir) {
  console.error("Usage: node scripts/restore-state-backup.mjs <backup.tsb> <target-dir>");
  process.exit(1);
}

async function getPassphrase() {
  const fromEnv = process.env.TAINER_BACKUP_PASSPHRASE?.trim();
  if (fromEnv) return fromEnv;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise((resolve) => rl.question("Backup passphrase: ", resolve));
  rl.close();
  return String(answer).trim();
}

const passphrase = await getPassphrase();
if (!passphrase) {
  console.error("A passphrase is required (TAINER_BACKUP_PASSPHRASE or interactive).");
  process.exit(1);
}

const raw = readFileSync(backupPath);
const headerLength = MAGIC.length + 16 + 12;
if (raw.length < headerLength + 16 || raw.subarray(0, MAGIC.length).toString("utf8") !== MAGIC) {
  console.error("Not a Tainer state backup (bad magic or truncated file).");
  process.exit(1);
}

const salt = raw.subarray(MAGIC.length, MAGIC.length + 16);
const iv = raw.subarray(MAGIC.length + 16, headerLength);
const ciphertext = raw.subarray(headerLength, raw.length - 16);
const authTag = raw.subarray(raw.length - 16);

const key = scryptSync(passphrase, salt, 32, SCRYPT_PARAMS);
const decipher = createDecipheriv("aes-256-gcm", key, iv);
decipher.setAuthTag(authTag);

let tarball;
try {
  tarball = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
} catch {
  console.error("Decryption failed — wrong passphrase or corrupted backup.");
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });
const result = spawnSync("tar", ["-xzf", "-", "-C", targetDir], {
  input: tarball,
  stdio: ["pipe", "inherit", "inherit"],
});
if (result.status !== 0) {
  console.error(`tar extraction failed (exit ${result.status}).`);
  process.exit(1);
}

console.error(`Restored to ${targetDir}. Point TAINER_DATA_DIR at it and start Tainer`);
console.error(`with the ORIGINAL instance's AUTH_SECRET so encrypted values decrypt.`);
