import "server-only";

import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { writeJsonFileAtomically } from "@/lib/store-utils";

const execFile = promisify(execFileCallback);

const GUEST_HOST_KEYS_FILE = "guest-host-keys.json";
const HOST_KEY_ALGORITHMS = ["ssh-ed25519", "ecdsa-sha2-nistp256", "ssh-rsa"] as const;

type GuestHostKeyRecord = {
  host: string;
  knownHostsLine: string;
  node: string;
  pinnedAt: string;
  publicKey: string;
  type: "lxc" | "qemu";
  vmid: number;
};

type GuestHostKeyStore = {
  entries: GuestHostKeyRecord[];
};

export type GuestHostKeyInfo = {
  fingerprint: string;
  host: string;
  knownHostsLine: string;
  pinnedAt: string;
};

function defaultStore(): GuestHostKeyStore {
  return { entries: [] };
}

function isValidRecord(value: unknown): value is GuestHostKeyRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<Record<keyof GuestHostKeyRecord, unknown>>;
  return (
    typeof record.host === "string" &&
    typeof record.knownHostsLine === "string" &&
    typeof record.node === "string" &&
    typeof record.pinnedAt === "string" &&
    typeof record.publicKey === "string" &&
    (record.type === "lxc" || record.type === "qemu") &&
    typeof record.vmid === "number"
  );
}

async function readStore(): Promise<GuestHostKeyStore> {
  try {
    const raw = await readFile(await resolveSiteDataFilePathFromContext(GUEST_HOST_KEYS_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<GuestHostKeyStore>;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries.filter(isValidRecord) : [],
    };
  } catch {
    return defaultStore();
  }
}

async function writeStore(store: GuestHostKeyStore) {
  const filePath = await resolveSiteDataFilePathFromContext(GUEST_HOST_KEYS_FILE);
  await writeJsonFileAtomically(filePath, store);
}

function computeFingerprint(publicKeyOpenSSH: string) {
  const parts = publicKeyOpenSSH.trim().split(/\s+/);
  const keyData = Buffer.from(parts[1] ?? "", "base64");
  const hash = createHash("sha256").update(keyData).digest("base64");
  return `SHA256:${hash.replace(/=+$/, "")}`;
}

function recordToInfo(record: GuestHostKeyRecord): GuestHostKeyInfo {
  return {
    fingerprint: computeFingerprint(record.publicKey),
    host: record.host,
    knownHostsLine: record.knownHostsLine,
    pinnedAt: record.pinnedAt,
  };
}

function normalizeTargetKey(node: string, type: "lxc" | "qemu", vmid: number) {
  return `${node}::${type}::${vmid}`;
}

export async function getGuestHostKey(
  node: string,
  type: "lxc" | "qemu",
  vmid: number,
) {
  const store = await readStore();
  const targetKey = normalizeTargetKey(node, type, vmid);
  const record = store.entries.find(
    (entry) => normalizeTargetKey(entry.node, entry.type, entry.vmid) === targetKey,
  );

  return record ? recordToInfo(record) : null;
}

export async function enrollGuestHostKey(input: {
  host: string;
  node: string;
  type: "lxc" | "qemu";
  vmid: number;
}) {
  const { host, node, type, vmid } = input;

  const { stdout } = await execFile(
    "/usr/bin/ssh-keyscan",
    ["-T", "5", "-t", HOST_KEY_ALGORITHMS.join(","), host],
    { timeout: 10_000 },
  );

  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"));

  const selectedLine = lines.find((line) =>
    HOST_KEY_ALGORITHMS.some((algorithm) => line.includes(` ${algorithm} `)),
  );

  if (!selectedLine) {
    throw new Error("No SSH host key could be collected from the guest.");
  }

  const [, keyType, keyData] = selectedLine.split(/\s+/);
  if (!keyType || !keyData) {
    throw new Error("Collected SSH host key was malformed.");
  }

  const publicKey = `${keyType} ${keyData}`;
  const pinnedAt = new Date().toISOString();
  const store = await readStore();
  const targetKey = normalizeTargetKey(node, type, vmid);
  const nextRecord: GuestHostKeyRecord = {
    host,
    knownHostsLine: `${host} ${publicKey}`,
    node,
    pinnedAt,
    publicKey,
    type,
    vmid,
  };

  store.entries = store.entries.filter(
    (entry) => normalizeTargetKey(entry.node, entry.type, entry.vmid) !== targetKey,
  );
  store.entries.push(nextRecord);
  await writeStore(store);

  return recordToInfo(nextRecord);
}
