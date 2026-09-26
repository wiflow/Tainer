import "server-only";

import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import { decryptText, encryptText } from "@/lib/crypto";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";
import {
  COPILOT_MODEL_IDS,
  isAnthropicModel,
  isCopilotProvider,
  type AnthropicModel,
  type CopilotModel,
  type CopilotProvider,
} from "@/lib/copilot/types";

const DATA_FILE = "copilot-store.json";

const DEFAULT_DAILY_TOKEN_BUDGET = 500_000;
const DEFAULT_DAILY_TOOL_CALL_BUDGET = 200;
const DEFAULT_MODEL: CopilotModel = "smart";
const MAX_OPERATOR_NOTES_LENGTH = 4000;
const MAX_CUSTOM_MODEL_ID_LENGTH = 200;

export type GroupToolPolicy = {
  allowWrite: boolean;
  allowDestructive: boolean;
};

type StoredSettings = {
  /** AES-256-GCM ciphertext under AUTH_SECRET. */
  encryptedKey: string | null;
  keyHint: string | null;
  provider: CopilotProvider;
  model: CopilotModel;
  anthropicModel: AnthropicModel;
  baseUrl: string | null;
  customModelId: string | null;
  dailyTokenBudget: number;
  dailyToolCallBudget: number;
  enabled: boolean;
  operatorNotes: string;
  groupPolicies: Record<string, GroupToolPolicy>;
  /** USD per million tokens. */
  costPerMInputUsd: number | null;
  costPerMOutputUsd: number | null;
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
    provider: "deepinfra",
    model: DEFAULT_MODEL,
    anthropicModel: "claude-opus-5",
    baseUrl: null,
    customModelId: null,
    dailyTokenBudget: DEFAULT_DAILY_TOKEN_BUDGET,
    dailyToolCallBudget: DEFAULT_DAILY_TOOL_CALL_BUDGET,
    enabled: true,
    operatorNotes: "",
    groupPolicies: {},
    costPerMInputUsd: null,
    costPerMOutputUsd: null,
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
    const settings = { ...defaultSettings(), ...(parsed.settings ?? {}) };
    if (!isCopilotProvider(parsed.settings?.provider)) {
      settings.provider = settings.baseUrl ? "custom" : "deepinfra";
    }
    if (!isAnthropicModel(settings.anthropicModel)) settings.anthropicModel = "claude-opus-5";
    return {
      settings,
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
  provider: CopilotProvider;
  model: CopilotModel;
  anthropicModel: AnthropicModel;
  modelId: string;
  baseUrl: string | null;
  customModelId: string | null;
  dailyTokenBudget: number;
  dailyToolCallBudget: number;
  enabled: boolean;
  operatorNotes: string;
  groupPolicies: Record<string, GroupToolPolicy>;
  costPerMInputUsd: number | null;
  costPerMOutputUsd: number | null;
  updatedAt: string | null;
};

function resolveModelId(stored: StoredSettings): string {
  switch (stored.provider) {
    case "openai":
      return stored.customModelId ?? "";
    case "anthropic":
      return stored.customModelId || stored.anthropicModel;
    case "custom":
      return stored.customModelId || COPILOT_MODEL_IDS[stored.model];
    default:
      return COPILOT_MODEL_IDS[stored.model];
  }
}

function toPublic(stored: StoredSettings): CopilotSettings {
  return {
    hasKey: Boolean(stored.encryptedKey),
    keyHint: stored.keyHint,
    provider: stored.provider,
    model: stored.model,
    anthropicModel: stored.anthropicModel,
    modelId: resolveModelId(stored),
    baseUrl: stored.baseUrl,
    customModelId: stored.customModelId,
    dailyTokenBudget: stored.dailyTokenBudget,
    dailyToolCallBudget: stored.dailyToolCallBudget,
    enabled: stored.enabled,
    operatorNotes: stored.operatorNotes,
    groupPolicies: stored.groupPolicies,
    costPerMInputUsd: stored.costPerMInputUsd,
    costPerMOutputUsd: stored.costPerMOutputUsd,
    updatedAt: stored.updatedAt === new Date(0).toISOString() ? null : stored.updatedAt,
  };
}

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}

// Plain http would expose the API key and cluster data, so it needs an explicit opt-in.
export function validateCopilotBaseUrl(raw: string): string {
  const trimmed = stripTrailingSlashes(raw.trim());
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Endpoint must be a valid URL, e.g. https://vllm.example.com/v1");
  }
  const allowInsecure =
    (process.env.TAINER_COPILOT_ALLOW_INSECURE_ENDPOINT ?? "").trim().toLowerCase() ===
    "true";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && allowInsecure)) {
    throw new Error(
      "Endpoint must use https. To allow plain http on a trusted network, set TAINER_COPILOT_ALLOW_INSECURE_ENDPOINT=true.",
    );
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new Error("Endpoint must be a bare base URL, with no query, fragment, or credentials.");
  }
  return trimmed;
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

export class CopilotSettingsError extends Error {}

function inferProvider(current: CopilotProvider, baseUrl: string | null): CopilotProvider {
  if (baseUrl) return "custom";
  return current === "custom" ? "deepinfra" : current;
}

export type CopilotSettingsInput = {
  apiKey?: string | null;
  provider?: CopilotProvider;
  model?: CopilotModel;
  anthropicModel?: AnthropicModel;
  baseUrl?: string | null;
  customModelId?: string | null;
  dailyTokenBudget?: number;
  dailyToolCallBudget?: number;
  enabled?: boolean;
  operatorNotes?: string;
  groupPolicies?: Record<string, GroupToolPolicy>;
  costPerMInputUsd?: number | null;
  costPerMOutputUsd?: number | null;
};

async function applyApiKey(settings: StoredSettings, apiKey: string | null | undefined) {
  if (apiKey === undefined) return;
  const trimmed = apiKey?.trim() ?? "";
  settings.encryptedKey = trimmed ? await encryptText(trimmed) : null;
  settings.keyHint = trimmed ? trimmed.slice(-4) : null;
}

function resolveEndpoint(settings: StoredSettings, input: CopilotSettingsInput) {
  const requestedBaseUrl =
    input.baseUrl === undefined ? settings.baseUrl : input.baseUrl?.trim() || null;
  const provider = input.provider ?? inferProvider(settings.provider, requestedBaseUrl);
  const baseUrl = provider === "custom" ? requestedBaseUrl : null;
  if (provider === "custom" && !baseUrl) {
    throw new CopilotSettingsError("Enter the endpoint URL for the custom provider.");
  }
  return { provider, baseUrl };
}

function applyCustomModelId(
  settings: StoredSettings,
  customModelId: string | null | undefined,
  providerChanged: boolean,
) {
  if (customModelId !== undefined) {
    settings.customModelId = customModelId?.trim().slice(0, MAX_CUSTOM_MODEL_ID_LENGTH) || null;
  } else if (providerChanged) {
    settings.customModelId = null;
  }
  if (settings.provider === "openai" && !settings.customModelId) {
    throw new CopilotSettingsError("Enter a model id for OpenAI.");
  }
}

function applyEndpoint(settings: StoredSettings, input: CopilotSettingsInput) {
  const { provider, baseUrl } = resolveEndpoint(settings, input);
  // A stored key must never reach a different endpoint unless it is entered again.
  const providerChanged = provider !== settings.provider;
  if ((providerChanged || baseUrl !== settings.baseUrl) && input.apiKey === undefined) {
    settings.encryptedKey = null;
    settings.keyHint = null;
  }
  settings.provider = provider;
  settings.baseUrl = baseUrl;
  applyCustomModelId(settings, input.customModelId, providerChanged);
}

function positiveInteger(value: number | undefined): number | null {
  return typeof value === "number" && value > 0 ? Math.floor(value) : null;
}

function applyLimits(settings: StoredSettings, input: CopilotSettingsInput) {
  settings.dailyTokenBudget = positiveInteger(input.dailyTokenBudget) ?? settings.dailyTokenBudget;
  settings.dailyToolCallBudget =
    positiveInteger(input.dailyToolCallBudget) ?? settings.dailyToolCallBudget;
  if (typeof input.enabled === "boolean") settings.enabled = input.enabled;
  if (typeof input.operatorNotes === "string") {
    settings.operatorNotes = input.operatorNotes.slice(0, MAX_OPERATOR_NOTES_LENGTH);
  }
}

function cleanGroupPolicies(
  policies: NonNullable<CopilotSettingsInput["groupPolicies"]>,
): Record<string, GroupToolPolicy> {
  const clean: Record<string, GroupToolPolicy> = {};
  for (const [groupId, policy] of Object.entries(policies)) {
    if (!policy || typeof policy !== "object") continue;
    if (policy.allowWrite !== false && policy.allowDestructive !== false) continue;
    clean[groupId] = {
      allowWrite: policy.allowWrite !== false,
      allowDestructive: policy.allowDestructive !== false,
    };
  }
  return clean;
}

function priceOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && value >= 0 ? value : null;
}

export async function saveCopilotSettings(
  input: CopilotSettingsInput,
): Promise<CopilotSettings> {
  return mutateStore(async (store) => {
    const settings = store.settings;
    await applyApiKey(settings, input.apiKey);
    if (input.model) settings.model = input.model;
    if (input.anthropicModel) settings.anthropicModel = input.anthropicModel;
    applyEndpoint(settings, input);
    applyLimits(settings, input);
    if (input.groupPolicies) settings.groupPolicies = cleanGroupPolicies(input.groupPolicies);
    if (input.costPerMInputUsd !== undefined) {
      settings.costPerMInputUsd = priceOrNull(input.costPerMInputUsd);
    }
    if (input.costPerMOutputUsd !== undefined) {
      settings.costPerMOutputUsd = priceOrNull(input.costPerMOutputUsd);
    }
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

    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 30);
    const cutoffDay = cutoff.toISOString().slice(0, 10);
    store.usage = store.usage.filter((u) => u.day >= cutoffDay);
  });
}

export async function getGroupToolPolicyForUser(user: {
  role: string;
  groupIds: string[];
}): Promise<GroupToolPolicy> {
  if (user.role === "admin") return { allowWrite: true, allowDestructive: true };
  const store = await readStore();
  const policies = store.settings.groupPolicies;
  let allowWrite = true;
  let allowDestructive = true;
  for (const groupId of user.groupIds) {
    const policy = policies[groupId];
    if (!policy) continue;
    allowWrite = allowWrite && policy.allowWrite;
    allowDestructive = allowDestructive && policy.allowDestructive;
  }
  return { allowWrite, allowDestructive };
}

export type CopilotUserUsageSummary = {
  userId: string;
  todayInputTokens: number;
  todayOutputTokens: number;
  todayToolCalls: number;
  monthInputTokens: number;
  monthOutputTokens: number;
  monthToolCalls: number;
};

export async function listCopilotUsageSummaries(): Promise<CopilotUserUsageSummary[]> {
  const store = await readStore();
  const today = currentUtcDay();
  const byUser = new Map<string, CopilotUserUsageSummary>();
  for (const entry of store.usage) {
    let summary = byUser.get(entry.userId);
    if (!summary) {
      summary = {
        userId: entry.userId,
        todayInputTokens: 0,
        todayOutputTokens: 0,
        todayToolCalls: 0,
        monthInputTokens: 0,
        monthOutputTokens: 0,
        monthToolCalls: 0,
      };
      byUser.set(entry.userId, summary);
    }
    summary.monthInputTokens += entry.inputTokens;
    summary.monthOutputTokens += entry.outputTokens;
    summary.monthToolCalls += entry.toolCalls;
    if (entry.day === today) {
      summary.todayInputTokens += entry.inputTokens;
      summary.todayOutputTokens += entry.outputTokens;
      summary.todayToolCalls += entry.toolCalls;
    }
  }
  return Array.from(byUser.values()).sort(
    (a, b) =>
      b.monthInputTokens + b.monthOutputTokens - (a.monthInputTokens + a.monthOutputTokens),
  );
}
