import "server-only";

import { readFile } from "node:fs/promises";

import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { writeJsonFileAtomically } from "@/lib/store-utils";
import type { LoadBalancerSettings, ScoreWeights } from "./types";

const SETTINGS_FILE = "lb-settings.json";

export const DEFAULT_LB_SETTINGS: LoadBalancerSettings = {
  enabled: false,
  pollIntervalSeconds: 10,
  weights: { cpu: 0.4, memory: 0.3, latency: 0.2, disk: 0.1 },
  migrationEnabled: false,
  migrationThresholdPercent: 50,
  migrationConsecutivePolls: 3,
  migrationCooldownSeconds: 300,
  cpuStealPenalty: 50,
  cpuStealThresholdPercent: 10,
  failcntPenalty: 50,
  ewmaAlpha: 0.3,
  latencyMaxMs: 500,
  tickTimeoutSeconds: 30,
  excludedNodes: [],
  excludedVmids: [],
  updatedAt: null,
};

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.round(clampNumber(value, fallback, min, max));
}

/**
 * Normalize weights to sum to exactly 1.0.
 * After rounding to 3 decimal places, the remainder is added to the
 * largest weight to guarantee the sum is exactly 1.000.
 */
function normalizeWeights(raw: unknown): ScoreWeights {
  const defaults = DEFAULT_LB_SETTINGS.weights;
  if (!raw || typeof raw !== "object") return { ...defaults };

  const w = raw as Partial<ScoreWeights>;
  let cpu = clampNumber(w.cpu, defaults.cpu, 0, 1);
  let memory = clampNumber(w.memory, defaults.memory, 0, 1);
  let latency = clampNumber(w.latency, defaults.latency, 0, 1);
  let disk = clampNumber(w.disk, defaults.disk, 0, 1);

  const sum = cpu + memory + latency + disk;
  if (sum <= 0) return { ...defaults };

  cpu /= sum;
  memory /= sum;
  latency /= sum;
  disk /= sum;

  // Round to 3 decimal places
  let rCpu = Math.round(cpu * 1000) / 1000;
  let rMemory = Math.round(memory * 1000) / 1000;
  let rLatency = Math.round(latency * 1000) / 1000;
  let rDisk = Math.round(disk * 1000) / 1000;

  // Fix rounding drift: add remainder to the largest weight
  const roundedSum = rCpu + rMemory + rLatency + rDisk;
  const drift = Math.round((1 - roundedSum) * 1000) / 1000;
  if (drift !== 0) {
    const max = Math.max(rCpu, rMemory, rLatency, rDisk);
    if (rCpu === max) rCpu += drift;
    else if (rMemory === max) rMemory += drift;
    else if (rLatency === max) rLatency += drift;
    else rDisk += drift;
  }

  return { cpu: rCpu, memory: rMemory, latency: rLatency, disk: rDisk };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
    .map((v) => Math.round(v));
}

function normalizeSettings(parsed: Partial<LoadBalancerSettings>): LoadBalancerSettings {
  return {
    enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_LB_SETTINGS.enabled,
    pollIntervalSeconds: clampInteger(
      parsed.pollIntervalSeconds,
      DEFAULT_LB_SETTINGS.pollIntervalSeconds,
      5,
      300,
    ),
    weights: normalizeWeights(parsed.weights),
    migrationEnabled:
      typeof parsed.migrationEnabled === "boolean"
        ? parsed.migrationEnabled
        : DEFAULT_LB_SETTINGS.migrationEnabled,
    migrationThresholdPercent: clampInteger(
      parsed.migrationThresholdPercent,
      DEFAULT_LB_SETTINGS.migrationThresholdPercent,
      10,
      200,
    ),
    migrationConsecutivePolls: clampInteger(
      parsed.migrationConsecutivePolls,
      DEFAULT_LB_SETTINGS.migrationConsecutivePolls,
      1,
      20,
    ),
    migrationCooldownSeconds: clampInteger(
      parsed.migrationCooldownSeconds,
      DEFAULT_LB_SETTINGS.migrationCooldownSeconds,
      30,
      3600,
    ),
    cpuStealPenalty: clampInteger(
      parsed.cpuStealPenalty,
      DEFAULT_LB_SETTINGS.cpuStealPenalty,
      0,
      200,
    ),
    cpuStealThresholdPercent: clampInteger(
      parsed.cpuStealThresholdPercent,
      DEFAULT_LB_SETTINGS.cpuStealThresholdPercent,
      1,
      100,
    ),
    failcntPenalty: clampInteger(
      parsed.failcntPenalty,
      DEFAULT_LB_SETTINGS.failcntPenalty,
      0,
      200,
    ),
    ewmaAlpha: clampNumber(
      parsed.ewmaAlpha,
      DEFAULT_LB_SETTINGS.ewmaAlpha,
      0.01,
      1,
    ),
    latencyMaxMs: clampInteger(
      parsed.latencyMaxMs,
      DEFAULT_LB_SETTINGS.latencyMaxMs,
      50,
      10_000,
    ),
    tickTimeoutSeconds: clampInteger(
      parsed.tickTimeoutSeconds,
      DEFAULT_LB_SETTINGS.tickTimeoutSeconds,
      10,
      120,
    ),
    excludedNodes: normalizeStringArray(parsed.excludedNodes),
    excludedVmids: normalizeNumberArray(parsed.excludedVmids),
    updatedAt:
      typeof parsed.updatedAt === "string" ? parsed.updatedAt : DEFAULT_LB_SETTINGS.updatedAt,
  };
}

export async function getLoadBalancerSettings(): Promise<LoadBalancerSettings> {
  try {
    const raw = await readFile(await resolveSiteDataFilePathFromContext(SETTINGS_FILE), "utf8");
    return normalizeSettings(JSON.parse(raw) as Partial<LoadBalancerSettings>);
  } catch {
    return { ...DEFAULT_LB_SETTINGS };
  }
}

let settingsMutationQueue = Promise.resolve();

export async function saveLoadBalancerSettings(
  input: Partial<LoadBalancerSettings>,
): Promise<LoadBalancerSettings> {
  const previousMutation = settingsMutationQueue;
  let releaseMutation!: () => void;
  settingsMutationQueue = new Promise<void>((resolve) => {
    releaseMutation = resolve;
  });

  await previousMutation.catch(() => {});

  try {
    const current = await getLoadBalancerSettings();
    const next = normalizeSettings({
      ...current,
      ...input,
      updatedAt: new Date().toISOString(),
    });

    const filePath = await resolveSiteDataFilePathFromContext(SETTINGS_FILE);
    await writeJsonFileAtomically(filePath, next);

    return next;
  } finally {
    releaseMutation();
  }
}
