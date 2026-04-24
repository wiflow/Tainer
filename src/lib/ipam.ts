import "server-only";

import http from "node:http";
import https from "node:https";

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

type PhpIpamConfig = {
  apiBaseUrl: string;
  appId: string;
  configured: boolean;
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

const DEFAULT_IPAM_TIMEOUT_MS = 3_500;
const IPAM_TIMEOUT_MS_MAX = 30_000;
const IPAM_USAGE_CACHE_TTL_MS = 15_000;

const ipamUsageCache = new Map<string, {
  expiresAt: number;
  result: ExternalIpamUsageResult;
}>();

function normalizeIpamTimeoutMs(value: string | undefined) {
  const parsed = Number.parseInt(value?.trim() || "", 10);

  if (!Number.isFinite(parsed) || parsed < 500) {
    return DEFAULT_IPAM_TIMEOUT_MS;
  }

  return Math.min(parsed, IPAM_TIMEOUT_MS_MAX);
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

function derivePhpIpamConfig(): PhpIpamConfig {
  const rawBaseUrl = process.env.IPAM_BASE_URL?.trim().replace(/\/+$/, "") || "";
  const token = process.env.IPAM_TOKEN?.trim() || "";
  const envAppId = process.env.IPAM_APP_ID?.trim() || "";
  const tlsInsecure = process.env.IPAM_TLS_INSECURE === "true";
  const timeoutMs = normalizeIpamTimeoutMs(process.env.IPAM_TIMEOUT_MS);

  if (!rawBaseUrl || !token) {
    return {
      apiBaseUrl: "",
      appId: "",
      configured: false,
      tlsInsecure,
      timeoutMs,
      token,
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawBaseUrl);
  } catch {
    return {
      apiBaseUrl: "",
      appId: "",
      configured: false,
      tlsInsecure,
      timeoutMs,
      token,
    };
  }

  const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
  const apiIndex = pathSegments.findIndex((segment) => segment === "api");
  const pathAppId = apiIndex >= 0 ? (pathSegments[apiIndex + 1] ?? "") : "";
  const appId = pathAppId || envAppId;

  if (!appId) {
    return {
      apiBaseUrl: "",
      appId: "",
      configured: false,
      tlsInsecure,
      timeoutMs,
      token,
    };
  }

  const prefixSegments = apiIndex >= 0 ? pathSegments.slice(0, apiIndex) : pathSegments;
  const prefixPath = prefixSegments.length > 0 ? `/${prefixSegments.join("/")}` : "";

  return {
    apiBaseUrl: `${parsedUrl.origin}${prefixPath}/api/${appId}`,
    appId,
    configured: true,
    tlsInsecure,
    timeoutMs,
    token,
  };
}

function phpIpamRequest<T>(endpoint: string): Promise<T> {
  const config = derivePhpIpamConfig();

  if (!config.configured) {
    return Promise.reject(new Error("IPAM is not fully configured. Set IPAM_BASE_URL, IPAM_TOKEN, and IPAM_APP_ID."));
  }

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

export function getIpamConfigState() {
  const config = derivePhpIpamConfig();
  return {
    appId: config.appId,
    configured: config.configured,
  };
}

export async function getIpamUsedAddressesForSubnet(cidr: string): Promise<ExternalIpamUsageResult> {
  const config = derivePhpIpamConfig();

  if (!config.configured) {
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
