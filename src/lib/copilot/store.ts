import "server-only";

import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import { decryptText, encryptText } from "@/lib/crypto";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";
import { COPILOT_MODEL_IDS, type CopilotModel } from "@/lib/copilot/types";

const DATA_FILE = "copilot-store.json";

const DEFAULT_DAILY_TOKEN_BUDGET = 500_000;
const DEFAULT_DAILY_TOOL_CALL_BUDGET = 200;
const DEFAULT_MODEL: CopilotModel = "smart";

type StoredSettings = {
  /** Encrypted DeepInfra API key (AES-256-GCM under AUTH_SECRET). Null = no key set. */
  encryptedKey: string | null;
  /** Last 4 chars of the plaintext key, for display only. */
  keyHint: string | null;
  model: CopilotModel;
  /** Per-user daily budgets — the key is shared, the caps apply to each user. */
  dailyTokenBudget: number;
  dailyToolCallBudget: number;
  enabled: boolean;
  updatedAt: string;
};

type StoredUsage = {
  userId: string;
  /** YYYY-MM-DD in UTC. */
  day: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
};

type CopilotStore = {
  settings: StoredSettings;
  usage: StoredUsage[];
};

function defaultSettings(): StoredSettings {
  return {
    encryptedKey: null,
    keyHint: null,
    model: DEFAULT_MODEL,
    dailyTokenBudget: DEFAULT_DAILY_TOKEN_BUDGET,
    dailyToolCallBudget: DEFAULT_DAILY_TOOL_CALL_BUDGET,
    enabled: true,
    updatedAt: new Date(0).toISOString(),
  };
}

function defaultStore(): CopilotStore {
  return { settings: defaultSettings(), usage: [] };
}

async function readStore(): Promise<CopilotStore> {
  try {
    const raw = await readFile(await resolveDataFilePath(DATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<CopilotStore>;
    return {
      settings: { ...defaultSettings(), ...(parsed.settings ?? {}) },
      usage: Array.isArray(parsed.usage) ? parsed.usage : [],
    };
  } catch {
    return defaultStore();
  }
}

async function writeStore(store: CopilotStore) {
  const filePath = await resolveDataFilePath(DATA_FILE);
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("copilot-store", readStore, writeStore);

export type CopilotSettings = {
  hasKey: boolean;
  keyHint: string | null;
  model: CopilotModel;
  modelId: string;
  dailyTokenBudget: number;
  dailyToolCallBudget: number;
  enabled: boolean;
  updatedAt: string | null;
};

function toPublic(stored: StoredSettings): CopilotSettings {
  return {
    hasKey: Boolean(stored.encryptedKey),
    keyHint: stored.keyHint,
    model: stored.model,
    modelId: COPILOT_MODEL_IDS[stored.model],
    dailyTokenBudget: stored.dailyTokenBudget,
    dailyToolCallBudget: stored.dailyToolCallBudget,
    enabled: stored.enabled,
    updatedAt: stored.updatedAt === new Date(0).toISOString() ? null : stored.updatedAt,
  };
}

export async function getCopilotSettings(): Promise<CopilotSettings> {
  const store = await readStore();
  return toPublic(store.settings);
}

export async function getCopilotApiKey(): Promise<string | null> {
  const store = await readStore();
  if (!store.settings.encryptedKey) return null;
  try {
    return await decryptText(store.settings.encryptedKey);
  } catch {
    return null;
  }
}

export type CopilotSettingsInput = {
  apiKey?: string | null;
  model?: CopilotModel;
  dailyTokenBudget?: number;
  dailyToolCallBudget?: number;
  enabled?: boolean;
};

export async function saveCopilotSettings(
  input: CopilotSettingsInput,
): Promise<CopilotSettings> {
  return mutateStore(async (store) => {
    const settings = store.settings;

    if (input.apiKey !== undefined) {
      if (input.apiKey === null || input.apiKey.trim() === "") {
        settings.encryptedKey = null;
        settings.keyHint = null;
      } else {
        const trimmed = input.apiKey.trim();
        settings.encryptedKey = await encryptText(trimmed);
        settings.keyHint = trimmed.slice(-4);
      }
    }
    if (input.model) settings.model = input.model;
    if (typeof input.dailyTokenBudget === "number" && input.dailyTokenBudget > 0) {
      settings.dailyTokenBudget = Math.floor(input.dailyTokenBudget);
    }
    if (typeof input.dailyToolCallBudget === "number" && input.dailyToolCallBudget > 0) {
      settings.dailyToolCallBudget = Math.floor(input.dailyToolCallBudget);
    }
    if (typeof input.enabled === "boolean") settings.enabled = input.enabled;
    settings.updatedAt = new Date().toISOString();

    return toPublic(settings);
  });
}

export type CopilotUsageSnapshot = {
  day: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  tokenBudget: number;
  toolCallBudget: number;
  tokensRemaining: number;
  toolCallsRemaining: number;
};

function currentUtcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getCopilotUsage(userId: string): Promise<CopilotUsageSnapshot> {
  const store = await readStore();
  const today = currentUtcDay();
  const settings = store.settings;
  const usage = store.usage.find((u) => u.userId === userId && u.day === today);
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const toolCalls = usage?.toolCalls ?? 0;
  return {
    day: today,
    inputTokens,
    outputTokens,
    toolCalls,
    tokenBudget: settings.dailyTokenBudget,
    toolCallBudget: settings.dailyToolCallBudget,
    tokensRemaining: Math.max(0, settings.dailyTokenBudget - inputTokens - outputTokens),
    toolCallsRemaining: Math.max(0, settings.dailyToolCallBudget - toolCalls),
  };
}

export async function recordCopilotUsage(
  userId: string,
  inputTokens: number,
  outputTokens: number,
  toolCalls: number,
): Promise<void> {
  // Drop the entry if nothing happened — keeps the usage table small.
  if (inputTokens <= 0 && outputTokens <= 0 && toolCalls <= 0) return;

  await mutateStore((store) => {
    const today = currentUtcDay();
    let entry = store.usage.find((u) => u.userId === userId && u.day === today);
    if (!entry) {
      entry = { userId, day: today, inputTokens: 0, outputTokens: 0, toolCalls: 0 };
      store.usage.push(entry);
    }
    entry.inputTokens += Math.max(0, inputTokens);
    entry.outputTokens += Math.max(0, outputTokens);
    entry.toolCalls += Math.max(0, toolCalls);

    // Prune entries older than 30 days to keep the file bounded. Budgets
    // are daily anyway — historical usage is just for display.
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 30);
    const cutoffDay = cutoff.toISOString().slice(0, 10);
    store.usage = store.usage.filter((u) => u.day >= cutoffDay);
  });
}
