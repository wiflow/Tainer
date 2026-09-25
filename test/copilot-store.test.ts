import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import fc from "fast-check";

import {
  CopilotSettingsError,
  getCopilotApiKey,
  getCopilotSettings,
  saveCopilotSettings,
} from "@/lib/copilot/store";

process.env.AUTH_SECRET = "copilot-store-test-secret";

const dataDirs: string[] = [];

after(async () => {
  await Promise.all(dataDirs.map((dir) => rm(dir, { force: true, recursive: true })));
});

async function useFreshDataDir(storeContents?: unknown) {
  const dir = await mkdtemp(path.join(tmpdir(), "tainer-copilot-test-"));
  dataDirs.push(dir);
  process.env.TAINER_DATA_DIR = dir;
  if (storeContents !== undefined) {
    await writeFile(path.join(dir, "copilot-store.json"), JSON.stringify(storeContents));
  }
  return dir;
}

function legacySettings(overrides: Record<string, unknown>) {
  return {
    encryptedKey: null,
    keyHint: null,
    model: "kimi",
    baseUrl: null,
    customModelId: null,
    dailyTokenBudget: 123_000,
    dailyToolCallBudget: 45,
    enabled: true,
    operatorNotes: "keep CT 105 up",
    groupPolicies: { g1: { allowWrite: false, allowDestructive: false } },
    costPerMInputUsd: 0.5,
    costPerMOutputUsd: 1.5,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("a settings file without a provider loads as DeepInfra and keeps every field", async () => {
  const usage = [{ userId: "u1", day: "2026-01-01", inputTokens: 1, outputTokens: 2, toolCalls: 3 }];
  await useFreshDataDir({ settings: legacySettings({}), usage });

  const settings = await getCopilotSettings();
  assert.equal(settings.provider, "deepinfra");
  assert.equal(settings.modelId, "moonshotai/Kimi-K3");
  assert.equal(settings.dailyTokenBudget, 123_000);
  assert.equal(settings.dailyToolCallBudget, 45);
  assert.equal(settings.operatorNotes, "keep CT 105 up");
  assert.deepEqual(settings.groupPolicies, { g1: { allowWrite: false, allowDestructive: false } });
  assert.equal(settings.costPerMInputUsd, 0.5);
});

test("a settings file with a base URL loads as a custom endpoint with its key and model", async () => {
  const dir = await useFreshDataDir();
  await saveCopilotSettings({ apiKey: "sk-legacy-1234" });
  const written = JSON.parse(await readFile(path.join(dir, "copilot-store.json"), "utf8"));
  const legacy = legacySettings({
    encryptedKey: written.settings.encryptedKey,
    keyHint: "1234",
    baseUrl: "https://vllm.example.com/v1",
    customModelId: "qwen3-32b",
  });
  await useFreshDataDir({ settings: legacy, usage: [] });

  const settings = await getCopilotSettings();
  assert.equal(settings.provider, "custom");
  assert.equal(settings.baseUrl, "https://vllm.example.com/v1");
  assert.equal(settings.modelId, "qwen3-32b");
  assert.equal(settings.hasKey, true);
  assert.equal(await getCopilotApiKey(), "sk-legacy-1234");
});

test("an unknown provider value falls back to the migration rule", async () => {
  await useFreshDataDir({ settings: legacySettings({ provider: "nope" }), usage: [] });
  assert.equal((await getCopilotSettings()).provider, "deepinfra");
});

test("changing the provider drops the stored key unless a new one is entered", async () => {
  await useFreshDataDir();
  await saveCopilotSettings({ provider: "deepinfra", apiKey: "sk-deepinfra" });
  assert.equal((await getCopilotSettings()).hasKey, true);

  await saveCopilotSettings({ provider: "deepinfra", model: "fast" });
  assert.equal(await getCopilotApiKey(), "sk-deepinfra");

  const switched = await saveCopilotSettings({ provider: "openai", customModelId: "my-model" });
  assert.equal(switched.provider, "openai");
  assert.equal(switched.modelId, "my-model");
  assert.equal(switched.hasKey, false);
  assert.equal(await getCopilotApiKey(), null);

  await saveCopilotSettings({ provider: "deepinfra", apiKey: "sk-new" });
  assert.equal(await getCopilotApiKey(), "sk-new");
});

test("switching provider without a model id drops the previous provider's custom model id", async () => {
  await useFreshDataDir();
  await saveCopilotSettings({ provider: "openai", customModelId: "my-openai-model", apiKey: "sk-openai" });
  const switched = await saveCopilotSettings({ provider: "anthropic", apiKey: "sk-other" });
  assert.notEqual(switched.modelId, "my-openai-model");
  assert.equal(switched.modelId, switched.anthropicModel);
});

test("changing the custom endpoint drops the key, and the old base URL field still selects custom", async () => {
  await useFreshDataDir();
  const custom = await saveCopilotSettings({
    baseUrl: "https://a.example.com/v1",
    apiKey: "sk-a",
    customModelId: "m",
  });
  assert.equal(custom.provider, "custom");
  assert.equal(custom.hasKey, true);

  const moved = await saveCopilotSettings({ baseUrl: "https://b.example.com/v1" });
  assert.equal(moved.hasKey, false);

  await saveCopilotSettings({ apiKey: "sk-b" });
  const cleared = await saveCopilotSettings({ baseUrl: null });
  assert.equal(cleared.provider, "deepinfra");
  assert.equal(cleared.baseUrl, null);
  assert.equal(cleared.hasKey, false);
});

test("invalid provider settings are refused without writing anything", async () => {
  await useFreshDataDir();
  await saveCopilotSettings({ apiKey: "sk-keep" });
  await assert.rejects(saveCopilotSettings({ provider: "openai" }), CopilotSettingsError);
  await assert.rejects(saveCopilotSettings({ provider: "custom" }), CopilotSettingsError);
  const settings = await getCopilotSettings();
  assert.equal(settings.provider, "deepinfra");
  assert.equal(await getCopilotApiKey(), "sk-keep");
});

const providerArb = fc.constantFrom("deepinfra" as const, "openai" as const, "custom" as const);
const endpointArb = fc.constantFrom("https://a.example.com/v1", "https://b.example.com/v1");

test("a stored key only survives a save that keeps the same provider and endpoint", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.record({ provider: providerArb, baseUrl: endpointArb, newKey: fc.boolean() }), {
        maxLength: 6,
      }),
      async (steps) => {
        await useFreshDataDir();
        await saveCopilotSettings({ provider: "deepinfra", apiKey: "sk-0" });
        let expectedKey: string | null = "sk-0";
        let endpoint = "deepinfra|";
        for (const [index, step] of steps.entries()) {
          const key = step.newKey ? `sk-${index + 1}` : undefined;
          await saveCopilotSettings({
            provider: step.provider,
            baseUrl: step.baseUrl,
            customModelId: "model",
            ...(key ? { apiKey: key } : {}),
          });
          const next = `${step.provider}|${step.provider === "custom" ? step.baseUrl : ""}`;
          if (key) expectedKey = key;
          else if (next !== endpoint) expectedKey = null;
          endpoint = next;
          assert.equal(await getCopilotApiKey(), expectedKey);
        }
      },
    ),
    { numRuns: 25 },
  );
});
