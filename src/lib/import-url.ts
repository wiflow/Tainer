import "server-only";

import { lookup as lookupCallback } from "node:dns";
import { lookup, Resolver } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";

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
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function expandIpv6(rawAddress: string) {
  let address = rawAddress.toLowerCase();
  const dottedTail = /^(.*:)([^:]+\.[^:]+)$/.exec(address);
  if (dottedTail) {
    if (isIP(dottedTail[2]) !== 4) {
      return null;
    }
    const [a = 0, b = 0, c = 0, d = 0] = dottedTail[2].split(".").map(Number);
    address = `${dottedTail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const [leftRaw, rightRaw] = address.split("::");
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

  const words = groups.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : NaN));
  if (words.some((word) => Number.isNaN(word))) {
    return true;
  }

  const embeddedIpv4 = (high: number, low: number) =>
    `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  const [first = 0, second = 0, third = 0] = words;

  // IPv4-mapped, IPv4-compatible and SIIT (::ffff:0:0/96) addresses
  if (
    words.slice(0, 4).every((word) => word === 0) &&
    ((words[4] === 0 && (words[5] === 0 || words[5] === 0xffff)) ||
      (words[4] === 0xffff && words[5] === 0))
  ) {
    return isPrivateIpv4(embeddedIpv4(words[6] ?? 0, words[7] ?? 0));
  }

  // NAT64 (64:ff9b::/96 and the local-use 64:ff9b:1::/48)
  if (first === 0x64 && second === 0xff9b) {
    return third === 1 || isPrivateIpv4(embeddedIpv4(words[6] ?? 0, words[7] ?? 0));
  }

  // 6to4 (2002::/16)
  if (first === 0x2002) {
    return isPrivateIpv4(embeddedIpv4(second, third));
  }

  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00
  );
}

export function isPrivateAddress(address: string) {
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

  // Proxmox resolves the host again itself, so re-check with c-ares to narrow DNS rebinding.
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

const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  lookupCallback(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, "");
      return;
    }
    if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
      callback(Object.assign(new Error(`Blocked private address for ${hostname}.`), { code: "EACCES" }), "");
      return;
    }
    if (options.all) {
      callback(null, addresses);
      return;
    }
    callback(null, addresses[0].address, addresses[0].family);
  });
};

// Redirects are not followed and the dialled address is re-checked against DNS rebinding.
export async function postToWebhookUrl(
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; statusText: string }> {
  const url = new URL(await assertSafeWebhookUrl(rawUrl));
  const allowlisted = matchesAllowlist(url.hostname, readAllowlist(["TAINER_WEBHOOK_URL_ALLOWLIST"]));
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
        lookup: allowlisted ? undefined : publicOnlyLookup,
        method: "POST",
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          clearTimeout(timer);
          resolve({ status: response.statusCode ?? 0, statusText: response.statusMessage ?? "" });
        });
        response.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      },
    );
    const timer = setTimeout(() => {
      request.destroy(new Error("Webhook request timed out."));
    }, timeoutMs);
    request.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end(body);
  });
}
