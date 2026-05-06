import "server-only";

import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import { decryptText, encryptText } from "@/lib/crypto";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

/**
 * Single global store for third-party integrations configured via the GUI.
 * Currently holds the phpIPAM connection. Modeled as a record keyed by
 * integration type so future entries (NetBox, etc.) slot in without
 * touching the ipam-specific call sites.
 *
 * The API token is encrypted at rest with the same AES-256-GCM helpers
 * that protect IDP client secrets and TOTP seeds.
 */

const DATA_FILE = "integrations.json";

export const DEFAULT_IPAM_TIMEOUT_MS = 3_500;
export const IPAM_TIMEOUT_MS_MAX = 30_000;
const IPAM_TIMEOUT_MS_MIN = 500;

export type PhpIpamIntegration = {
  enabled: boolean;
  /** phpIPAM server root, e.g. https://ipam.example.com (no trailing /api). */
  serverUrl: string;
  /** API app name (the segment after /api/ in phpIPAM API URLs). */
  appId: string;
  /** Encrypted via crypto.ts; never returned to the UI. */
  encryptedToken: string;
  tlsInsecure: boolean;
  timeoutMs: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
};

export type PhpIpamIntegrationPublic = Omit<PhpIpamIntegration, "encryptedToken"> & {
  hasToken: boolean;
};

export type PhpIpamIntegrationInput = {
  enabled: boolean;
  serverUrl: string;
  appId: string;
  /** Plaintext — encrypted before storage. Empty string = leave existing. */
  token: string;
  tlsInsecure: boolean;
  timeoutMs: number;
};

type IntegrationsStore = {
  ipam: PhpIpamIntegration | null;
};

function emptyStore(): IntegrationsStore {
  return { ipam: null };
}

async function readStore(): Promise<IntegrationsStore> {
  try {
    const raw = await readFile(await resolveDataFilePath(DATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<IntegrationsStore>;
    return {
      ipam: parsed.ipam ?? null,
    };
  } catch {
    return emptyStore();
  }
}

async function writeStore(store: IntegrationsStore) {
  const filePath = await resolveDataFilePath(DATA_FILE);
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("integrations", readStore, writeStore);

function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function normalizeAppId(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function normalizeTimeoutMs(value: number | undefined): number {
  if (!Number.isFinite(value) || (value as number) < IPAM_TIMEOUT_MS_MIN) {
    return DEFAULT_IPAM_TIMEOUT_MS;
  }
  return Math.min(value as number, IPAM_TIMEOUT_MS_MAX);
}

function validateIpamInput(input: PhpIpamIntegrationInput, requireToken: boolean): void {
  const serverUrl = normalizeServerUrl(input.serverUrl);
  if (!serverUrl) throw new Error("Server URL is required.");
  if (!/^https?:\/\//i.test(serverUrl)) {
    throw new Error("Server URL must start with http:// or https://.");
  }
  try {
    new URL(serverUrl);
  } catch {
    throw new Error("Server URL is not a valid URL.");
  }

  if (!normalizeAppId(input.appId)) {
    throw new Error("App ID is required.");
  }

  if (requireToken && !input.token.trim()) {
    throw new Error("API token is required.");
  }
}

function toPublic(integration: PhpIpamIntegration): PhpIpamIntegrationPublic {
  const { encryptedToken: _omit, ...rest } = integration;
  return {
    ...rest,
    hasToken: Boolean(integration.encryptedToken),
  };
}

export async function getIpamIntegration(): Promise<PhpIpamIntegration | null> {
  const store = await readStore();
  return store.ipam;
}

export async function getIpamIntegrationPublic(): Promise<PhpIpamIntegrationPublic | null> {
  const integration = await getIpamIntegration();
  return integration ? toPublic(integration) : null;
}

export async function getDecryptedIpamToken(integration: PhpIpamIntegration): Promise<string> {
  if (!integration.encryptedToken) {
    throw new Error("IPAM integration has no token configured.");
  }
  return decryptText(integration.encryptedToken);
}

export async function upsertIpamIntegration(
  input: PhpIpamIntegrationInput,
  actorEmail: string,
): Promise<PhpIpamIntegration> {
  const existing = await getIpamIntegration();
  validateIpamInput(input, !existing);

  const newEncryptedToken = input.token.trim()
    ? await encryptText(input.token.trim())
    : null;

  return mutateStore((store) => {
    const timestamp = new Date().toISOString();
    const previous = store.ipam;
    const updated: PhpIpamIntegration = {
      enabled: input.enabled,
      serverUrl: normalizeServerUrl(input.serverUrl),
      appId: normalizeAppId(input.appId),
      encryptedToken: newEncryptedToken ?? previous?.encryptedToken ?? "",
      tlsInsecure: input.tlsInsecure,
      timeoutMs: normalizeTimeoutMs(input.timeoutMs),
      createdAt: previous?.createdAt ?? timestamp,
      createdBy: previous?.createdBy ?? actorEmail,
      updatedAt: timestamp,
    };
    if (!updated.encryptedToken) {
      throw new Error("API token is required.");
    }
    store.ipam = updated;
    return updated;
  });
}

export async function deleteIpamIntegration(): Promise<boolean> {
  return mutateStore((store) => {
    if (!store.ipam) return false;
    store.ipam = null;
    return true;
  });
}
