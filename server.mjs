import { createServer } from "node:http";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { access, chmod, copyFile, readFile, rename, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import https from "node:https";

function pickRequestModule(url) {
  if (typeof url === "string") return url.startsWith("http:") ? http : https;
  return url.protocol === "http:" ? http : https;
}

import nextEnv from "@next/env";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";

import { migrateLegacyAuthSecret } from "./src/lib/auth-key-migration.mjs";

const dev = process.env.NODE_ENV !== "production";

if (!dev && !process.env.AUTH_SECRET?.trim()) {
  console.error(
    "AUTH_SECRET is required in production. Generate one with " +
      "`openssl rand -base64 32` and set it as an environment variable; " +
      "do not rely on the on-disk fallback. An auth-secret.txt left in the " +
      "data directory by an earlier version is migrated automatically on " +
      "the first start with AUTH_SECRET set.",
  );
  process.exit(1);
}

nextEnv.loadEnvConfig(process.cwd(), dev);

try {
  await migrateLegacyAuthSecret({
    authSecret: process.env.AUTH_SECRET,
    dataDir: getDataDirectory(),
  });
} catch (error) {
  console.error(
    `[auth-key-migration] Migrating auth-secret.txt to AUTH_SECRET failed: ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}

const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

function getDataDirectory() {
  const explicit = process.env.TAINER_DATA_DIR?.trim();
  if (explicit) return explicit;
  if (process.env.NODE_ENV === "production") {
    return path.join(process.env.HOME || process.cwd(), ".tainer");
  }
  return path.join(process.cwd(), "data");
}

async function resolveDataFile(fileName) {
  const dir = getDataDirectory();
  await mkdir(dir, { recursive: true });
  return path.join(dir, fileName);
}

const JSON_FILE_CACHE_TTL_MS = 1_000;
const jsonFileCache = new Map();
const jsonFileInflight = new Map();
const proxmoxSiteConfigCache = new Map();
const proxmoxSiteConfigInflight = new Map();

function cloneJsonValue(value) {
  return structuredClone(value);
}

async function readJsonDataFileCached(fileName, fallback) {
  const filePath = await resolveDataFile(fileName);
  const cached = jsonFileCache.get(filePath);
  if (cached && cached.expiresAt > Date.now()) {
    return cloneJsonValue(cached.value);
  }

  const inflight = jsonFileInflight.get(filePath);
  if (inflight) {
    return inflight.then((value) => cloneJsonValue(value));
  }

  const request = readFile(filePath, "utf8")
    .then((raw) => JSON.parse(raw))
    .catch(() => fallback());

  jsonFileInflight.set(filePath, request);

  try {
    const value = await request;
    jsonFileCache.set(filePath, {
      expiresAt: Date.now() + JSON_FILE_CACHE_TTL_MS,
      value,
    });
    return cloneJsonValue(value);
  } finally {
    jsonFileInflight.delete(filePath);
  }
}

async function getAuthSecret() {
  if (process.env.AUTH_SECRET?.trim()) {
    return createHash("sha256").update(process.env.AUTH_SECRET.trim()).digest();
  }
  try {
    const filePath = await resolveDataFile("auth-secret.txt");
    const raw = await readFile(filePath, "utf8");
    await chmod(filePath, 0o600).catch(() => {});
    return Buffer.from(raw.trim(), "base64");
  } catch {
    const secret = randomBytes(32);
    const filePath = await resolveDataFile("auth-secret.txt");
    await writeFile(filePath, `${secret.toString("base64")}\n`, "utf8");
    await chmod(filePath, 0o600);
    return secret;
  }
}

function readCookieValue(value, secret, namespace) {
  const dotIndex = value.lastIndexOf(".");
  if (dotIndex < 1) return null;
  const encodedPayload = value.slice(0, dotIndex);
  const signature = value.slice(dotIndex + 1);
  if (!encodedPayload || !signature) return null;

  const expected = createHmac("sha256", secret)
    .update(`${namespace}:${encodedPayload}`)
    .digest("base64url");

  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }

  try {
    return Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const result = {};
  if (!header) return result;
  for (const pair of header.split(";")) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex < 1) continue;
    const name = pair.slice(0, eqIndex).trim();
    const val = pair.slice(eqIndex + 1).trim();
    result[name] = val;
  }
  return result;
}

async function validateSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const cookie = cookies.tainer_session;
  if (!cookie) return null;

  const secret = await getAuthSecret();
  const sessionId = readCookieValue(cookie, secret, "tainer_session");
  if (!sessionId) return null;

  try {
    const store = await readJsonDataFileCached("auth-store.json", () => ({
      sessions: [],
      users: [],
    }));
    const session = (store.sessions || []).find(
      (s) => s.id === sessionId && !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now(),
    );
    if (!session) return null;
    const user = (store.users || []).find((u) => u.id === session.userId);
    if (!user) return null;
    return { sessionId: session.id, userId: user.id, userName: user.name };
  } catch {
    return null;
  }
}

const MOBILE_JWT_NAMESPACE = "tainer_mobile";

async function validateMobileJwt(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, providedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !providedSignature) return null;

  const secret = await getAuthSecret();
  const headerAndPayload = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = createHmac("sha256", secret)
    .update(`${MOBILE_JWT_NAMESPACE}:${headerAndPayload}`)
    .digest("base64url");

  const sigA = Buffer.from(providedSignature, "base64url");
  const sigB = Buffer.from(expectedSignature, "base64url");
  if (sigA.length !== sigB.length || !timingSafeEqual(sigA, sigB)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!payload.exp || !payload.iat || !payload.sessionId || !payload.sub) return null;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) return null;

    const store = await readJsonDataFileCached("auth-store.json", () => ({
      sessions: [],
      users: [],
    }));
    const session = (store.sessions || []).find(
      (s) => s.id === payload.sessionId && !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now(),
    );
    if (!session) return null;
    const user = (store.users || []).find((u) => u.id === payload.sub);
    if (!user) return null;

    return { sessionId: payload.sessionId, userId: payload.sub, userName: user.name };
  } catch {
    return null;
  }
}

function getSiteConfigVersion(site) {
  return [
    site.updatedAt,
    site.payload?.passwordEncrypted || "",
  ].join("::");
}

async function validateGuestShellStepUp(req, session) {
  const cookies = parseCookies(req.headers.cookie);
  const cookie = cookies[SSH_STEP_UP_COOKIE_NAME];
  if (!cookie) return false;

  const secret = await getAuthSecret();
  const decoded = readCookieValue(cookie, secret, SSH_STEP_UP_COOKIE_NAME);
  if (!decoded) return false;

  try {
    const stepUp = JSON.parse(decoded);
    return (
      typeof stepUp === "object" &&
      stepUp !== null &&
      typeof stepUp.expiresAt === "string" &&
      typeof stepUp.sessionId === "string" &&
      typeof stepUp.userId === "string" &&
      new Date(stepUp.expiresAt).getTime() > Date.now() &&
      stepUp.sessionId === session.sessionId &&
      stepUp.userId === session.userId
    );
  } catch {
    return false;
  }
}

function getProxmoxConfig() {
  const url = process.env.PROXMOX_URL;
  const username = process.env.PROXMOX_USERNAME;
  const password = process.env.PROXMOX_PASSWORD;
  if (!url || !username || !password) return null;
  return {
    url,
    username,
    password,
    tlsInsecure: process.env.PROXMOX_TLS_INSECURE === "true",
  };
}

async function decryptTextMjs(value, secret) {
  const { createDecipheriv } = await import("node:crypto");
  const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error("Invalid encrypted payload.");
  const decipher = createDecipheriv("aes-256-gcm", secret, Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function getProxmoxConfigForSite(siteId) {
  try {
    const store = await readJsonDataFileCached("sites.json", () => ({ sites: [] }));
    const site = store.sites?.find((s) => s.id === siteId);
    if (!site || !site.enabled) return null;

    const version = getSiteConfigVersion(site);
    const cached = proxmoxSiteConfigCache.get(site.id);
    if (cached && cached.version === version && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const inflightKey = `${site.id}::${version}`;
    const inflight = proxmoxSiteConfigInflight.get(inflightKey);
    if (inflight) {
      return inflight;
    }

    const request = (async () => {
      const secret = await getAuthSecret();
      const password = await decryptTextMjs(site.payload.passwordEncrypted, secret);

      return {
        url: site.payload.apiUrl,
        username: site.payload.username,
        password,
        tlsInsecure: site.payload.tlsMode === "insecure",
        siteId: site.id,
      };
    })();

    proxmoxSiteConfigInflight.set(inflightKey, request);

    try {
      const config = await request;
      proxmoxSiteConfigCache.set(site.id, {
        expiresAt: Date.now() + 30_000,
        value: config,
        version,
      });
      return config;
    } finally {
      proxmoxSiteConfigInflight.delete(inflightKey);
    }
  } catch {
    return null;
  }
}

const NODE_NAME_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,61}[a-zA-Z0-9])?$/;

function normalizeNodeName(value, label = "node") {
  const normalized = String(value ?? "").trim();

  if (!NODE_NAME_REGEX.test(normalized)) {
    throw new Error(`Invalid ${label} name.`);
  }

  return normalized;
}

function normalizePositiveInteger(value, label) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}.`);
  }
  return parsed;
}

async function proxmoxTicketRequest(config, endpoint, { method = "GET", params } = {}) {
  const pveAuth = await proxmoxPasswordLogin(config);

  return new Promise((resolve, reject) => {
    const url = new URL(`/api2/json${endpoint}`, config.url);
    const query = params?.toString() ?? "";
    const body = method === "GET" ? undefined : query || undefined;

    if (method === "GET" && query) {
      url.search = query;
    }

    const req = pickRequestModule(url).request(
      url,
      {
        method,
        headers: {
          Cookie: `PVEAuthCookie=${pveAuth.ticket}`,
          ...(method !== "GET" ? { CSRFPreventionToken: pveAuth.csrfToken } : {}),
          ...(body
            ? {
                "Content-Length": Buffer.byteLength(body),
                "Content-Type": "application/x-www-form-urlencoded",
              }
            : {}),
        },
        rejectUnauthorized: !config.tlsInsecure,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.message) {
              reject(new Error(parsed.message));
              return;
            }
            resolve(parsed.data);
          } catch {
            reject(new Error(`Proxmox invalid response (${res.statusCode}).`));
          }
        });
      },
    );

    req.on("error", (err) => reject(new Error(`Proxmox connection failed: ${err.message}`)));
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

const pveAuthCacheMap = new Map();

async function proxmoxPasswordLogin(config) {
  const username = config.username || process.env.PROXMOX_USERNAME?.trim();
  const password = config.password || process.env.PROXMOX_PASSWORD?.trim();
  const cacheKey = [config.siteId || "__env__", config.url, username, config.tlsInsecure ? "1" : "0"].join("::");
  const cached = pveAuthCacheMap.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 5 * 60_000) {
    return cached;
  }

  if (!username || !password) {
    throw new Error(
      "Proxmox credentials are not configured for this site.",
    );
  }

  return new Promise((resolve, reject) => {
    const url = new URL("/api2/json/access/ticket", config.url);
    const body = new URLSearchParams({
      username,
      password,
    }).toString();

    const req = pickRequestModule(url).request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Length": Buffer.byteLength(body),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        rejectUnauthorized: !config.tlsInsecure,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(raw);
            if (!parsed.data?.ticket) {
              reject(
                new Error(
                  "Proxmox login failed. Check username and password for this site.",
                ),
              );
              return;
            }
            const result = {
              ticket: parsed.data.ticket,
              csrfToken: parsed.data.CSRFPreventionToken || "",
              expiresAt: Date.now() + 2 * 60 * 60_000, // Matches the Proxmox ticket lifetime.
            };
            const sitePrefix = `${config.siteId || "__env__"}::`;
            for (const key of pveAuthCacheMap.keys()) {
              if (key.startsWith(sitePrefix)) pveAuthCacheMap.delete(key);
            }
            pveAuthCacheMap.set(cacheKey, result);
            resolve(result);
          } catch {
            reject(new Error(`Proxmox login failed (HTTP ${res.statusCode}).`));
          }
        });
      },
    );

    req.on("error", (err) =>
      reject(new Error(`Proxmox login failed: ${err.message}`)),
    );
    req.write(body);
    req.end();
  });
}

function proxmoxCookieRequest(config, pveTicket, csrfToken, endpoint, { method = "GET", params } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api2/json${endpoint}`, config.url);
    const query = params?.toString() ?? "";
    const body = method === "GET" ? undefined : query || undefined;

    if (method === "GET" && query) {
      url.search = query;
    }

    const req = pickRequestModule(url).request(
      url,
      {
        method,
        headers: {
          Cookie: `PVEAuthCookie=${pveTicket}`,
          ...(csrfToken && method !== "GET" ? { CSRFPreventionToken: csrfToken } : {}),
          ...(body
            ? {
                "Content-Length": Buffer.byteLength(body),
                "Content-Type": "application/x-www-form-urlencoded",
              }
            : {}),
        },
        rejectUnauthorized: !config.tlsInsecure,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.message) {
              reject(new Error(parsed.message));
              return;
            }
            resolve(parsed.data);
          } catch {
            reject(new Error(`Proxmox invalid response (${res.statusCode}).`));
          }
        });
      },
    );

    req.on("error", (err) => reject(new Error(`Proxmox connection failed: ${err.message}`)));
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function authorizeConsoleTarget(config, node, vmid, type) {
  const normalizedNode = normalizeNodeName(node);
  const normalizedVmid = normalizePositiveInteger(vmid, "vmid");

  const guestType = type === "qemu" ? "qemu" : "lxc";
  const status = await proxmoxTicketRequest(
    config,
    `/nodes/${normalizedNode}/${guestType}/${normalizedVmid}/status/current`,
  );

  if (!status || status.status !== "running") {
    throw new Error(
      guestType === "qemu"
        ? "VM must be running to open a console."
        : "Container must be running to open a terminal.",
    );
  }

  return {
    node: normalizedNode,
    vmid: normalizedVmid,
  };
}

function getHeaderValue(header) {
  return Array.isArray(header) ? header[0]?.trim() : header?.trim();
}

const SSH_STEP_UP_COOKIE_NAME = "tainer_guest_shell_stepup";

function parseTainerMeta(description) {
  const marker = "---tainer-meta---";
  const idx = String(description ?? "").indexOf(marker);
  if (idx === -1) return null;

  const raw = String(description ?? "").slice(idx + marker.length).trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.templateId !== "string" ||
      typeof parsed.templateName !== "string" ||
      typeof parsed.deployedAt !== "string" ||
      typeof parsed.templateVersion !== "string"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function decodeDeploymentId(id) {
  try {
    const decoded = JSON.parse(Buffer.from(id, "base64url").toString("utf8"));
    const node = String(decoded?.node ?? "");
    const vmid = Number(decoded?.vmid);
    const type = decoded?.type === "qemu" ? "qemu" : "lxc";
    const siteId = typeof decoded?.siteId === "string" ? decoded.siteId : null;

    if (!NODE_NAME_REGEX.test(node)) {
      throw new Error("Invalid node name in deployment ID.");
    }

    if (!Number.isInteger(vmid) || vmid <= 0) {
      throw new Error("Invalid VMID in deployment ID.");
    }

    return { node, type, vmid, siteId };
  } catch (error) {
    if (error instanceof Error && error.message.includes("deployment ID")) {
      throw error;
    }

    throw new Error("Invalid deployment ID format.");
  }
}

async function resolveConsoleConfig(userId, siteId) {
  const authStore = await readJsonDataFileCached("auth-store.json", () => ({
    sessions: [],
    users: [],
  }));
  const user = (authStore.users || []).find((u) => u.id === userId);
  if (!user) {
    return { error: "Unauthorized.", status: 401 };
  }

  const groupIds = Array.isArray(user.groupIds) ? user.groupIds : [];
  const groupStore = await readJsonDataFileCached("user-groups.json", () => ({ groups: [] }));
  const groups = (Array.isArray(groupStore.groups) ? groupStore.groups : []).filter(
    (group) => groupIds.includes(group?.id),
  );
  const isAdmin = user.role === "admin" || groups.some((group) => group.isAdmin === true);
  const hasAccess = isAdmin || (
    Boolean(siteId) &&
    groups.some((group) =>
      Array.isArray(group.siteAccess) && group.siteAccess.some((entry) => entry?.siteId === siteId),
    )
  );

  if (!hasAccess) {
    return { error: "You do not have access to this site.", status: 403 };
  }

  const config = siteId ? await getProxmoxConfigForSite(siteId) : getProxmoxConfig();
  if (!config) {
    return { error: siteId ? "Site not found." : "Proxmox is not configured.", status: siteId ? 404 : 500 };
  }

  return { config };
}

async function authorizeConsoleDeployment(config, deploymentId) {
  const decoded = decodeDeploymentId(deploymentId);
  const guestConfig = await proxmoxTicketRequest(
    config,
    `/nodes/${decoded.node}/${decoded.type}/${decoded.vmid}/config`,
  );
  const target = await authorizeConsoleTarget(config, decoded.node, decoded.vmid, decoded.type);
  return {
    deploymentId,
    target,
    type: decoded.type,
  };
}

function buildAllowedOrigins(req) {
  const origins = new Set();

  const configuredAppUrl = process.env.APP_URL?.trim();
  if (configuredAppUrl) {
    try {
      const parsed = new URL(configuredAppUrl);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        origins.add(parsed.origin);
      }
    } catch {}
  }

  const forwardedHost = getHeaderValue(req.headers["x-forwarded-host"]);
  const forwardedProto = getHeaderValue(req.headers["x-forwarded-proto"]);
  if (
    forwardedHost &&
    (forwardedProto === "http" || forwardedProto === "https")
  ) {
    origins.add(`${forwardedProto}://${forwardedHost}`);
  }

  const host = getHeaderValue(req.headers.host);
  if (host) {
    origins.add(`http://${host}`);
    origins.add(`https://${host}`);
  }

  if (process.env.NODE_ENV !== "production") {
    origins.add(`http://localhost:${port}`);
    origins.add(`http://127.0.0.1:${port}`);
    origins.add(`http://[::1]:${port}`);
  }

  return origins;
}

function isTrustedRequestOrigin(req) {
  const origin = getHeaderValue(req.headers.origin);

  if (!origin) {
    return true;
  }

  return buildAllowedOrigins(req).has(origin);
}

const CONSOLE_SESSION_TTL_MS = 60_000;
const consoleSessions = new Map();

function pruneConsoleSessions() {
  const now = Date.now();

  for (const [token, session] of consoleSessions) {
    if (session.expiresAt <= now) {
      consoleSessions.delete(token);
    }
  }
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function createConsoleSession(config, session, deploymentId) {
  const deployment = await authorizeConsoleDeployment(config, deploymentId);
  const { target, type } = deployment;

  // Proxmox API tokens cannot use termproxy/vncproxy, so this needs a password login.
  const pveAuth = await proxmoxPasswordLogin(config);

  const useTerm = type === "lxc";
  const consoleKind = useTerm ? "term" : "vnc";
  const endpoint = useTerm
    ? `/nodes/${target.node}/${type}/${target.vmid}/termproxy`
    : `/nodes/${target.node}/${type}/${target.vmid}/vncproxy`;
  const params = useTerm
    ? new URLSearchParams()
    : new URLSearchParams({ websocket: "1", "generate-password": "1" });
  const data = await proxmoxCookieRequest(config, pveAuth.ticket, pveAuth.csrfToken, endpoint, {
    method: "POST",
    params,
  });

  const ticket = String(data?.ticket ?? "").trim();
  const user = String(data?.user ?? "").trim();
  const vncPassword = String(data?.password ?? "").trim();
  const port = normalizePositiveInteger(data?.port, "console port");

  if (!ticket) {
    throw new Error("Proxmox did not return a console ticket.");
  }

  const token = randomBytes(24).toString("base64url");
  consoleSessions.set(token, {
    deploymentId: deployment.deploymentId,
    expiresAt: Date.now() + CONSOLE_SESSION_TTL_MS,
    kind: consoleKind,
    node: target.node,
    port,
    pveTicket: pveAuth.ticket,
    sessionId: session.sessionId,
    siteId: config.siteId || null,
    ticket,
    type,
    user,
    userId: session.userId,
    vmid: target.vmid,
  });

  console.log(
    `[console-ticket] ${session.userName} prepared ${consoleKind} access for ${target.node}/${type}/${target.vmid}`,
  );

  if (useTerm) {
    return {
      kind: consoleKind,
      ticket,
      user: user || (config.username || process.env.PROXMOX_USERNAME?.trim() || "root@pam").split("@")[0] || "",
      websocketUrl: `/api/proxmox/console-ws?session=${encodeURIComponent(token)}`,
    };
  }

  return {
    kind: consoleKind,
    password: vncPassword || ticket,
    websocketUrl: `/api/proxmox/console-ws?session=${encodeURIComponent(token)}`,
  };
}

async function handleConsoleTicketRequest(req, res, requestUrl) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  if (!isTrustedRequestOrigin(req)) {
    sendJson(res, 403, { error: "Untrusted request origin." });
    return;
  }

  const session = await validateSession(req);
  if (!session) {
    sendJson(res, 401, { error: "Unauthorized." });
    return;
  }

  if (!(await validateGuestShellStepUp(req, session))) {
    sendJson(res, 403, { error: "A fresh 2FA check is required before opening a console." });
    return;
  }

  const deploymentId = String(requestUrl.searchParams.get("deploymentId") ?? "").trim();

  if (!deploymentId) {
    sendJson(res, 400, { error: "Missing console target." });
    return;
  }

  let decoded;
  try {
    decoded = decodeDeploymentId(deploymentId);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid console target." });
    return;
  }

  const resolved = await resolveConsoleConfig(session.userId, decoded.siteId);
  if (!resolved.config) {
    sendJson(res, resolved.status, { error: resolved.error });
    return;
  }
  const { config } = resolved;

  pruneConsoleSessions();

  try {
    const ticket = await createConsoleSession(config, session, deploymentId);
    sendJson(res, 200, { success: true, ...ticket });
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Failed to create the console session.",
    });
  }
}

async function handleMobileConsoleTicketRequest(req, res, requestUrl) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  const session = await validateMobileJwt(req);
  if (!session) {
    sendJson(res, 401, { error: "Unauthorized." });
    return;
  }

  const deploymentId = String(requestUrl.searchParams.get("deploymentId") ?? "").trim();
  if (!deploymentId) {
    sendJson(res, 400, { error: "Missing console target." });
    return;
  }

  let decoded;
  try {
    decoded = decodeDeploymentId(deploymentId);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid console target." });
    return;
  }

  const resolved = await resolveConsoleConfig(session.userId, decoded.siteId);
  if (!resolved.config) {
    sendJson(res, resolved.status, { error: resolved.error });
    return;
  }
  const { config } = resolved;

  pruneConsoleSessions();

  try {
    const ticket = await createConsoleSession(config, session, deploymentId);
    ticket.websocketUrl = ticket.websocketUrl.replace(
      "/api/proxmox/console-ws",
      "/api/mobile/console-ws",
    );
    sendJson(res, 200, { success: true, ...ticket });
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Failed to create the console session.",
    });
  }
}

async function migrateLegacySiteOnBoot() {
  try {
    const sitesPath = await resolveDataFile("sites.json");
    let needsMigration = true;

    try {
      const raw = await readFile(sitesPath, "utf8");
      const store = JSON.parse(raw);
      if (store.legacyImportedEnvSiteId || (store.sites && store.sites.length > 0)) {
        needsMigration = false;
      }
    } catch {}

    if (!needsMigration) return;

    const apiUrl = process.env.PROXMOX_URL?.trim();
    const username = process.env.PROXMOX_USERNAME?.trim();
    const password = process.env.PROXMOX_PASSWORD?.trim();
    if (!apiUrl || !username || !password) return;

    console.log("[server.mjs] Migrating PROXMOX_* env vars into site registry...");

    const secret = await getAuthSecret();

    function encryptTextSync(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", secret, iv);
      const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
    }

    const siteId = randomBytes(16).toString("hex") + "-" + randomBytes(4).toString("hex");

    let slug;
    try {
      slug = new URL(apiUrl).hostname.replace(/\./g, "-").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "primary";
    } catch {
      slug = "primary";
    }

    const store = {
      schemaVersion: 1,
      defaultSiteId: siteId,
      legacyImportedEnvSiteId: siteId,
      sites: [{
        id: siteId,
        slug,
        name: "Primary",
        kind: "proxmox",
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastValidatedAt: null,
        lastValidationOk: null,
        payload: {
          apiUrl: apiUrl.replace(/\/+$/, ""),
          username,
          passwordEncrypted: encryptTextSync(password),
          tlsMode: process.env.PROXMOX_TLS_INSECURE === "true" ? "insecure" : "full",
          tlsFingerprint: null,
          tlsCustomCaPem: null,
          defaultNode: process.env.PROXMOX_DEFAULT_NODE?.trim() || "",
          defaultRootfsStorage: process.env.PROXMOX_DEFAULT_ROOTFS_STORAGE?.trim() || "",
          defaultVmStorage: process.env.PROXMOX_DEFAULT_VM_STORAGE?.trim() || "",
          defaultIsoStorage: process.env.PROXMOX_DEFAULT_ISO_STORAGE?.trim() || "",
          defaultBackupStorage: "",
          defaultBackupSlaHours: 24,
          sshHostKeyPolicy: process.env.PROXMOX_SSH_HOST_KEY_POLICY?.trim().toLowerCase() || "accept-new",
          consoleKnownHostsContent: null,
        },
      }],
    };

    const existingSites = await stat(sitesPath).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (existingSites?.isFile()) await chmod(sitesPath, 0o600);
    await writeFile(sitesPath, JSON.stringify(store, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    await chmod(sitesPath, 0o600);
    console.log(`[server.mjs] Created site "${slug}" from env vars.`);

    const dataDir = getDataDirectory();
    const siteDataDir = path.join(dataDir, "sites", siteId);
    await mkdir(siteDataDir, { recursive: true });

    const siteFiles = [
      "deployment-templates.json", "vm-templates.json", "image-env-cache.json",
      "ip-pools.json", "deployment-activity-log.json", "deployment-ssh-keys.json",
      "backup-policies.json", "backup-run-log.json", "alert-policies.json",
      "alert-runtime-state.json", "notification-log.json", "tainer-settings.json",
      "guest-host-keys.json",
    ];

    for (const f of siteFiles) {
      const src = path.join(dataDir, f);
      const dst = path.join(siteDataDir, f);
      try {
        await access(src);
        try { await access(dst); continue; } catch {}
        try { await rename(src, dst); } catch { await copyFile(src, dst); }
        console.log(`[server.mjs] Moved ${f} → sites/${siteId}/`);
      } catch {}
    }

    console.log("[server.mjs] Migration complete.");
  } catch (err) {
    console.error("[server.mjs] Legacy site migration failed:", err);
  }
}

await app.prepare();
await migrateLegacySiteOnBoot();

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  req.headers["x-pathname"] = requestUrl.pathname;
  if (req.socket.remoteAddress) {
    req.headers["x-tainer-peer-ip"] = req.socket.remoteAddress;
  } else {
    delete req.headers["x-tainer-peer-ip"];
  }

  if (requestUrl.pathname === "/api/proxmox/console-ticket") {
    await handleConsoleTicketRequest(req, res, requestUrl);
    return;
  }

  if (requestUrl.pathname === "/api/mobile/console-ticket") {
    await handleMobileConsoleTicketRequest(req, res, requestUrl);
    return;
  }

  const parsedUrl = {
    pathname: requestUrl.pathname,
    query: Object.fromEntries(requestUrl.searchParams),
  };
  await handle(req, res, parsedUrl);
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (req, socket, head) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host}`);
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const isMobileConsoleWs = url.pathname === "/api/mobile/console-ws";
  const isWebConsoleWs = url.pathname === "/api/proxmox/console-ws";

  if (!isMobileConsoleWs && !isWebConsoleWs && url.pathname !== "/api/proxmox/ssh-terminal-ws") {
    if (dev && url.pathname.startsWith("/_next/")) return;
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  if (url.pathname === "/api/proxmox/ssh-terminal-ws") {
    socket.write("HTTP/1.1 410 Gone\r\n\r\n");
    socket.destroy();
    return;
  }

  try {
    let session;

    if (isMobileConsoleWs) {
      session = await validateMobileJwt(req);
    } else {
      if (!isTrustedRequestOrigin(req)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      session = await validateSession(req);
    }

    if (!session) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    pruneConsoleSessions();
    const token = String(url.searchParams.get("session") ?? "").trim();
    const consoleSession = consoleSessions.get(token);

    if (
      !token ||
      !consoleSession ||
      consoleSession.userId !== session.userId ||
      consoleSession.sessionId !== session.sessionId
    ) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const resolved = await resolveConsoleConfig(session.userId, consoleSession.siteId);
    if (!resolved.config) {
      consoleSessions.delete(token);
      const reason = { 401: "Unauthorized", 403: "Forbidden", 404: "Not Found" }[resolved.status] ?? "Internal Server Error";
      socket.write(`HTTP/1.1 ${resolved.status} ${reason}\r\n\r\n`);
      socket.destroy();
      return;
    }
    const { config } = resolved;

    consoleSessions.delete(token);

    const upstreamUrl = new URL(
      `/api2/json/nodes/${consoleSession.node}/${consoleSession.type}/${consoleSession.vmid}/vncwebsocket`,
      config.url,
    );
    upstreamUrl.searchParams.set("port", String(consoleSession.port));
    upstreamUrl.searchParams.set("vncticket", consoleSession.ticket);

    console.log(
      `[console] ${session.userName} opening ${consoleSession.kind} console for ${consoleSession.node}/${consoleSession.type}/${consoleSession.vmid} (deployment=${consoleSession.deploymentId})`,
    );

    wss.handleUpgrade(req, socket, head, (ws) => {
      let cleanedUp = false;
      let upstreamReady = false;
      const pendingClientMessages = [];

      const upstream = new WebSocket(
        upstreamUrl,
        {
          headers: {
            Cookie: `PVEAuthCookie=${consoleSession.pveTicket}`,
          },
          rejectUnauthorized: !config.tlsInsecure,
        },
      );

      const cleanup = () => {
        if (cleanedUp) {
          return;
        }

        cleanedUp = true;
        pendingClientMessages.length = 0;

        if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
          upstream.close();
        }

        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      let clientMsgCount = 0;
      let upstreamMsgCount = 0;
      const debugTag = `${consoleSession.node}/${consoleSession.type}/${consoleSession.vmid}`;

      upstream.on("open", () => {
        upstreamReady = true;
        console.log(`[console-debug] upstream OPEN for ${debugTag} (pending=${pendingClientMessages.length})`);

        for (const msg of pendingClientMessages) {
          upstream.send(msg.data, { binary: msg.isBinary });
        }
        pendingClientMessages.length = 0;
      });

      upstream.on("message", (data, isBinary) => {
        upstreamMsgCount++;
        if (upstreamMsgCount <= 5 || upstreamMsgCount % 100 === 0) {
          console.log(`[console-debug] upstream→client #${upstreamMsgCount} (${data.length}B, binary=${isBinary}) for ${debugTag}`);
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data, { binary: isBinary });
        }
      });

      upstream.on("close", (code, reason) => {
        console.log(
          `[console] upstream closed for ${consoleSession.node}/${consoleSession.type}/${consoleSession.vmid} (code=${code}, reason=${reason.toString("utf8") || "none"})`,
        );
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(code === 1000 ? 1000 : 1011);
        }
        cleanup();
      });

      upstream.on("error", (error) => {
        console.error("[console] Upstream websocket error:", error.message);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "error",
            message: `Proxmox console connection failed: ${error.message}`,
          }));
          ws.close(1011);
        }
        cleanup();
      });

      ws.on("message", (data, isBinary) => {
        clientMsgCount++;
        if (clientMsgCount <= 10 || clientMsgCount % 50 === 0) {
          console.log(`[console-debug] client→upstream #${clientMsgCount} (${data.length}B, binary=${isBinary}) for ${debugTag}`);
        }
        if (upstreamReady && upstream.readyState === WebSocket.OPEN) {
          upstream.send(data, { binary: isBinary });
        } else if (!upstreamReady && !cleanedUp) {
          pendingClientMessages.push({ data, isBinary });
        }
      });

      ws.on("close", (code) => {
        console.log(
          `[console] client closed for ${consoleSession.node}/${consoleSession.type}/${consoleSession.vmid} (code=${code})`,
        );
        cleanup();
      });

      ws.on("error", (error) => {
        console.error("[console] Client websocket error:", error.message);
        cleanup();
      });
    });
  } catch (err) {
    console.error("[console] Unexpected error:", err);
    if (!socket.destroyed) {
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
    }
  }
});

server.listen(port, hostname, () => {
  console.log(`> Ready on http://${hostname}:${port} (${dev ? "development" : "production"})`);

  if (!dev) {
    const warmRoutes = ["/login", "/setup", "/api/health"];
    setTimeout(() => {
      for (const route of warmRoutes) {
        http.get(`http://127.0.0.1:${port}${route}`, (res) => {
          res.resume();
        }).on("error", () => {});
      }
      console.log("[warmup] Pre-warmed critical routes");
    }, 1000);
  }
});
