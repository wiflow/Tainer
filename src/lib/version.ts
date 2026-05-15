import packageJson from "../../package.json";

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

function readBaked(): string | null {
  const raw = process.env.TAINER_VERSION?.trim();
  if (!raw || raw === "dev") return null;
  const stripped = raw.startsWith("v") ? raw.slice(1) : raw;
  return SEMVER_RE.test(stripped) ? stripped : null;
}

let cached: string | null = null;

// The version Tainer reports to itself + the UI. Source of truth is the
// `TAINER_VERSION` build arg baked into the production image; falls back
// to package.json for local `npm run dev` so something sensible still
// shows up in the sidebar.
export function getRunningVersion(): string {
  if (cached !== null) return cached;
  cached = readBaked() ?? packageJson.version;
  return cached;
}

// True when no real release tag was baked in — local dev or a bare
// `docker build` without --build-arg. The update check uses this to skip
// the outbound call entirely.
export function isDevBuild(): boolean {
  return readBaked() === null;
}

// Raw `TAINER_VERSION` build arg, surfaced verbatim for the sidebar so
// custom builds (local-20260510-2036, ci-7f3a, 1.4.0-rc.1, etc.) are
// distinguishable from the semver in the headline. Returns null when
// there's nothing useful to show: unset, "dev", or a plain semver that
// already matches what `getRunningVersion()` displays — no point
// repeating "v1.4.0 / 1.4.0".
export function getBuildTag(): string | null {
  const raw = process.env.TAINER_VERSION?.trim();
  if (!raw || raw === "dev") return null;
  const stripped = raw.startsWith("v") ? raw.slice(1) : raw;
  if (SEMVER_RE.test(stripped) && stripped === getRunningVersion()) {
    return null;
  }
  return raw;
}

// Pretty-print the build tag for display. Recognises the local-build
// convention (`local-YYYYMMDD-HHMM` produced by scripts/redeploy.sh)
// and renders it as a readable timestamp. Unknown formats are returned
// as-is so CI tags / RC versions still surface verbatim.
const LOCAL_BUILD_RE = /^local-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/;
export function formatBuildTag(tag: string): string {
  const m = LOCAL_BUILD_RE.exec(tag);
  if (!m) return tag;
  const [, y, mo, d, h, mi] = m;
  return `${y}-${mo}-${d} ${h}:${mi}`;
}
