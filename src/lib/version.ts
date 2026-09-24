import packageJson from "../../package.json";

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

function readBaked(): string | null {
  const raw = process.env.TAINER_VERSION?.trim();
  if (!raw || raw === "dev") return null;
  const stripped = raw.startsWith("v") ? raw.slice(1) : raw;
  return SEMVER_RE.test(stripped) ? stripped : null;
}

let cached: string | null = null;

export function getRunningVersion(): string {
  if (cached !== null) return cached;
  cached = readBaked() ?? packageJson.version;
  return cached;
}

export function isDevBuild(): boolean {
  return readBaked() === null;
}

export function getBuildTag(): string | null {
  const raw = process.env.TAINER_VERSION?.trim();
  if (!raw || raw === "dev") return null;
  const stripped = raw.startsWith("v") ? raw.slice(1) : raw;
  if (SEMVER_RE.test(stripped) && stripped === getRunningVersion()) {
    return null;
  }
  return raw;
}

const LOCAL_BUILD_RE = /^local-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/;
export function formatBuildTag(tag: string): string {
  const m = LOCAL_BUILD_RE.exec(tag);
  if (!m) return tag;
  const [, y, mo, d, h, mi] = m;
  return `${y}-${mo}-${d} ${h}:${mi}`;
}
