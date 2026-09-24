import "server-only";

import { readFile } from "node:fs/promises";

import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

type ImageEnvCacheEntry = {
  aliases: string[];
  envText: string;
};

type ImageEnvCacheStore = {
  entries: Record<string, ImageEnvCacheEntry>;
};

const FILE_NAME = "image-env-cache.json";
const SYNTHETIC_ALIAS_PREFIX = "alias:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeCacheKey(value: string) {
  return value.trim();
}

function extractVolidFileName(value: string) {
  const normalized = normalizeCacheKey(value);

  if (!normalized.includes("/")) {
    return "";
  }

  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function isSyntheticAliasKey(value: string) {
  return value.startsWith(SYNTHETIC_ALIAS_PREFIX);
}

function isCanonicalImageKey(value: string) {
  return value.includes("/") || value.includes(":");
}

function buildSyntheticAliasKey(alias: string) {
  return `${SYNTHETIC_ALIAS_PREFIX}${alias}`;
}

function normalizeAliases(aliases: string[], canonicalKey: string) {
  const uniqueAliases = new Set<string>();

  for (const alias of aliases) {
    const normalizedAlias = normalizeCacheKey(alias);

    if (
      normalizedAlias &&
      normalizedAlias !== canonicalKey &&
      !isSyntheticAliasKey(normalizedAlias)
    ) {
      uniqueAliases.add(normalizedAlias);
    }
  }

  return [...uniqueAliases].sort();
}

function normalizeLegacyEntry(
  rawKey: string,
  rawValue: unknown,
): [string, ImageEnvCacheEntry] | null {
  const key = normalizeCacheKey(rawKey);

  if (!key) {
    return null;
  }

  if (typeof rawValue === "string") {
    const envText = rawValue.trim();

    if (!envText) {
      return null;
    }

    return isCanonicalImageKey(key)
      ? [key, { aliases: [], envText }]
      : [buildSyntheticAliasKey(key), { aliases: [key], envText }];
  }

  if (!isRecord(rawValue) || typeof rawValue.envText !== "string") {
    return null;
  }

  const envText = rawValue.envText.trim();

  if (!envText) {
    return null;
  }

  const aliases = Array.isArray(rawValue.aliases)
    ? rawValue.aliases.filter((alias): alias is string => typeof alias === "string")
    : [];

  const canonicalKey = isCanonicalImageKey(key) || isSyntheticAliasKey(key)
    ? key
    : buildSyntheticAliasKey(key);
  const mergedAliases = isSyntheticAliasKey(canonicalKey)
    ? [key, ...aliases]
    : aliases;

  return [
    canonicalKey,
    {
      aliases: normalizeAliases(mergedAliases, canonicalKey),
      envText,
    },
  ];
}

function normalizeEntries(rawEntries: Record<string, unknown>) {
  const entries: Record<string, ImageEnvCacheEntry> = {};

  for (const [rawKey, rawValue] of Object.entries(rawEntries)) {
    const normalized = normalizeLegacyEntry(rawKey, rawValue);

    if (!normalized) {
      continue;
    }

    const [key, entry] = normalized;
    entries[key] = entry;
  }

  return entries;
}

function buildLookupMap(entries: Record<string, ImageEnvCacheEntry>) {
  const map: Record<string, string> = {};
  const explicitAliasMatches = new Map<string, Set<string>>();
  const derivedAliasMatches = new Map<string, Set<string>>();
  const registerAliasMatch = (
    target: Map<string, Set<string>>,
    alias: string,
    envText: string,
  ) => {
    const normalizedAlias = normalizeCacheKey(alias);

    if (!normalizedAlias) {
      return;
    }

    const envTexts = target.get(normalizedAlias) ?? new Set<string>();
    envTexts.add(envText);
    target.set(normalizedAlias, envTexts);
  };

  for (const [key, entry] of Object.entries(entries)) {
    if (!isSyntheticAliasKey(key)) {
      map[key] = entry.envText;
    }

    for (const alias of entry.aliases) {
      registerAliasMatch(explicitAliasMatches, alias, entry.envText);
    }

    const derivedTemplateAlias = deriveTemplateFileAliasFromReference(key);

    if (derivedTemplateAlias) {
      registerAliasMatch(derivedAliasMatches, derivedTemplateAlias, entry.envText);
    }
  }

  for (const [alias, envTexts] of explicitAliasMatches) {
    if (!map[alias] && envTexts.size === 1) {
      map[alias] = envTexts.values().next().value ?? "";
    }
  }

  for (const [alias, envTexts] of derivedAliasMatches) {
    if (!map[alias] && envTexts.size === 1) {
      map[alias] = envTexts.values().next().value ?? "";
    }
  }

  return map;
}

function deriveTemplateFileAliasFromReference(value: string) {
  const normalized = normalizeCacheKey(value);
  const lastSlashIndex = normalized.lastIndexOf("/");
  const lastColonIndex = normalized.lastIndexOf(":");

  if (lastSlashIndex < 0 || lastColonIndex <= lastSlashIndex + 1) {
    return "";
  }

  const repository = normalized.slice(lastSlashIndex + 1, lastColonIndex).trim();
  const tag = normalized.slice(lastColonIndex + 1).trim();

  if (!repository || !tag || repository.includes("/")) {
    return "";
  }

  return `${repository}_${tag}.tar`;
}

async function readCache(): Promise<ImageEnvCacheStore> {
  try {
    const raw = await readFile(await resolveSiteDataFilePathFromContext(FILE_NAME), "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (isRecord(parsed) && isRecord(parsed.entries)) {
      return {
        entries: normalizeEntries(parsed.entries),
      };
    }

    if (isRecord(parsed)) {
      return {
        entries: normalizeEntries(parsed),
      };
    }
  } catch {}

  return {
    entries: {},
  };
}

async function writeCache(cache: ImageEnvCacheStore) {
  const filePath = await resolveSiteDataFilePathFromContext(FILE_NAME);
  await writeJsonFileAtomically(filePath, cache);
}

const mutateCache = createStoreMutator("image-env-cache", readCache, writeCache);

export async function getImageEnv(volid: string): Promise<string> {
  const cache = await readCache();
  const key = normalizeCacheKey(volid);

  if (!key) {
    return "";
  }

  const lookup = buildLookupMap(cache.entries);

  if (lookup[key]) {
    return lookup[key] ?? "";
  }

  const fileName = extractVolidFileName(key);

  if (fileName && lookup[fileName]) {
    return lookup[fileName] ?? "";
  }

  return "";
}

export async function getImageEnvMap(): Promise<Record<string, string>> {
  const cache = await readCache();
  return buildLookupMap(cache.entries);
}

export async function saveImageEnv(
  key: string,
  envText: string,
  options?: { aliases?: string[] },
) {
  const normalizedKey = normalizeCacheKey(key);
  const normalizedEnvText = envText.trim();

  if (!normalizedKey || !normalizedEnvText) {
    return;
  }

  await mutateCache((cache) => {
    const canonicalKey = isCanonicalImageKey(normalizedKey)
      ? normalizedKey
      : buildSyntheticAliasKey(normalizedKey);
    const existing = cache.entries[canonicalKey];
    const fallbackAliases = isSyntheticAliasKey(canonicalKey) ? [normalizedKey] : [];

    cache.entries[canonicalKey] = {
      aliases: normalizeAliases(
        [
          ...(existing?.aliases ?? []),
          ...fallbackAliases,
          ...(options?.aliases ?? []),
        ],
        canonicalKey,
      ),
      envText: normalizedEnvText,
    };
  });
}
