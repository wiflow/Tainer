import "server-only";

import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import { decryptText, encryptText } from "@/lib/crypto";
import type { SnmpConfigStore, SnmpSiteConfigRecord } from "@/lib/lldp-snmp-types";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

const DATA_FILE = "lldp-snmp-config.json";
const DEFAULT_POLL_INTERVAL_SECONDS = 300;

function emptyStore(): SnmpConfigStore {
  return { schemaVersion: 1, sites: [] };
}

async function readStore(): Promise<SnmpConfigStore> {
  try {
    const raw = await readFile(await resolveDataFilePath(DATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<SnmpConfigStore>;
    return {
      schemaVersion: 1,
      sites: Array.isArray(parsed.sites) ? parsed.sites : [],
    };
  } catch {
    return emptyStore();
  }
}

async function writeStore(store: SnmpConfigStore): Promise<void> {
  const filePath = await resolveDataFilePath(DATA_FILE);
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("lldp-snmp-config", readStore, writeStore);

export type SnmpSitePublicConfig = {
  siteId: string;
  hasCommunity: boolean;
  version: "v2c";
  pollIntervalSeconds: number;
  agentBaseUrl: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

function toPublic(record: SnmpSiteConfigRecord | undefined, siteId: string): SnmpSitePublicConfig {
  return {
    siteId,
    hasCommunity: Boolean(record?.encryptedCommunity),
    version: "v2c",
    pollIntervalSeconds: record?.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS,
    agentBaseUrl: record?.agentBaseUrl ?? null,
    updatedAt: record?.updatedAt ?? null,
    updatedBy: record?.updatedBy ?? null,
  };
}

export function normalizeAgentBaseUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      "Agent base URL must be a full URL, e.g. https://192.168.100.50 or http://tainer.lan:3000",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Agent base URL must use http:// or https://");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(
      "Agent base URL must be a bare origin (no path) — Tainer appends /api/internal/... itself.",
    );
  }
  return parsed.origin;
}

export function resolveAgentBaseUrl(
  override: string | null,
  fallbackOrigin: string,
): string {
  if (override) return override;
  const envOverride = process.env.TAINER_AGENT_BASE_URL?.trim();
  if (envOverride) {
    try {
      return normalizeAgentBaseUrl(envOverride) ?? fallbackOrigin;
    } catch {
      return fallbackOrigin;
    }
  }
  return fallbackOrigin;
}

export async function getSnmpConfigForSite(siteId: string): Promise<SnmpSitePublicConfig> {
  const store = await readStore();
  return toPublic(
    store.sites.find((s) => s.siteId === siteId),
    siteId,
  );
}

export async function getSnmpCommunityForSite(siteId: string): Promise<string | null> {
  const store = await readStore();
  const record = store.sites.find((s) => s.siteId === siteId);
  if (!record?.encryptedCommunity) return null;
  try {
    return await decryptText(record.encryptedCommunity);
  } catch {
    return null;
  }
}

export async function saveSnmpConfigForSite(input: {
  siteId: string;
  community: string | null;
  pollIntervalSeconds?: number;
  actor: { email: string; name: string };
}): Promise<SnmpSitePublicConfig> {
  return mutateStore(async (store) => {
    let record = store.sites.find((s) => s.siteId === input.siteId);
    if (!record) {
      record = {
        siteId: input.siteId,
        encryptedCommunity: null,
        version: "v2c",
        pollIntervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS,
        agentBaseUrl: null,
        updatedAt: new Date().toISOString(),
        updatedBy: input.actor.email,
      };
      store.sites.push(record);
    }

    if (input.community === null) {
      record.encryptedCommunity = null;
    } else {
      const trimmed = input.community.trim();
      if (!trimmed) {
        record.encryptedCommunity = null;
      } else {
        record.encryptedCommunity = await encryptText(trimmed);
      }
    }
    if (
      typeof input.pollIntervalSeconds === "number" &&
      input.pollIntervalSeconds >= 60 &&
      input.pollIntervalSeconds <= 3600
    ) {
      record.pollIntervalSeconds = Math.floor(input.pollIntervalSeconds);
    }
    record.updatedAt = new Date().toISOString();
    record.updatedBy = input.actor.email;

    return toPublic(record, input.siteId);
  });
}

export async function saveAgentBaseUrlForSite(input: {
  siteId: string;
  agentBaseUrl: string | null;
  actor: { email: string; name: string };
}): Promise<SnmpSitePublicConfig> {
  const normalized = normalizeAgentBaseUrl(input.agentBaseUrl);

  return mutateStore((store) => {
    let record = store.sites.find((s) => s.siteId === input.siteId);
    if (!record) {
      record = {
        siteId: input.siteId,
        encryptedCommunity: null,
        version: "v2c",
        pollIntervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS,
        agentBaseUrl: null,
        updatedAt: new Date().toISOString(),
        updatedBy: input.actor.email,
      };
      store.sites.push(record);
    }
    record.agentBaseUrl = normalized;
    record.updatedAt = new Date().toISOString();
    record.updatedBy = input.actor.email;
    return toPublic(record, input.siteId);
  });
}
