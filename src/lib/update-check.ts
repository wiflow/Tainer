import "server-only";

import { getRunningVersion, isDevBuild } from "./version";

const DOCKER_HUB_TAGS_URL =
  "https://hub.docker.com/v2/repositories/tainersh/tainer/tags?page_size=100&ordering=last_updated";

const SUCCESS_TTL_MS = 60 * 60 * 1000; // 1h
const FAILURE_TTL_MS = 5 * 60 * 1000; // 5m on transient failures, so we don't hammer Docker Hub
const FETCH_TIMEOUT_MS = 3000;

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

type Semver = readonly [number, number, number];

function parseSemver(tag: string | undefined): Semver | null {
  if (!tag) return null;
  const m = SEMVER_RE.exec(tag);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a: Semver, b: Semver): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function formatSemver(v: Semver): string {
  return `${v[0]}.${v[1]}.${v[2]}`;
}

type CacheEntry = {
  latest: string | null;
  fetchedAt: number;
  ttl: number;
};

let cache: CacheEntry | null = null;

async function fetchLatestTag(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(DOCKER_HUB_TAGS_URL, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { results?: Array<{ name?: string }> };
    let best: Semver | null = null;
    for (const tag of body.results ?? []) {
      const parsed = parseSemver(tag.name);
      if (!parsed) continue;
      if (!best || compareSemver(parsed, best) > 0) best = parsed;
    }
    return best ? formatSemver(best) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type UpdateCheckResult = {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
};

// Compares the running version (baked in at build time) against the
// highest vX.Y.Z tag on Docker Hub. Cached in-memory: 1h on success,
// 5m on failure. Skipped entirely for dev builds and when the operator
// sets TAINER_DISABLE_UPDATE_CHECK=true.
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const current = getRunningVersion();

  if (process.env.TAINER_DISABLE_UPDATE_CHECK === "true" || isDevBuild()) {
    return { current, latest: null, updateAvailable: false };
  }

  const now = Date.now();
  if (cache && now - cache.fetchedAt < cache.ttl) {
    return computeResult(current, cache.latest);
  }

  const latest = await fetchLatestTag();
  cache = {
    latest,
    fetchedAt: now,
    ttl: latest === null ? FAILURE_TTL_MS : SUCCESS_TTL_MS,
  };
  return computeResult(current, latest);
}

function computeResult(current: string, latest: string | null): UpdateCheckResult {
  if (!latest) return { current, latest: null, updateAvailable: false };
  const c = parseSemver(current);
  const l = parseSemver(latest);
  if (!c || !l) return { current, latest, updateAvailable: false };
  return { current, latest, updateAvailable: compareSemver(l, c) > 0 };
}
