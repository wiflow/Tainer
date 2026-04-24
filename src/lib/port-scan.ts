import "server-only";

import { access } from "node:fs/promises";
import path from "node:path";

import { getExtraCaCerts } from "@/lib/aia-fetch";
import { getActiveSiteConfig, getPveTicket, hasSiteConfig } from "@/lib/proxmox";
import { runSshCommand } from "@/lib/ssh-command";
import { buildProxmoxUrl } from "@/lib/utils";

function isValidVmid(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 999999999;
}

function isValidNodeName(value: string): boolean {
  return /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,61}[a-zA-Z0-9])?$/.test(value);
}

function isValidIpAddress(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value) &&
    value.split('.').every(octet => {
      const n = Number(octet);
      return n >= 0 && n <= 255;
    });
}

function getProxmoxConsoleUser() {
  if (!hasSiteConfig()) return "root";
  const config = getActiveSiteConfig();
  const osUser = (config.username?.trim() || "root@pam").split("@")[0] || "root";
  return /^[A-Za-z0-9._-]+$/.test(osUser) ? osUser : "root";
}

function normalizeScanTargetIp(value: string): string | null {
  const normalized = value.trim();

  if (!normalized || normalized === "Unavailable" || normalized === "DHCP" || normalized === "No IP") {
    return null;
  }

  return normalized.split("/")[0]?.trim() ?? "";
}

export type PortResult = {
  open: boolean;
  port: number;
  service: string;
  url: string | null;
};

const KNOWN_SERVICES: Record<number, { service: string; web?: boolean }> = {
  21: { service: "FTP" },
  22: { service: "SSH" },
  25: { service: "SMTP" },
  53: { service: "DNS" },
  80: { service: "HTTP", web: true },
  443: { service: "HTTPS", web: true },
  1433: { service: "MSSQL" },
  3000: { service: "Dev server", web: true },
  3030: { service: "Grafana", web: true },
  3306: { service: "MySQL" },
  5432: { service: "PostgreSQL" },
  5900: { service: "VNC" },
  6379: { service: "Redis" },
  8000: { service: "HTTP alt", web: true },
  8080: { service: "HTTP proxy", web: true },
  8088: { service: "Ignition Gateway", web: true },
  8443: { service: "HTTPS alt", web: true },
  8888: { service: "HTTP alt", web: true },
  9090: { service: "Prometheus", web: true },
  9100: { service: "Node exporter", web: true },
  27017: { service: "MongoDB" },
};

function isWebPort(port: number) {
  // Known non-web ports get no URL; everything else gets one
  const NON_WEB = new Set([21, 22, 25, 53, 1433, 3306, 5432, 5900, 6379, 27017]);
  return !NON_WEB.has(port);
}

function getServiceName(port: number, processName?: string) {
  if (processName) return processName;
  return KNOWN_SERVICES[port]?.service ?? `Port ${port}`;
}

async function resolveNodeIp(node: string): Promise<string | null> {
  const { default: https } = await import("node:https");

  if (!hasSiteConfig()) return null;
  const config = getActiveSiteConfig();

  let extraTlsOpts: { ca?: string[] } = {};
  if (!config.tlsInsecure) {
    const extras: string[] = [];
    if (config.tlsCustomCaPem) extras.push(config.tlsCustomCaPem);
    try {
      const parsed = new URL(config.apiUrl);
      const aiaCerts = await getExtraCaCerts(parsed.hostname, parsed.port || "8006");
      if (aiaCerts.length > 0) extras.push(...aiaCerts);
    } catch { /* proceed without */ }
    if (extras.length > 0) {
      const { rootCertificates } = await import("node:tls");
      extraTlsOpts = { ca: [...new Set([...rootCertificates, ...extras])] };
    }
  }

  const pveAuth = await getPveTicket(config);

  return new Promise((resolve) => {
    const endpoint = buildProxmoxUrl(`/api2/json/nodes/${node}/network`, config.apiUrl);
    const req = https.request(
      endpoint,
      {
        method: "GET",
        headers: { Cookie: `PVEAuthCookie=${pveAuth.ticket}` },
        rejectUnauthorized: !config.tlsInsecure,
        ...extraTlsOpts,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(raw).data as Array<{ address?: string; type?: string }>;
            const entry = data?.find((iface) => iface.address && (iface.type === "bridge" || iface.type === "eth"));
            resolve(entry?.address ?? null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.end();
  });
}

const nodeIpCache = new Map<string, string>();
let sshKnownHostsWarningLogged = false;

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function getPctExecHostKeyOptions() {
  if (!hasSiteConfig()) return null;
  const config = getActiveSiteConfig();
  const policy = config.sshHostKeyPolicy || "strict";

  if (policy === "accept-new" || policy === "auto") {
    return ["-o", "StrictHostKeyChecking=accept-new"];
  }

  if (policy === "off") {
    return ["-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null"];
  }

  const knownHostsFile = process.env.HOME ? path.join(process.env.HOME, ".ssh", "known_hosts") : "";

  if (!knownHostsFile || !(await pathExists(knownHostsFile))) {
    if (!sshKnownHostsWarningLogged) {
      sshKnownHostsWarningLogged = true;
      console.warn(
        "[port-scan] Skipping pct exec scan because no known_hosts file is available. " +
        "Configure SSH host key policy to 'accept-new' for this site.",
      );
    }
    return null;
  }

  return [
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${knownHostsFile}`,
  ];
}

export async function scanPorts(
  ip: string,
  node?: string,
  vmid?: number,
): Promise<PortResult[]> {
  const normalizedIp = normalizeScanTargetIp(ip);

  if (!normalizedIp) {
    return [];
  }

  if (!isValidIpAddress(normalizedIp)) {
    throw new Error("Port scan only supports IPv4 addresses.");
  }

  if (node && !isValidNodeName(node)) throw new Error("Invalid node name.");
  if (vmid !== undefined && !isValidVmid(vmid)) throw new Error("Invalid VMID.");

  if (node && vmid) {
    const results = await scanViaPctExec(normalizedIp, node, vmid);
    if (results !== null) return results;
  }

  if (vmid) {
    const results = await scanViaTunnel(normalizedIp, vmid);
    if (results !== null) return results;
  }

  return scanViaTcp(normalizedIp);
}

async function scanViaPctExec(
  ip: string,
  node: string,
  vmid: number,
): Promise<PortResult[] | null> {
  if (!hasSiteConfig()) return null;
  const siteConfig = getActiveSiteConfig();
  const sshUser = getProxmoxConsoleUser();

  const cacheKey = `${siteConfig.siteId}::${node}`;
  let nodeIp = nodeIpCache.get(cacheKey);
  if (!nodeIp) {
    nodeIp = (await resolveNodeIp(node)) ?? undefined;
    if (nodeIp) nodeIpCache.set(cacheKey, nodeIp);
  }
  if (!nodeIp) return null;

  if (!isValidIpAddress(nodeIp)) throw new Error("Invalid node IP address.");

  const hostKeyOptions = await getPctExecHostKeyOptions();
  if (!hostKeyOptions) return null;

  try {
    const output = await runSshCommand({
      destination: `${sshUser}@${nodeIp}`,
      hostKeyOptions,
      password: siteConfig.password,
      remoteCommand: `pct exec ${Number(vmid)} -- sh -c 'netstat -tlnp 2>/dev/null || cat /proc/net/tcp /proc/net/tcp6 2>/dev/null'`,
      timeoutMs: 10_000,
    });

    return parseNetstatOutput(output, ip);
  } catch {
    return null; // Fall back to TCP scan
  }
}

function parseNetstatOutput(output: string, ip: string): PortResult[] {
  const results: PortResult[] = [];
  const seen = new Set<number>();

  for (const line of output.split("\n")) {
    const netstatMatch = line.match(
      /^tcp\S*\s+\d+\s+\d+\s+(\S+):(\d+)\s+\S+\s+LISTEN\s+(?:\d+\/(\S+))?/,
    );
    if (netstatMatch) {
      const port = parseInt(netstatMatch[2], 10);
      const process = netstatMatch[3]?.split("/").pop();
      if (!seen.has(port)) {
        seen.add(port);
        const scheme = port === 443 || port === 8443 ? "https" : "http";
        const web = isWebPort(port);
        results.push({
          open: true,
          port,
          service: getServiceName(port, process),
          url: web ? `${scheme}://${ip}:${port}` : null,
        });
      }
      continue;
    }

    // 0A = LISTEN state in /proc/net/tcp; port is hex
    const procMatch = line.match(/^\s*\d+:\s+[0-9A-F]+:([0-9A-F]{4})\s+[0-9A-F]+:0000\s+0A/i);
    if (procMatch) {
      const port = parseInt(procMatch[1], 16);
      if (port > 0 && !seen.has(port)) {
        seen.add(port);
        const scheme = port === 443 || port === 8443 ? "https" : "http";
        const web = isWebPort(port);
        results.push({
          open: true,
          port,
          service: getServiceName(port),
          url: web ? `${scheme}://${ip}:${port}` : null,
        });
      }
    }
  }

  return results.sort((a, b) => a.port - b.port);
}

async function scanViaTunnel(
  ip: string,
  vmid: number,
): Promise<PortResult[] | null> {
  const tunnelProxy = process.env.TAINER_TUNNEL_PROXY;
  if (!tunnelProxy) return null;

  try {
    const res = await fetch(`${tunnelProxy}/__tainer__/port-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vmid }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return null;

    const data = await res.json() as { output?: string };
    if (!data.output) return null;

    return parseNetstatOutput(data.output, ip);
  } catch {
    return null;
  }
}

async function scanViaTcp(ip: string): Promise<PortResult[]> {
  const { connect } = await import("node:net");
  const COMMON_PORTS = Object.entries(KNOWN_SERVICES).map(([p, info]) => ({
    port: parseInt(p, 10),
    ...info,
  }));

  const results = await Promise.all(
    COMMON_PORTS.map(async ({ port, service, web }) => {
      const open = await new Promise<boolean>((resolve) => {
        const socket = connect({ host: ip, port, timeout: 1500 });
        socket.on("connect", () => { socket.destroy(); resolve(true); });
        socket.on("timeout", () => { socket.destroy(); resolve(false); });
        socket.on("error", () => { socket.destroy(); resolve(false); });
      });
      const scheme = port === 443 || port === 8443 ? "https" : "http";
      return {
        open,
        port,
        service,
        url: open && web ? `${scheme}://${ip}:${port}` : null,
      };
    }),
  );

  return results.filter((r) => r.open);
}
