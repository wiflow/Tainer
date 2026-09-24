import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import { redactCredentials } from "@/lib/copilot/redact";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

const DATA_FILE = "copilot-chats.json";

// Bounds keep the file small enough for atomic rewrites.
const MAX_CHATS_PER_USER = 20;
const MAX_TURNS_PER_CHAT = 100;
const MAX_TITLE_LENGTH = 60;
const MAX_TEXT_LENGTH = 32 * 1024;
const MAX_RESULT_BYTES = 64 * 1024;
const MAX_CHAT_BYTES = 256 * 1024;

const TOOL_CALL_FIELDS = [
  "id",
  "name",
  "category",
  "klass",
  "args",
  "status",
  "result",
  "durationMs",
  "describe",
  "confirmString",
  "plan",
  "afterExternalContent",
];

export class ChatTooLargeError extends Error {
  constructor() {
    super("Chat is too large to save.");
  }
}

/**
 * Turns are stored in the client's render shape (user/assistant/error turns
 * with tool-call views) so a restored chat looks exactly like it did — cards
 * included. The server treats them as opaque JSON apart from sanitising.
 */
export type StoredChatTurn = Record<string, unknown>;

type StoredChat = {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: StoredChatTurn[];
};

type ChatStore = {
  chats: StoredChat[];
};

let secretsOnDisk = false;

function scrubStoredSecrets(chats: StoredChat[]): boolean {
  let changed = false;
  for (const chat of chats) {
    if (!Array.isArray(chat.turns)) continue;
    for (const turn of chat.turns) {
      if (!Array.isArray(turn.toolCalls)) continue;
      for (const tc of turn.toolCalls as unknown[]) {
        if (!tc || typeof tc !== "object" || !("result" in tc)) continue;
        const call = tc as Record<string, unknown>;
        const redacted = redactCredentials(call.result);
        if (JSON.stringify(redacted) !== JSON.stringify(call.result)) {
          call.result = redacted;
          changed = true;
        }
      }
    }
  }
  return changed;
}

async function readStore(): Promise<ChatStore> {
  try {
    const raw = await readFile(await resolveDataFilePath(DATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<ChatStore>;
    const chats = Array.isArray(parsed.chats) ? parsed.chats : [];
    if (scrubStoredSecrets(chats)) secretsOnDisk = true;
    return { chats };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { chats: [] };
    throw error;
  }
}

async function writeStore(store: ChatStore) {
  await writeJsonFileAtomically(await resolveDataFilePath(DATA_FILE), store);
  secretsOnDisk = false;
}

const mutateStore = createStoreMutator("copilot-chats", readStore, writeStore);

async function readScrubbedStore(): Promise<ChatStore> {
  const store = await readStore();
  if (secretsOnDisk) await mutateStore(() => undefined);
  return store;
}

export type ChatSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
};

function toSummary(chat: StoredChat): ChatSummary {
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    turnCount: chat.turns.length,
  };
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "");
}

function clampText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_TEXT_LENGTH) : "";
}

/**
 * Keep only the fields the sidebar renders. Approval tokens are one-shot
 * secrets and generated passwords are shown once, so neither is stored; a
 * restored "awaiting-approval" call could never succeed, so it is marked denied.
 */
function sanitizeToolCall(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const tc: Record<string, unknown> = {};
  for (const field of TOOL_CALL_FIELDS) {
    if (field in source) tc[field] = source[field];
  }
  if ("result" in tc) {
    tc.result = redactCredentials(tc.result);
    if (byteLength(tc.result) > MAX_RESULT_BYTES) {
      tc.result = { error: "Result too large to save." };
    }
  }
  if (tc.status === "awaiting-approval") tc.status = "denied";
  return tc;
}

function sanitizeTurn(value: unknown): StoredChatTurn | null {
  if (!value || typeof value !== "object") return null;
  const t = value as Record<string, unknown>;
  if (t.role === "user" || t.role === "error") {
    return { role: t.role, text: clampText(t.text) };
  }
  if (t.role !== "assistant") return null;
  const toolCalls = Array.isArray(t.toolCalls)
    ? t.toolCalls.map(sanitizeToolCall).filter((tc) => tc !== null)
    : [];
  return {
    role: "assistant",
    text: clampText(t.text),
    ...(typeof t.reasoning === "string" ? { reasoning: clampText(t.reasoning) } : {}),
    toolCalls,
  };
}

function sanitizeTurns(turns: unknown[]): StoredChatTurn[] {
  const clean = turns
    .slice(-MAX_TURNS_PER_CHAT)
    .map(sanitizeTurn)
    .filter((turn) => turn !== null);
  let size = byteLength(clean);
  let start = 0;
  while (size > MAX_CHAT_BYTES && start < clean.length) {
    size -= byteLength(clean[start]) + 1;
    start++;
  }
  const kept = clean.slice(start);
  if (kept.length === 0) throw new ChatTooLargeError();
  return kept;
}

function deriveTitle(turns: StoredChatTurn[]): string {
  for (const turn of turns) {
    if (turn.role === "user" && typeof turn.text === "string" && turn.text.trim()) {
      const text = turn.text.trim().replace(/\s+/g, " ");
      return text.length > MAX_TITLE_LENGTH
        ? `${text.slice(0, MAX_TITLE_LENGTH - 1)}…`
        : text;
    }
  }
  return "Untitled chat";
}

export async function listChatsForUser(userId: string): Promise<ChatSummary[]> {
  const store = await readScrubbedStore();
  return store.chats
    .filter((chat) => chat.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(toSummary);
}

export async function getChatForUser(
  userId: string,
  chatId: string,
): Promise<{ id: string; title: string; turns: StoredChatTurn[] } | null> {
  const store = await readScrubbedStore();
  const chat = store.chats.find((c) => c.id === chatId && c.userId === userId);
  return chat ? { id: chat.id, title: chat.title, turns: chat.turns } : null;
}

export async function saveChatForUser(
  userId: string,
  input: { id?: string | null; turns: unknown[] },
): Promise<ChatSummary> {
  return mutateStore((store) => {
    const turns = sanitizeTurns(input.turns);
    const now = new Date().toISOString();

    const existing = input.id
      ? store.chats.find((c) => c.id === input.id && c.userId === userId)
      : undefined;

    if (existing) {
      existing.turns = turns;
      existing.title = deriveTitle(turns);
      existing.updatedAt = now;
      return toSummary(existing);
    }

    const chat: StoredChat = {
      id: randomUUID(),
      userId,
      title: deriveTitle(turns),
      createdAt: now,
      updatedAt: now,
      turns,
    };
    store.chats.push(chat);

    // Enforce the per-user cap — drop the oldest chats beyond it.
    const mine = store.chats
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (mine.length > MAX_CHATS_PER_USER) {
      const evict = new Set(mine.slice(MAX_CHATS_PER_USER).map((c) => c.id));
      store.chats = store.chats.filter((c) => !evict.has(c.id));
    }

    return toSummary(chat);
  });
}

export async function deleteChatForUser(userId: string, chatId: string): Promise<boolean> {
  return mutateStore((store) => {
    const index = store.chats.findIndex((c) => c.id === chatId && c.userId === userId);
    if (index === -1) return false;
    store.chats.splice(index, 1);
    return true;
  });
}
