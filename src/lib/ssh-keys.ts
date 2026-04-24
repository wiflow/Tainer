import "server-only";

import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { getDataDirectoryPath, resolveDataFilePath } from "@/lib/app-data";
import { decryptText, encryptText } from "@/lib/crypto";
import { writeJsonFileAtomically } from "@/lib/store-utils";

const execFile = promisify(execFileCallback);

const SSH_AUTHORITY_FILE = "ssh-authority.json";
const OPENSSH_PUBLIC_KEY_REGEX = /^ssh-[A-Za-z0-9-]+ [A-Za-z0-9+/=]+(?: [^\r\n]+)?$/;
const MANAGED_LOGIN_USER = "tainer";

type StoredSshAuthority = {
  fingerprint: string;
  generatedAt: string;
  managedLoginUser: string;
  privateKeyEncrypted: string;
  publicKey: string;
};

export type SshKeyInfo = {
  fingerprint: string;
  generatedAt: string;
  managedLoginUser: string;
  publicKey: string;
};

function computeFingerprint(publicKeyOpenSSH: string) {
  const parts = publicKeyOpenSSH.split(" ");
  const keyData = Buffer.from(parts[1]!, "base64");
  const hash = createHash("sha256").update(keyData).digest("base64");
  return `SHA256:${hash.replace(/=+$/, "")}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidGeneratedAt(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isValidPublicKey(value: unknown): value is string {
  return isNonEmptyString(value) && OPENSSH_PUBLIC_KEY_REGEX.test(value.trim());
}

function parseStoredAuthority(raw: string): StoredSshAuthority | null {
  const parsed: unknown = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const candidate = parsed as Partial<Record<keyof StoredSshAuthority, unknown>>;

  if (
    !isNonEmptyString(candidate.fingerprint) ||
    !isValidGeneratedAt(candidate.generatedAt) ||
    !isNonEmptyString(candidate.managedLoginUser) ||
    !isNonEmptyString(candidate.privateKeyEncrypted) ||
    !isValidPublicKey(candidate.publicKey)
  ) {
    return null;
  }

  return {
    fingerprint: candidate.fingerprint.trim(),
    generatedAt: candidate.generatedAt.trim(),
    managedLoginUser: candidate.managedLoginUser.trim(),
    privateKeyEncrypted: candidate.privateKeyEncrypted,
    publicKey: candidate.publicKey.trim(),
  };
}

async function readStoredAuthority(): Promise<StoredSshAuthority | null> {
  try {
    const raw = await readFile(await resolveDataFilePath(SSH_AUTHORITY_FILE), "utf8");
    return parseStoredAuthority(raw);
  } catch {
    return null;
  }
}

async function generateAuthorityKeyPair() {
  await mkdir(getDataDirectoryPath(), { recursive: true });
  const tempDir = await mkdtemp(path.join(getDataDirectoryPath(), "ssh-ca-"));
  const keyPath = path.join(tempDir, "tainer_ca");

  try {
    await execFile("/usr/bin/ssh-keygen", [
      "-q",
      "-t",
      "ed25519",
      "-N",
      "",
      "-C",
      "tainer-guest-access-ca",
      "-f",
      keyPath,
    ]);

    const [publicKey, privateKey] = await Promise.all([
      readFile(`${keyPath}.pub`, "utf8"),
      readFile(keyPath, "utf8"),
    ]);

    return {
      privateKey: privateKey.trimEnd(),
      publicKey: publicKey.trim(),
    };
  } finally {
    await rm(tempDir, { force: true, recursive: true }).catch(() => {});
  }
}

export function getManagedLoginUser() {
  return MANAGED_LOGIN_USER;
}

export async function generateSshAccessAuthority(): Promise<SshKeyInfo> {
  const { privateKey, publicKey } = await generateAuthorityKeyPair();
  const fingerprint = computeFingerprint(publicKey);
  const generatedAt = new Date().toISOString();
  const encrypted = await encryptText(privateKey);

  const stored: StoredSshAuthority = {
    fingerprint,
    generatedAt,
    managedLoginUser: MANAGED_LOGIN_USER,
    privateKeyEncrypted: encrypted,
    publicKey,
  };

  const filePath = await resolveDataFilePath(SSH_AUTHORITY_FILE);
  await writeJsonFileAtomically(filePath, stored);

  return {
    fingerprint,
    generatedAt,
    managedLoginUser: MANAGED_LOGIN_USER,
    publicKey,
  };
}

export async function getSshAuthorityInfo(): Promise<SshKeyInfo | null> {
  const stored = await readStoredAuthority();
  if (!stored) return null;

  return {
    fingerprint: stored.fingerprint,
    generatedAt: stored.generatedAt,
    managedLoginUser: stored.managedLoginUser,
    publicKey: stored.publicKey,
  };
}

export async function getSshAuthorityPublicKey(): Promise<string | null> {
  const stored = await readStoredAuthority();
  return stored?.publicKey ?? null;
}

export async function getSshAuthorityPrivateKey(): Promise<string | null> {
  const stored = await readStoredAuthority();
  if (!stored) return null;

  try {
    return await decryptText(stored.privateKeyEncrypted);
  } catch {
    return null;
  }
}

export async function deleteSshAccessAuthority(): Promise<void> {
  try {
    const filePath = await resolveDataFilePath(SSH_AUTHORITY_FILE);
    await unlink(filePath);
  } catch {
    // File doesn't exist — nothing to delete
  }
}

// Legacy aliases to keep existing imports compiling while the UI copy shifts to
// the new SSH CA model.
export const deleteSshKeyPair = deleteSshAccessAuthority;
export const generateSshKeyPair = generateSshAccessAuthority;
export const getSshKeyInfo = getSshAuthorityInfo;
export const getSshPrivateKey = getSshAuthorityPrivateKey;
export const getSshPublicKey = getSshAuthorityPublicKey;
