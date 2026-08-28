import "server-only";

import { access } from "node:fs/promises";
import https from "node:https";
import path from "node:path";

import { getExtraCaCerts } from "@/lib/aia-fetch";
import { getActiveSiteConfig, getPveTicket } from "@/lib/proxmox";
import { runSshCommand } from "@/lib/ssh-command";
import { buildProxmoxUrl } from "@/lib/utils";

const NODE_NAME_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,61}[a-zA-Z0-9])?$/;
const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
const LXC_CONFIG_LINE_REGEX = /^lxc\.[A-Za-z0-9_.-]+\s*:\s*.+$/;
const SSH_USERNAME_REGEX = /^[A-Za-z0-9._-]+$/;

function validateNodeName(value: string) {
  const normalized = value.trim();

  if (!NODE_NAME_REGEX.test(normalized)) {
    throw new Error("Invalid Proxmox node name.");
  }

  return normalized;
}

function validateVmid(value: number) {
  if (!Number.isInteger(value) || value <= 0 || value > 999_999_999) {
    throw new Error("Invalid VMID.");
  }

  return value;
}

function validateIpv4Address(value: string) {
  if (
    !IPV4_REGEX.test(value) ||
    !value.split(".").every((octet) => {
      const parsed = Number.parseInt(octet, 10);
      return parsed >= 0 && parsed <= 255;
    })
  ) {
    throw new Error("Invalid Proxmox node IP address.");
  }

  return value;
}

function getProxmoxConsoleUser() {
  const config = getActiveSiteConfig();
  // Extract the OS-level username from the Proxmox username (e.g. "root@pam" → "root")
  const pveUser = config.username?.trim() || "root@pam";
  const osUser = pveUser.split("@")[0] || "root";

  if (!SSH_USERNAME_REGEX.test(osUser)) {
    throw new Error("Invalid username value for site.");
  }

  return osUser;
}

function shellSingleQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getProxmoxApiConfig() {
  const config = getActiveSiteConfig();

  return {
    username: config.username,
    password: config.password,
    tlsInsecure: config.tlsInsecure,
    url: config.apiUrl,
  };
}

async function resolveNodeIp(node: string): Promise<string> {
  const safeNode = validateNodeName(node);
  const config = getProxmoxApiConfig();

  // Combine custom CA + AIA intermediates into a single trust store
  const siteConfig = getActiveSiteConfig();
  let extraTlsOpts: { ca?: string[] } = {};
  if (!config.tlsInsecure) {
    const extras: string[] = [];
    if (siteConfig.tlsCustomCaPem) extras.push(siteConfig.tlsCustomCaPem);
    try {
      const parsed = new URL(config.url);
      const aiaCerts = await getExtraCaCerts(parsed.hostname, parsed.port || "8006");
      if (aiaCerts.length > 0) extras.push(...aiaCerts);
    } catch { /* proceed without */ }
    if (extras.length > 0) {
      const { rootCertificates } = await import("node:tls");
      extraTlsOpts = { ca: [...new Set([...rootCertificates, ...extras])] };
    }
  }

  const pveAuth = await getPveTicket(siteConfig);

  return await new Promise((resolve, reject) => {
    const endpoint = buildProxmoxUrl(`/api2/json/nodes/${safeNode}/network`, config.url);
    const request = https.request(
      endpoint,
      {
        headers: {
          Cookie: `PVEAuthCookie=${pveAuth.ticket}`,
        },
        method: "GET",
        rejectUnauthorized: !config.tlsInsecure,
        ...extraTlsOpts,
      },
      (response) => {
        let raw = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          try {
            const parsed = JSON.parse(raw) as {
              data?: Array<{ address?: string; type?: string }>;
            };
            const nodeIp = parsed.data?.find(
              (entry) =>
                entry.address &&
                (entry.type === "bridge" || entry.type === "eth"),
            )?.address;

            if (!nodeIp) {
              reject(new Error(`Failed to resolve SSH IP for Proxmox node ${safeNode}.`));
              return;
            }

            resolve(validateIpv4Address(nodeIp));
          } catch (error) {
            reject(
              error instanceof Error
                ? error
                : new Error(`Failed to parse node network data for ${safeNode}.`),
            );
          }
        });
      },
    );

    request.on("error", (error) => {
      reject(error);
    });

    request.end();
  });
}

async function getHostKeyOptions() {
  const config = getActiveSiteConfig();
  const policy = config.sshHostKeyPolicy || "strict";

  if (policy === "accept-new" || policy === "auto") {
    return ["-o", "StrictHostKeyChecking=accept-new"];
  }

  if (policy === "off") {
    return ["-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null"];
  }

  // policy === "strict"
  const knownHostsFile = process.env.HOME ? path.join(process.env.HOME, ".ssh", "known_hosts") : "";

  if (!knownHostsFile || !(await pathExists(knownHostsFile))) {
    throw new Error(
      "Missing known_hosts file for Proxmox host SSH. Configure SSH host key policy to 'accept-new' for this site.",
    );
  }

  return [
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${knownHostsFile}`,
  ];
}

async function runProxmoxRootCommand(
  node: string,
  remoteCommand: string,
  options?: { input?: string; timeoutMs?: number },
) {
  const safeNode = validateNodeName(node);
  const nodeIp = await resolveNodeIp(safeNode);
  const sshUser = getProxmoxConsoleUser();
  const config = getActiveSiteConfig();

  const hostKeyOptions = await getHostKeyOptions();
  const timeoutMs = options?.timeoutMs ?? 15_000;

  try {
    return await runSshCommand({
      destination: `${sshUser}@${nodeIp}`,
      hostKeyOptions,
      input: options?.input,
      password: config.password,
      remoteCommand,
      timeoutMs,
    });
  } catch (error) {
    const execError = error as NodeJS.ErrnoException;

    if (execError.code === "ENOENT") {
      throw new Error("OpenSSH client is required on the app server to repair custom LXC restore config.");
    }

    throw new Error(
      error instanceof Error
        ? error.message
        : `Failed to run a Proxmox host command on ${safeNode}.`,
    );
  }
}

/**
 * Run a root command on a Proxmox node over SSH. Used by the off-site backup
 * offload to drive rsync on the node that holds the archive.
 */
export async function runNodeRootCommand(
  node: string,
  remoteCommand: string,
  options?: { input?: string; timeoutMs?: number },
) {
  return runProxmoxRootCommand(node, remoteCommand, options);
}

function mergeCustomLxcConfig(
  currentConfig: string,
  configLines: string[],
) {
  const normalizedCurrent = currentConfig.replace(/\r\n/g, "\n");
  const activeSection: string[] = [];
  const snapshotSections: string[] = [];
  let inSnapshotSection = false;

  for (const line of normalizedCurrent.split("\n")) {
    if (!inSnapshotSection && /^\[.+\]$/.test(line.trim())) {
      inSnapshotSection = true;
    }

    if (inSnapshotSection) {
      snapshotSections.push(line);
    } else {
      activeSection.push(line);
    }
  }

  const desiredLines = configLines
    .map((line) => line.trim())
    .filter((line) => LXC_CONFIG_LINE_REGEX.test(line));

  const desiredKeys = new Set(
    desiredLines.map((line) => line.slice(0, line.indexOf(":")).trim()),
  );

  const mergedActive = activeSection.filter((line) => {
    const separatorIndex = line.indexOf(":");

    if (separatorIndex < 0) {
      return true;
    }

    const key = line.slice(0, separatorIndex).trim();
    return !desiredKeys.has(key);
  });

  while (mergedActive.length > 0 && mergedActive.at(-1) === "") {
    mergedActive.pop();
  }

  mergedActive.push(...desiredLines);

  if (snapshotSections.length > 0) {
    mergedActive.push("");
  }

  return `${[...mergedActive, ...snapshotSections].join("\n").replace(/\n+$/, "")}\n`;
}

export async function reapplySkippedCustomLxcConfig(
  node: string,
  vmid: number,
  configLines: string[],
) {
  const safeNode = validateNodeName(node);
  const safeVmid = validateVmid(vmid);
  const normalizedLines = [...new Set(
    configLines
      .map((line) => line.trim())
      .filter((line) => LXC_CONFIG_LINE_REGEX.test(line)),
  )];

  if (normalizedLines.length === 0) {
    return;
  }

  const configPath = `/etc/pve/lxc/${safeVmid}.conf`;
  const currentConfig = await runProxmoxRootCommand(
    safeNode,
    `cat ${shellSingleQuote(configPath)}`,
    { timeoutMs: 10_000 },
  );
  const nextConfig = mergeCustomLxcConfig(currentConfig, normalizedLines);

  if (nextConfig === `${currentConfig.replace(/\r\n/g, "\n").replace(/\n+$/, "")}\n`) {
    return;
  }

  await runProxmoxRootCommand(
    safeNode,
    `tmp=$(mktemp ${shellSingleQuote(`/etc/pve/lxc/${safeVmid}.conf.tainer.XXXXXX`)}) || exit 1
cat > "$tmp"
mv "$tmp" ${shellSingleQuote(configPath)}`,
    {
      input: nextConfig,
      timeoutMs: 15_000,
    },
  );
}
