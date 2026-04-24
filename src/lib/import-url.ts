import "server-only";

import { lookup, Resolver } from "node:dns/promises";
import { isIP } from "node:net";

function readAllowlist(envKeys: string[]) {
  return envKeys.flatMap((envKey) =>
    (process.env[envKey] ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

function buildAllowlistHint(envKeys: string[]) {
  if (envKeys.length === 0) {
    return "Ask an administrator to explicitly allow the host if it is trusted.";
  }

  if (envKeys.length === 1) {
    return `Use ${envKeys[0]} to permit trusted internal hosts.`;
  }

  return `Use one of ${envKeys.join(", ")} to permit trusted internal hosts.`;
}

function isPrivateIpv4(address: string) {
  const [first = 0, second = 0] = address
    .split(".")
    .map((segment) => Number.parseInt(segment, 10));

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    first >= 224
  );
}

function expandIpv6(address: string) {
  const [leftRaw, rightRaw] = address.toLowerCase().split("::");
  const left = leftRaw ? leftRaw.split(":").filter(Boolean) : [];
  const right = rightRaw ? rightRaw.split(":").filter(Boolean) : [];

  if (address.includes("::")) {
    const missing = 8 - (left.length + right.length);
    if (missing < 0) {
      return null;
    }
    return [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  }

  const groups = address.split(":").filter(Boolean);
  return groups.length === 8 ? groups : null;
}

function isPrivateIpv6(address: string) {
  const normalized = address.replace(/^\[|\]$/g, "");

  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  const groups = expandIpv6(normalized);
  if (!groups) {
    return true;
  }

  const first = Number.parseInt(groups[0] ?? "0", 16);

  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00
  );
}

function isPrivateAddress(address: string) {
  const version = isIP(address);

  if (version === 4) {
    return isPrivateIpv4(address);
  }

  if (version === 6) {
    return isPrivateIpv6(address);
  }

  return true;
}

async function resolveWithCares(hostname: string): Promise<string[]> {
  const resolver = new Resolver();
  const addresses: string[] = [];

  const [v4Result, v6Result] = await Promise.allSettled([
    resolver.resolve4(hostname),
    resolver.resolve6(hostname),
  ]);

  if (v4Result.status === "fulfilled") {
    addresses.push(...v4Result.value);
  }
  if (v6Result.status === "fulfilled") {
    addresses.push(...v6Result.value);
  }

  return addresses;
}

function matchesAllowlist(hostname: string, allowlist: string[]) {
  const normalizedHost = hostname.toLowerCase();

  return allowlist.some((entry) => {
    const normalizedEntry = entry.replace(/^\*\./, ".").toLowerCase();

    if (normalizedEntry.startsWith(".")) {
      return normalizedHost.endsWith(normalizedEntry);
    }

    return normalizedHost === normalizedEntry;
  });
}

async function assertSafePublicHost(
  hostname: string,
  label: string,
  allowlistEnvKeys: string[],
) {
  const allowlist = readAllowlist(allowlistEnvKeys);
  const allowlistHint = buildAllowlistHint(allowlistEnvKeys);

  if (matchesAllowlist(hostname, allowlist)) {
    return hostname;
  }

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    !hostname.includes(".")
  ) {
    throw new Error(
      `${label} must be public. ${allowlistHint}`,
    );
  }

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error(
        `Private or local ${label.toLowerCase()}s are blocked. ${allowlistHint}`,
      );
    }

    return hostname;
  }

  let resolved;
  try {
    resolved = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(
      `${label} could not be resolved. ${allowlistHint}`,
    );
  }

  if (resolved.length === 0 || resolved.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error(
      `Private or local ${label.toLowerCase()}s are blocked. ${allowlistHint}`,
    );
  }

  // Defense-in-depth against DNS rebinding: re-resolve using c-ares which
  // bypasses the OS DNS cache. Since the actual fetch is delegated to
  // Proxmox (which resolves independently), an attacker could serve a
  // public IP to pass our check, then flip to a private IP before Proxmox
  // resolves. Checking with a second resolver narrows this window.
  const caresAddresses = await resolveWithCares(hostname);
  if (caresAddresses.length > 0 && caresAddresses.some((addr) => isPrivateAddress(addr))) {
    throw new Error(
      `${label} resolved to a private address on secondary lookup. ${allowlistHint}`,
    );
  }

  return hostname;
}

export async function assertSafeRemoteHost(
  rawHost: string,
  label = "Host",
  allowlistEnvKeys = ["TAINER_DOWNLOAD_URL_ALLOWLIST"],
) {
  let hostname: string;

  try {
    hostname = new URL(`https://${rawHost.trim()}`).hostname.trim().toLowerCase();
  } catch {
    throw new Error(`${label} is invalid.`);
  }

  if (!hostname) {
    throw new Error(`${label} is missing a hostname.`);
  }

  return assertSafePublicHost(hostname, label, allowlistEnvKeys);
}

async function assertSafeHttpUrl(
  rawUrl: string,
  label: string,
  allowlistEnvKeys: string[],
) {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`${label} must be a valid http or https URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must use http or https.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not include embedded credentials.`);
  }

  const hostname = parsed.hostname.trim().toLowerCase();

  if (!hostname) {
    throw new Error(`${label} is missing a hostname.`);
  }

  await assertSafePublicHost(`${hostname}`, `${label} hostname`, allowlistEnvKeys);

  return parsed.toString();
}

export async function assertSafeDownloadUrl(rawUrl: string) {
  return assertSafeHttpUrl(rawUrl, "Download URL", ["TAINER_DOWNLOAD_URL_ALLOWLIST"]);
}

export async function assertSafeWebhookUrl(rawUrl: string) {
  return assertSafeHttpUrl(rawUrl, "Webhook URL", ["TAINER_WEBHOOK_URL_ALLOWLIST"]);
}
