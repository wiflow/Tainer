import "server-only";

import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { getDataDirectoryPath } from "@/lib/app-data";
import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { decryptText, encryptText } from "@/lib/crypto";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

const execFile = promisify(execFileCallback);

const GENERATED_DEPLOYMENT_SSH_KEYS_FILE = "deployment-ssh-keys.json";
const OPENSSH_PUBLIC_KEY_REGEX = /^ssh-[A-Za-z0-9-]+ [A-Za-z0-9+/=]+(?: [^\r\n]+)?$/;

type StoredGeneratedDeploymentSshKey = {
  createdAt: string;
  deploymentId: string;
  fileName: string;
  fingerprint: string;
  loginUser: string;
  privateKeyEncrypted: string;
  publicKey: string;
};

type GeneratedDeploymentSshKeyStore = {
  entries: StoredGeneratedDeploymentSshKey[];
};

export type DeploymentSshKeyMode = "generated" | "uploaded";

type BaseProvisionedDeploymentSshKey = {
  createdAt: string;
  fingerprint: string;
  loginUser: string;
  publicKey: string;
};

export type ProvisionedDeploymentSshKey =
  | (BaseProvisionedDeploymentSshKey & {
      mode: "generated";
      privateKey: string;
    })
  | (BaseProvisionedDeploymentSshKey & {
      mode: "uploaded";
    });

export type GeneratedDeploymentSshKeyInfo = {
  createdAt: string;
  fileName: string;
  fingerprint: string;
  loginUser: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidPublicKey(value: unknown): value is string {
  return isNonEmptyString(value) && OPENSSH_PUBLIC_KEY_REGEX.test(value.trim());
}

function sanitizeFileStem(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "tainer-ssh-key";
}

function computeFingerprint(publicKey: string) {
  const parts = publicKey.trim().split(" ");
  const keyData = Buffer.from(parts[1]!, "base64");
  const hash = createHash("sha256").update(keyData).digest("base64");
  return `SHA256:${hash.replace(/=+$/, "")}`;
}

function normalizePublicKey(publicKey: string) {
  const normalized = publicKey.trim();

  if (!isValidPublicKey(normalized)) {
    throw new Error("SSH public key must be a single-line OpenSSH key.");
  }

  return normalized;
}

function parseStore(raw: string): GeneratedDeploymentSshKeyStore {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { entries: [] };
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { entries?: unknown }).entries)) {
    return { entries: [] };
  }

  const entries = (parsed as { entries: unknown[] }).entries
    .filter((entry): entry is StoredGeneratedDeploymentSshKey => {
      if (!entry || typeof entry !== "object") {
        return false;
      }

      const candidate = entry as Partial<StoredGeneratedDeploymentSshKey>;
      return (
        isNonEmptyString(candidate.createdAt) &&
        !Number.isNaN(Date.parse(candidate.createdAt)) &&
        isNonEmptyString(candidate.deploymentId) &&
        isNonEmptyString(candidate.fileName) &&
        isNonEmptyString(candidate.fingerprint) &&
        isNonEmptyString(candidate.loginUser) &&
        isNonEmptyString(candidate.privateKeyEncrypted) &&
        isValidPublicKey(candidate.publicKey)
      );
    })
    .map((entry) => ({
      createdAt: entry.createdAt.trim(),
      deploymentId: entry.deploymentId.trim(),
      fileName: entry.fileName.trim(),
      fingerprint: entry.fingerprint.trim(),
      loginUser: entry.loginUser.trim(),
      privateKeyEncrypted: entry.privateKeyEncrypted,
      publicKey: entry.publicKey.trim(),
    }));

  return { entries };
}

async function readStore(): Promise<GeneratedDeploymentSshKeyStore> {
  try {
    const raw = await readFile(await resolveSiteDataFilePathFromContext(GENERATED_DEPLOYMENT_SSH_KEYS_FILE), "utf8");
    return parseStore(raw);
  } catch {
    return { entries: [] };
  }
}

async function writeStore(store: GeneratedDeploymentSshKeyStore) {
  await writeJsonFileAtomically(await resolveSiteDataFilePathFromContext(GENERATED_DEPLOYMENT_SSH_KEYS_FILE), store);
}

const mutateStore = createStoreMutator("deployment-ssh-keys", readStore, writeStore);

async function generateOpenSshKeyPair(comment: string) {
  const tempDir = await mkdtemp(path.join(getDataDirectoryPath(), "deploy-ssh-"));
  const keyPath = path.join(tempDir, "id_ed25519");

  try {
    await execFile("/usr/bin/ssh-keygen", [
      "-q",
      "-t",
      "ed25519",
      "-N",
      "",
      "-C",
      comment,
      "-f",
      keyPath,
    ]);

    const [privateKey, publicKey] = await Promise.all([
      readFile(keyPath, "utf8"),
      readFile(`${keyPath}.pub`, "utf8"),
    ]);

    return {
      privateKey: privateKey.trimEnd(),
      publicKey: normalizePublicKey(publicKey),
    };
  } finally {
    await rm(tempDir, { force: true, recursive: true }).catch(() => {});
  }
}

export async function buildProvisionedDeploymentSshKey(input: {
  deploymentLabel: string;
  loginUser: string;
  mode: string;
  publicKey?: string;
}) {
  const loginUser = input.loginUser.trim() || "root";
  const mode = input.mode.trim();
  const deploymentLabel = input.deploymentLabel.trim() || "tainer";
  const comment = `tainer-${sanitizeFileStem(deploymentLabel)}`;

  if (mode === "generate") {
    const keyPair = await generateOpenSshKeyPair(comment);

    return {
      createdAt: new Date().toISOString(),
      fingerprint: computeFingerprint(keyPair.publicKey),
      loginUser,
      mode: "generated" as const,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
    };
  }

  if (mode === "upload") {
    const normalizedPublicKey = normalizePublicKey(input.publicKey ?? "");

    return {
      createdAt: new Date().toISOString(),
      fingerprint: computeFingerprint(normalizedPublicKey),
      loginUser,
      mode: "uploaded" as const,
      publicKey: normalizedPublicKey,
    };
  }

  return null;
}

export async function saveGeneratedDeploymentSshKey(input: {
  deploymentId: string;
  fileStem: string;
  key: Extract<ProvisionedDeploymentSshKey, { mode: "generated"; privateKey: string }>;
}) {
  const entry: StoredGeneratedDeploymentSshKey = {
    createdAt: input.key.createdAt,
    deploymentId: input.deploymentId,
    fileName: `${sanitizeFileStem(input.fileStem)}.ed25519`,
    fingerprint: input.key.fingerprint,
    loginUser: input.key.loginUser,
    privateKeyEncrypted: await encryptText(input.key.privateKey),
    publicKey: input.key.publicKey,
  };

  await mutateStore(async (store) => {
    store.entries = store.entries.filter((candidate) => candidate.deploymentId !== input.deploymentId);
    store.entries.push(entry);
  });
}

export async function getGeneratedDeploymentSshKeyInfo(deploymentId: string): Promise<GeneratedDeploymentSshKeyInfo | null> {
  const store = await readStore();
  const entry = store.entries.find((candidate) => candidate.deploymentId === deploymentId);

  if (!entry) {
    return null;
  }

  return {
    createdAt: entry.createdAt,
    fileName: entry.fileName,
    fingerprint: entry.fingerprint,
    loginUser: entry.loginUser,
  };
}

export async function getGeneratedDeploymentSshPrivateKey(deploymentId: string) {
  const store = await readStore();
  const entry = store.entries.find((candidate) => candidate.deploymentId === deploymentId);

  if (!entry) {
    return null;
  }

  return {
    fileName: entry.fileName,
    fingerprint: entry.fingerprint,
    loginUser: entry.loginUser,
    privateKey: await decryptText(entry.privateKeyEncrypted),
  };
}

export async function deleteGeneratedDeploymentSshKey(deploymentId: string) {
  await mutateStore(async (store) => {
    store.entries = store.entries.filter((candidate) => candidate.deploymentId !== deploymentId);
  });
}
