import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import type { LldpToken, LldpTokensStore } from "@/lib/lldp-types";
import {
  createStoreMutator,
  writeJsonFileAtomically,
} from "@/lib/store-utils";

const DATA_FILE = "lldp-tokens.json";
const TOKEN_PREFIX = "lldp_";
const TOKEN_BYTES = 32;

function emptyStore(): LldpTokensStore {
  return { schemaVersion: 1, tokens: [] };
}

async function readStore(): Promise<LldpTokensStore> {
  try {
    const raw = await readFile(await resolveDataFilePath(DATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<LldpTokensStore>;
    return {
      schemaVersion: 1,
      tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
    };
  } catch {
    return emptyStore();
  }
}

async function writeStore(store: LldpTokensStore): Promise<void> {
  const filePath = await resolveDataFilePath(DATA_FILE);
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("lldp-tokens", readStore, writeStore);

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

function generatePlaintextToken(): string {
  return TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
}

export type IssueTokenResult = {
  token: LldpToken;
  /** Shown to the operator once and never stored. */
  plaintext: string;
};

export async function issueLldpToken(input: {
  siteId: string;
  label: string;
  actorEmail: string;
}): Promise<IssueTokenResult> {
  const label = input.label.trim();
  if (!label) throw new Error("Token label is required.");
  if (label.length > 120) throw new Error("Token label must be 120 chars or fewer.");

  const plaintext = generatePlaintextToken();
  const tokenHash = hashToken(plaintext);

  const token = await mutateStore((store) => {
    const record: LldpToken = {
      id: randomUUID(),
      siteId: input.siteId,
      label,
      tokenHash,
      createdAt: new Date().toISOString(),
      createdBy: input.actorEmail,
      lastUsedAt: null,
      lastUsedIp: null,
      revokedAt: null,
      revokedBy: null,
    };
    store.tokens.push(record);
    return record;
  });

  return { token, plaintext };
}

export async function revokeLldpToken(input: {
  tokenId: string;
  siteId: string;
  actorEmail: string;
}): Promise<LldpToken | null> {
  return mutateStore((store) => {
    const token = store.tokens.find(
      (t) => t.id === input.tokenId && t.siteId === input.siteId,
    );
    if (!token) return null;
    if (token.revokedAt) return token;
    token.revokedAt = new Date().toISOString();
    token.revokedBy = input.actorEmail;
    return token;
  });
}

export async function listLldpTokensForSite(siteId: string): Promise<LldpToken[]> {
  const store = await readStore();
  return store.tokens.filter((t) => t.siteId === siteId);
}

export async function lookupLldpTokenByPlaintext(
  plaintext: string,
): Promise<LldpToken | null> {
  if (!plaintext || !plaintext.startsWith(TOKEN_PREFIX)) return null;

  const candidateHash = Buffer.from(hashToken(plaintext), "hex");
  const store = await readStore();

  for (const token of store.tokens) {
    if (token.revokedAt) continue;
    const storedHash = Buffer.from(token.tokenHash, "hex");
    if (storedHash.length !== candidateHash.length) continue;
    if (timingSafeEqual(storedHash, candidateHash)) return token;
  }
  return null;
}

export async function markLldpTokenUsed(input: {
  tokenId: string;
  sourceIp: string | null;
}): Promise<void> {
  await mutateStore((store) => {
    const token = store.tokens.find((t) => t.id === input.tokenId);
    if (!token) return;
    token.lastUsedAt = new Date().toISOString();
    token.lastUsedIp = input.sourceIp;
  });
}
