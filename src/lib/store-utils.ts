import "server-only";

import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { resolveDataFilePath } from "@/lib/app-data";

// Bumped from 1s -> 5s. The cache is invalidated on every write (see
// `primeJsonFileCache` below), so staleness is impossible — the previous TTL
// just meant cascading reads within a single request (auth-store read 3-4 times
// per page render in some flows) couldn't share data. 5s comfortably covers
// any single render hierarchy and reduces disk I/O without affecting freshness.
const DEFAULT_JSON_CACHE_TTL_MS = 5_000;
const jsonFileCache = new Map<string, { expiresAt: number; value: unknown }>();
const jsonFileInflight = new Map<string, Promise<unknown>>();

function cloneJsonValue<TValue>(value: TValue): TValue {
  return structuredClone(value);
}

export function createStoreMutator<TStore>(
  label: string,
  readStore: () => Promise<TStore>,
  writeStore: (store: TStore) => Promise<void>,
) {
  let mutationQueue = Promise.resolve();

  return async function mutateStore<TResult>(
    callback: (store: TStore) => Promise<TResult> | TResult,
  ) {
    const previousMutation = mutationQueue;
    let releaseQueue!: () => void;

    mutationQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    await previousMutation.catch((error) => {
      console.error(`[${label}] Previous mutation failed:`, error);
    });

    try {
      const store = await readStore();
      const result = await callback(store);
      await writeStore(store);

      return result;
    } finally {
      releaseQueue();
    }
  };
}

type JsonFileCacheOptions<TValue> = {
  failClosed?: boolean;
  fallback: () => TValue;
  normalize: (parsed: unknown) => TValue;
  ttlMs?: number;
};

function primeJsonFileCache(filePath: string, value: unknown, ttlMs = DEFAULT_JSON_CACHE_TTL_MS) {
  jsonFileCache.set(filePath, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
  jsonFileInflight.delete(filePath);
}

export async function readJsonFileCached<TValue>(
  filePath: string,
  { failClosed = false, fallback, normalize, ttlMs = DEFAULT_JSON_CACHE_TTL_MS }: JsonFileCacheOptions<TValue>,
): Promise<TValue> {
  const cached = jsonFileCache.get(filePath);
  if (cached && cached.expiresAt > Date.now()) {
    return cloneJsonValue(cached.value as TValue);
  }

  const inflight = jsonFileInflight.get(filePath);
  if (inflight) {
    return (inflight as Promise<TValue>).then((value) => cloneJsonValue(value));
  }

  let cacheable = true;
  const request = readFile(filePath, "utf8")
    .then((raw) => normalize(JSON.parse(raw)))
    .catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
        return fallback();
      }
      if (failClosed) {
        throw error;
      }
      console.error(`[store] Failed to read ${filePath}, using defaults:`, error);
      cacheable = false;
      return fallback();
    });

  jsonFileInflight.set(filePath, request);

  try {
    const value = await request;
    if (cacheable) {
      primeJsonFileCache(filePath, value, ttlMs);
    }
    return cloneJsonValue(value);
  } finally {
    jsonFileInflight.delete(filePath);
  }
}

export async function readDataJsonFileCached<TValue>(
  fileName: string,
  options: JsonFileCacheOptions<TValue>,
): Promise<TValue> {
  return readJsonFileCached(await resolveDataFilePath(fileName), options);
}

export async function writeJsonFileAtomically(filePath: string, value: unknown) {
  await mkdir(dirname(filePath), { mode: 0o700, recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(tempPath, 0o600);
  await rename(tempPath, filePath);
  primeJsonFileCache(filePath, value);
}
