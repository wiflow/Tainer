import "server-only";

import http from "node:http";
import https from "node:https";

import {
  DEFAULT_IPAM_TIMEOUT_MS,
  IPAM_TIMEOUT_MS_MAX,
  getDecryptedIpamToken,
  getIpamIntegration,
  type PhpIpamIntegrationInput,
} from "@/lib/integrations";

type PhpIpamEnvelope<T> = {
  code?: number;
  data?: T;
  message?: string;
  success?: boolean;
};

type PhpIpamAddressRecord = {
  description?: string | null;
  hostname?: string | null;
  id: string;
  ip?: string | null;
  note?: string | null;
  owner?: string | null;
};

type PhpIpamSubnetRecord = {
  id: string;
  mask?: string | null;
  subnet?: string | null;
};

type PhpIpamRuntimeConfig = {
  apiBaseUrl: string;
  appId: string;
  tlsInsecure: boolean;
  timeoutMs: number;
  token: string;
};

export type ExternalIpamAddressUsage = {
  address: string;
  details: string | null;
  label: string;
  service: string | null;
};

export type ExternalIpamUsageResult = {
  addresses: ExternalIpamAddressUsage[];
  configured: boolean;
  issue: string | null;
};

const IPAM_USAGE_CACHE_TTL_MS = 15_000;

const ipamUsageCache = new Map<string, {
  expiresAt: number;
  result: ExternalIpamUsageResult;
}>();

function clampTimeoutMs(value: number | undefined): number {
  if (!Number.isFinite(value) || (value as number) < 500) {
    return DEFAULT_IPAM_TIMEOUT_MS;
  }
  return Math.min(value as number, IPAM_TIMEOUT_MS_MAX);
}

function buildApiBaseUrl(serverUrl: string, appId: string): string {
  const trimmedRoot = serverUrl.replace(/\/+$/, "");
  const trimmedApp = appId.replace(/^\/+|\/+$/g, "");
  return `${trimmedRoot}/api/${trimmedApp}`;
}

function readCachedIpamUsage(key: string) {
  const cached = ipamUsageCache.get(key);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    ipamUsageCache.delete(key);
    return null;
  }

  return cached.result;
}

function writeCachedIpamUsage(key: string, result: ExternalIpamUsageResult) {
  ipamUsageCache.set(key, {
    expiresAt: Date.now() + IPAM_USAGE_CACHE_TTL_MS,
    result,
  });
}

async function loadActiveRuntimeConfig(): Promise<PhpIpamRuntimeConfig | null> {
  const integration = await getIpamIntegration();
  if (!integration || !integration.enabled) return null;
  if (!integration.serverUrl || !integration.appId || !integration.encryptedToken) {
    return null;
  }
  const token = await getDecryptedIpamToken(integration);
  return {
    apiBaseUrl: buildApiBaseUrl(integration.serverUrl, integration.appId),
    appId: integration.appId,
    tlsInsecure: integration.tlsInsecure,
    timeoutMs: clampTimeoutMs(integration.timeoutMs),
    token,
  };
}

function phpIpamRequest<T>(config: PhpIpamRuntimeConfig, endpoint: string): Promise<T> {
  const url = new URL(endpoint.replace(/^\/+/, ""), `${config.apiBaseUrl}/`);
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    const req = transport.request(
      url,
      {
        headers: {
          Accept: "application/json",
          token: config.token,
        },
        method: "GET",
        rejectUnauthorized: !config.tlsInsecure,
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          settle(() => {
            const statusCode = response.statusCode ?? 0;

            let parsed: PhpIpamEnvelope<T> | null = null;
            try {
              parsed = raw ? (JSON.parse(raw) as PhpIpamEnvelope<T>) : null;
            } catch {
              parsed = null;
            }

            if (statusCode < 200 || statusCode >= 300 || parsed?.success === false) {
              const message = parsed?.message?.trim() || raw.slice(0, 300).trim() || "Unknown IPAM error";
              reject(new Error(`IPAM request failed (${statusCode || "unknown"}): ${message}`));
              return;
            }

            resolve((parsed?.data ?? null) as T);
          });
        });
      },
    );

    const timeoutHandle = setTimeout(() => {
      req.destroy(new Error(`IPAM request timed out after ${config.timeoutMs} ms.`));
    }, config.timeoutMs);
    timeoutHandle.unref?.();

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);
      callback();
    };

    req.on("error", (error) => {
      settle(() => {
        reject(new Error(`IPAM request failed: ${error.message}`));
      });
    });

    req.end();
  });
}

function buildUsageLabel(record: PhpIpamAddressRecord) {
  const service = record.description?.trim()
    || record.note?.trim()
    || null;
  const primary = service
    || record.hostname?.trim()
    || record.owner?.trim()
    || "Reserved in IPAM";

  const details = [
    record.hostname?.trim(),
    record.owner?.trim(),
    record.note?.trim(),
  ]
    .filter((value): value is string => Boolean(value) && value !== service)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(" · ");

  return {
    details: details || null,
    label: primary,
    service,
  };
}

function isNotFoundError(error: unknown) {
  return error instanceof Error
    && /IPAM request failed \((404|409)\):/i.test(error.message);
}

export async function getIpamConfigState() {
  const config = await loadActiveRuntimeConfig();
  return {
    appId: config?.appId ?? "",
    configured: Boolean(config),
  };
}

/**
 * Probe the supplied phpIPAM credentials with a single lightweight call.
 * Used by the "Test connection" button so an admin can verify config
 * before saving — accepts plaintext input (with an optional fallback
 * token from the existing saved integration) so we don't have to
 * persist broken settings just to test them.
 */
export async function testPhpIpamConnection(
  input: PhpIpamIntegrationInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const serverUrl = input.serverUrl.trim().replace(/\/+$/, "");
  const appId = input.appId.trim().replace(/^\/+|\/+$/g, "");

  if (!serverUrl || !appId) {
    return { ok: false, error: "Server URL and App ID are required." };
  }

  let token = input.token.trim();
  if (!token) {
    const existing = await getIpamIntegration();
    if (existing?.encryptedToken) {
      try {
        token = await getDecryptedIpamToken(existing);
      } catch {
        return { ok: false, error: "Saved token could not be decrypted. Re-enter the token." };
      }
    }
  }
  if (!token) {
    return { ok: false, error: "API token is required." };
  }

  const config: PhpIpamRuntimeConfig = {
    apiBaseUrl: buildApiBaseUrl(serverUrl, appId),
    appId,
    tlsInsecure: input.tlsInsecure,
    timeoutMs: clampTimeoutMs(input.timeoutMs),
    token,
  };

  try {
    // /sections/ is universally available on a working phpIPAM API app.
    // Returning here means auth + base URL + app ID all line up.
    await phpIpamRequest<unknown>(config, "/sections/");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown IPAM error.",
    };
  }
}

export async function getIpamUsedAddressesForSubnet(cidr: string): Promise<ExternalIpamUsageResult> {
  const config = await loadActiveRuntimeConfig();

  if (!config) {
    return {
      addresses: [],
      configured: false,
      issue: null,
    };
  }

  const cacheKey = `${config.apiBaseUrl}|${cidr.trim()}`;
  const cached = readCachedIpamUsage(cacheKey);

  if (cached) {
    return cached;
  }

  try {
    const [subnetAddress = "", prefix = ""] = cidr.trim().split("/", 2);
    const subnetRecords = await phpIpamRequest<PhpIpamSubnetRecord[]>(
      config,
      `/subnets/cidr/${subnetAddress}/${prefix}/`,
    ).catch((error) => {
      if (isNotFoundError(error)) {
        return [];
      }
      throw error;
    });

    const subnet = subnetRecords.find((record) => {
      return record.subnet?.trim() === subnetAddress && record.mask?.trim() === prefix;
    }) ?? subnetRecords[0];

    if (!subnet?.id) {
      const result = {
        addresses: [],
        configured: true,
        issue: null,
      };
      writeCachedIpamUsage(cacheKey, result);
      return result;
    }

    const addressRecords = await phpIpamRequest<PhpIpamAddressRecord[]>(
      config,
      `/subnets/${subnet.id}/addresses/`,
    ).catch((error) => {
      if (isNotFoundError(error)) {
        return [];
      }
      throw error;
    });

    const result = {
      addresses: addressRecords
        .map((record) => {
          const address = record.ip?.trim() || "";
          if (!address) {
            return null;
          }

          const usage = buildUsageLabel(record);
          return {
            address,
            details: usage.details,
            label: usage.label,
            service: usage.service,
          };
        })
        .filter((record): record is ExternalIpamAddressUsage => Boolean(record)),
      configured: true,
      issue: null,
    };
    writeCachedIpamUsage(cacheKey, result);
    return result;
  } catch (error) {
    const result = {
      addresses: [],
      configured: true,
      issue: error instanceof Error ? error.message : "Unknown IPAM lookup failure.",
    };
    writeCachedIpamUsage(cacheKey, result);
    return result;
  }
}
