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
