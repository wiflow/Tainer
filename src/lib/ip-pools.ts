import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";

import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { getIpamUsedAddressesForSubnet } from "@/lib/ipam";
import { getDeploymentIndex, type LiveDeployment } from "@/lib/proxmox";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

const BRIDGE_REGEX = /^[a-zA-Z0-9._-]{1,32}$/;
const MAX_POOL_IPS = 1024;

export type IpPool = {
  bridge: string;
  createdAt: string;
  defaultDns: string;
  gateway: string;
  id: string;
  name: string;
  subnet: string;
  tagSlug: string | null;
  updatedAt: string;
};

export type IpPoolInput = Omit<IpPool, "createdAt" | "id" | "updatedAt">;

export type IpPoolAddressUsage = {
  address: string;
  details?: string | null;
  deploymentId: string;
  deploymentLabel: string;
  service?: string | null;
  source: "ipam" | "tainer";
};

export type IpPoolCatalogEntry = IpPool & {
  availableAddresses: string[];
  availableCount: number;
  firstHost: string;
  hostPrefix: number;
  ipamIssue: string | null;
  ipamUsedAddresses: IpPoolAddressUsage[];
  ipamUsedCount: number;
  lastHost: string;
  networkAddress: string;
  tainerUsedAddresses: IpPoolAddressUsage[];
  tainerUsedCount: number;
  usedAddresses: IpPoolAddressUsage[];
  usedCount: number;
  usableHostCount: number;
};

type IpPoolStore = {
  pools: IpPool[];
};

type ParsedSubnet = {
  broadcastInt: number;
  cidr: string;
  firstHost: string;
  firstHostInt: number;
  hostPrefix: number;
  lastHost: string;
  lastHostInt: number;
  networkAddress: string;
  networkInt: number;
  usableHostCount: number;
};

function ipv4ToInt(address: string) {
  const octets = address.split(".").map((segment) => Number.parseInt(segment, 10));

  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error(`Invalid IPv4 address "${address}".`);
  }

  return (((octets[0] ?? 0) << 24) >>> 0)
    + (((octets[1] ?? 0) << 16) >>> 0)
    + (((octets[2] ?? 0) << 8) >>> 0)
    + ((octets[3] ?? 0) >>> 0);
}

function intToIpv4(value: number) {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}

function normalizeNameserverList(value: string) {
  const addresses = value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const address of addresses) {
    if (isIP(address) === 0) {
      throw new Error(`Invalid DNS server "${address}". Use IP addresses only.`);
    }
  }

  return addresses.join(" ");
}

function parseSubnet(value: string): ParsedSubnet {
  const trimmed = value.trim();
  const [address = "", prefixText = ""] = trimmed.split("/", 2);
  const prefix = Number(prefixText);

  if (
    !trimmed ||
    trimmed.split("/").length !== 2 ||
    isIP(address) !== 4 ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 32
  ) {
    throw new Error("Invalid subnet. Use an IPv4 CIDR like 10.0.10.0/24.");
  }

  if (prefix > 30) {
    throw new Error("Subnets smaller than /30 do not have enough usable IPv4 addresses.");
  }

  const addressInt = ipv4ToInt(address);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  // Bitwise ops return signed 32-bit ints, so results are coerced back with >>> 0.
  const networkInt = (addressInt & mask) >>> 0;
  const broadcastInt = (networkInt | (~mask >>> 0)) >>> 0;
  const firstHostInt = networkInt + 1;
  const lastHostInt = broadcastInt - 1;
  const usableHostCount = lastHostInt >= firstHostInt
    ? lastHostInt - firstHostInt + 1
    : 0;

  if (usableHostCount <= 0) {
    throw new Error("That subnet does not expose any usable IPv4 host addresses.");
  }

  if (usableHostCount > MAX_POOL_IPS) {
    throw new Error(`That subnet is too large to load into Tainer. Limit pools to ${MAX_POOL_IPS} usable IPs or fewer.`);
  }

  return {
    broadcastInt,
    cidr: `${intToIpv4(networkInt)}/${prefix}`,
    firstHost: intToIpv4(firstHostInt),
    firstHostInt,
    hostPrefix: prefix,
    lastHost: intToIpv4(lastHostInt),
    lastHostInt,
    networkAddress: intToIpv4(networkInt),
    networkInt,
    usableHostCount,
  };
}

function validateBridge(value: string) {
  const trimmed = value.trim();

  if (!trimmed || !BRIDGE_REGEX.test(trimmed)) {
    throw new Error("Invalid bridge. Use a Proxmox bridge name like vmbr0.");
  }

  return trimmed;
}

function validateGateway(value: string, subnet: ParsedSubnet) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (isIP(trimmed) !== 4) {
    throw new Error("Invalid gateway. Use an IPv4 address.");
  }

  const gatewayInt = ipv4ToInt(trimmed);
  if (gatewayInt < subnet.firstHostInt || gatewayInt > subnet.lastHostInt) {
    throw new Error("Gateway must fall within the selected subnet's usable host range.");
  }

  return trimmed;
}

function normalizeName(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error("Pool name is required.");
  }

  if (trimmed.length > 80) {
    throw new Error("Pool name must be 80 characters or fewer.");
  }

  return trimmed;
}

function normalizeTagSlug(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

function rangesOverlap(left: ParsedSubnet, right: ParsedSubnet) {
  return left.networkInt <= right.broadcastInt && right.networkInt <= left.broadcastInt;
}

function normalizePoolInput(input: IpPoolInput) {
  const subnet = parseSubnet(input.subnet);

  return {
    bridge: validateBridge(input.bridge),
    defaultDns: input.defaultDns ? normalizeNameserverList(input.defaultDns) : "",
    gateway: validateGateway(input.gateway, subnet),
    name: normalizeName(input.name),
    subnet,
    tagSlug: normalizeTagSlug(input.tagSlug),
  };
}

async function readStore(): Promise<IpPoolStore> {
  try {
    const raw = await readFile(await resolveSiteDataFilePathFromContext("ip-pools.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<IpPoolStore>;

    return {
      pools: Array.isArray(parsed.pools) ? parsed.pools.filter((pool): pool is IpPool => {
        return typeof pool === "object"
          && pool !== null
          && typeof pool.id === "string"
          && typeof pool.name === "string"
          && typeof pool.subnet === "string";
      }) : [],
    };
  } catch {
    return {
      pools: [],
    };
  }
}

async function writeStore(store: IpPoolStore) {
  const filePath = await resolveSiteDataFilePathFromContext("ip-pools.json");
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("ip-pools", readStore, writeStore);

function buildDeploymentLabel(deployment: LiveDeployment) {
  return `${deployment.name} (${deployment.type.toUpperCase()} ${deployment.vmid})`;
}

function listUsedAddressesForPool(subnet: ParsedSubnet, deployments: LiveDeployment[]) {
  const usedByAddress = new Map<string, IpPoolAddressUsage>();

  for (const deployment of deployments) {
    const address = deployment.ipAddress.trim();

    if (isIP(address) !== 4) {
      continue;
    }

    const addressInt = ipv4ToInt(address);
    if (addressInt < subnet.firstHostInt || addressInt > subnet.lastHostInt) {
      continue;
    }

    if (!usedByAddress.has(address)) {
      usedByAddress.set(address, {
        address,
        details: null,
        deploymentId: deployment.id,
        deploymentLabel: buildDeploymentLabel(deployment),
        service: null,
        source: "tainer",
      });
    }
  }

  return Array.from(usedByAddress.values()).sort((left, right) => {
    return ipv4ToInt(left.address) - ipv4ToInt(right.address);
  });
}

function mergeUsedAddresses(
  tainerUsedAddresses: IpPoolAddressUsage[],
  ipamUsedAddresses: IpPoolAddressUsage[],
) {
  const merged = new Map<string, IpPoolAddressUsage>();

  for (const entry of ipamUsedAddresses) {
    merged.set(entry.address, entry);
  }

  for (const entry of tainerUsedAddresses) {
    const existing = merged.get(entry.address);
    if (existing?.source === "ipam") {
      merged.set(entry.address, {
        ...entry,
        details: existing.deploymentLabel,
      });
    } else {
      merged.set(entry.address, entry);
    }
  }

  return Array.from(merged.values()).sort((left, right) => {
    return ipv4ToInt(left.address) - ipv4ToInt(right.address);
  });
}

function buildAvailableAddresses(subnet: ParsedSubnet, usedAddresses: IpPoolAddressUsage[]) {
  const used = new Set(usedAddresses.map((entry) => entry.address));
  const addresses: string[] = [];

  for (let current = subnet.firstHostInt; current <= subnet.lastHostInt; current += 1) {
    const address = intToIpv4(current);
    if (!used.has(address)) {
      addresses.push(address);
    }
  }

  return addresses;
}

export async function listIpPools() {
  const store = await readStore();

  return [...store.pools].sort((left, right) => {
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

export async function getIpPool(id: string) {
  const pools = await listIpPools();
  return pools.find((pool) => pool.id === id) ?? null;
}

export async function createIpPool(input: IpPoolInput) {
  return mutateStore((store) => {
    const normalized = normalizePoolInput(input);

    if (store.pools.some((pool) => pool.name.localeCompare(normalized.name, undefined, { sensitivity: "base" }) === 0)) {
      throw new Error(`An IP pool named "${normalized.name}" already exists.`);
    }

    for (const existingPool of store.pools) {
      const existingSubnet = parseSubnet(existingPool.subnet);
      if (rangesOverlap(existingSubnet, normalized.subnet)) {
        throw new Error(`Subnet ${normalized.subnet.cidr} overlaps existing pool "${existingPool.name}" (${existingPool.subnet}).`);
      }
    }

    const timestamp = new Date().toISOString();
    const pool: IpPool = {
      bridge: normalized.bridge,
      createdAt: timestamp,
      defaultDns: normalized.defaultDns,
      gateway: normalized.gateway,
      id: randomUUID(),
      name: normalized.name,
      subnet: normalized.subnet.cidr,
      tagSlug: normalized.tagSlug,
      updatedAt: timestamp,
    };

    store.pools.push(pool);

    return pool;
  });
}

export async function deleteIpPool(id: string) {
  return mutateStore((store) => {
    const index = store.pools.findIndex((pool) => pool.id === id);

    if (index === -1) {
      return false;
    }

    store.pools.splice(index, 1);
    return true;
  });
}

export async function getIpPoolCatalog() {
  const [pools, { deployments }] = await Promise.all([
    listIpPools(),
    getDeploymentIndex(),
  ]);

  const ipamResults = await Promise.all(
    pools.map(async (pool) => ({
      poolId: pool.id,
      result: await getIpamUsedAddressesForSubnet(pool.subnet),
    })),
  );
  const ipamByPoolId = new Map(ipamResults.map((entry) => [entry.poolId, entry.result]));

  return pools.map<IpPoolCatalogEntry>((pool) => {
    const subnet = parseSubnet(pool.subnet);
    const tainerUsedAddresses = listUsedAddressesForPool(subnet, deployments);
    const ipamResult = ipamByPoolId.get(pool.id) ?? {
      addresses: [],
      configured: false,
      issue: null,
    };
    const ipamUsedAddresses = ipamResult.addresses
      .filter((entry) => {
        if (isIP(entry.address) !== 4) {
          return false;
        }

        const addressInt = ipv4ToInt(entry.address);
        return addressInt >= subnet.firstHostInt && addressInt <= subnet.lastHostInt;
      })
      .map<IpPoolAddressUsage>((entry) => ({
        address: entry.address,
        details: entry.details,
        deploymentId: `ipam:${pool.id}:${entry.address}`,
        deploymentLabel: entry.label,
        service: entry.service,
        source: "ipam",
      }));
    const usedAddresses = mergeUsedAddresses(tainerUsedAddresses, ipamUsedAddresses);
    const availableAddresses = buildAvailableAddresses(subnet, usedAddresses);

    return {
      ...pool,
      availableAddresses,
      availableCount: availableAddresses.length,
      firstHost: subnet.firstHost,
      hostPrefix: subnet.hostPrefix,
      ipamIssue: ipamResult.issue,
      ipamUsedAddresses,
      ipamUsedCount: ipamUsedAddresses.length,
      lastHost: subnet.lastHost,
      networkAddress: subnet.networkAddress,
      tainerUsedAddresses,
      tainerUsedCount: tainerUsedAddresses.length,
      usedAddresses,
      usedCount: usedAddresses.length,
      usableHostCount: subnet.usableHostCount,
    };
  });
}

export async function resolveIpPoolSelection(poolId: string, address: string) {
  const normalizedPoolId = poolId.trim();
  const normalizedAddress = address.trim();

  if (!normalizedPoolId) {
    throw new Error("Select an IP pool.");
  }

  if (isIP(normalizedAddress) !== 4) {
    throw new Error("Select a valid IPv4 address from the chosen pool.");
  }

  const catalog = await getIpPoolCatalog();
  const pool = catalog.find((entry) => entry.id === normalizedPoolId);

  if (!pool) {
    throw new Error("The selected IP pool no longer exists.");
  }

  if (!pool.availableAddresses.includes(normalizedAddress)) {
    if (pool.usedAddresses.some((entry) => entry.address === normalizedAddress)) {
      throw new Error(`IP ${normalizedAddress} is already in use inside "${pool.name}".`);
    }

    throw new Error(`IP ${normalizedAddress} is not part of "${pool.name}".`);
  }

  return {
    bridge: pool.bridge,
    gateway: pool.gateway,
    ipv4Cidr: `${normalizedAddress}/${pool.hostPrefix}`,
    nameserver: pool.defaultDns,
    pool,
    tagSlug: pool.tagSlug,
  };
}
