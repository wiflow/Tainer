import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

const DATA_FILE = "copilot-chats.json";

// Bounds keep the file small enough for atomic rewrites: 20 chats × 100
// turns of card-sized JSON is comfortably under a megabyte per user.
const MAX_CHATS_PER_USER = 20;
const MAX_TURNS_PER_CHAT = 100;
const MAX_TITLE_LENGTH = 60;

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

async function readStore(): Promise<ChatStore> {
  try {
    const raw = await readFile(await resolveDataFilePath(DATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<ChatStore>;
    return { chats: Array.isArray(parsed.chats) ? parsed.chats : [] };
  } catch {
    return { chats: [] };
  }
}

async function writeStore(store: ChatStore) {
  await writeJsonFileAtomically(await resolveDataFilePath(DATA_FILE), store);
}

const mutateStore = createStoreMutator("copilot-chats", readStore, writeStore);

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

/**
 * Strip everything that must not survive persistence: approval tokens are
 * one-shot secrets (5-minute TTL), and a restored "awaiting-approval" call
 * would render an approve button that can never succeed — mark it denied.
 */
function sanitizeTurns(turns: unknown[]): StoredChatTurn[] {
  return turns.slice(-MAX_TURNS_PER_CHAT).map((turn) => {
    if (!turn || typeof turn !== "object") return {} as StoredChatTurn;
    const t = turn as Record<string, unknown>;
    if (t.role !== "assistant" || !Array.isArray(t.toolCalls)) {
      return t as StoredChatTurn;
    }
    return {
      ...t,
      toolCalls: t.toolCalls.map((tc) => {
        if (!tc || typeof tc !== "object") return tc;
        const rest = { ...(tc as Record<string, unknown>) };
        delete rest.token;
        return rest.status === "awaiting-approval" ? { ...rest, status: "denied" } : rest;
      }),
    };
  });
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
  const store = await readStore();
  return store.chats
    .filter((chat) => chat.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(toSummary);
}

export async function getChatForUser(
  userId: string,
  chatId: string,
): Promise<{ id: string; title: string; turns: StoredChatTurn[] } | null> {
  const store = await readStore();
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
