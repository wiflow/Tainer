import "server-only";

import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

import { cookies, headers } from "next/headers";
import QRCode from "qrcode";
import nodemailer from "nodemailer";

import { resolveDataFilePath } from "@/lib/app-data";
import { decryptText, encryptText, getAuthSecret } from "@/lib/crypto";
import { SSH_STEP_UP_COOKIE_NAME, SSH_STEP_UP_TTL_MINUTES } from "@/lib/guest-access";
import {
  createStoreMutator,
  readDataJsonFileCached,
  writeJsonFileAtomically,
} from "@/lib/store-utils";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: { cost?: number; blockSize?: number; parallelization?: number },
) => Promise<Buffer>;

const SESSION_COOKIE_NAME = "tainer_session";
const LOGIN_CHALLENGE_COOKIE_NAME = "tainer_login_challenge";
const SESSION_TTL_DAYS = 14;
const SESSION_LAST_SEEN_UPDATE_MS = 5 * 60_000;
const LOGIN_CHALLENGE_TTL_MINUTES = 10;
const PASSWORD_RESET_TTL_MINUTES = 30;
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;
const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_SEGMENT_LENGTH = 8;
const RECOVERY_CODE_SEGMENTS = 4;
const SCRYPT_PARAMS = { cost: 16384, blockSize: 8, parallelization: 1, maxmem: 64 * 1024 * 1024 };
const AUTH_SECURITY_STATE_FILE_NAME = "auth-security-state.json";

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export type AuthRole = "admin" | "operator";

import { ALL_PERMISSIONS, type Permission } from "@/lib/permissions";
import type { UserGroupInput } from "@/lib/user-groups";
export { ALL_PERMISSIONS, PERMISSION_LABELS, type Permission } from "@/lib/permissions";

type StoredUser = {
  createdAt: string;
  email: string;
  groupIds?: string[];
  id: string;
  name: string;
  /** Empty string for users provisioned through SSO who have no local password. */
  passwordHash: string;
  passwordUpdatedAt: string;
  pendingTwoFactorSecret: string | null;
  pendingTwoFactorExpiresAt: string | null;
  permissions?: Permission[];
  role: AuthRole;
  twoFactorRecoveryCodeHashes: string[];
  twoFactorSecret: string | null;
  twoFactorUpdatedAt: string | null;
  updatedAt: string;
  /** When set, the user was created via or last logged in via this OIDC provider. */
  ssoProviderId?: string | null;
  /** Stable identifier from the IdP (the `sub` claim). Used to match a user
   * across email changes — emails get re-used and re-assigned at IdPs, this
   * doesn't. Set on first SSO login alongside ssoProviderId. */
  ssoSubject?: string | null;
  /**
   * The user's distinguished name in the configured LDAP directory, set on
   * first successful LDAP authentication. Stable per-user identifier — the
   * `mail` attribute can change but the DN typically does not. Used both
   * to recognise the user on later sign-ins and to distinguish LDAP-backed
   * accounts from local-password accounts in the trust boundary.
   */
  ldapDN?: string | null;
};

type StoredSession = {
  createdAt: string;
  expiresAt: string;
  id: string;
  lastSeenAt: string;
  revokedAt: string | null;
  source?: "web" | "mobile";
  userId: string;
};

type StoredPasswordReset = {
  createdAt: string;
  expiresAt: string;
  id: string;
  tokenHash: string;
  usedAt: string | null;
  userId: string;
};

type PasswordResetDebugEntry = {
  createdAt: string;
  email: string;
  expiresAt: string;
  link: string;
};

type AuthStore = {
  passwordResets: StoredPasswordReset[];
  sessions: StoredSession[];
  users: StoredUser[];
};

type RateLimitEntry = {
  count: number;
  firstAttempt: number;
};

type RateLimitTracker = Record<string, RateLimitEntry>;

type UsedTotpTracker = Record<string, Record<string, number>>;

type AuthSecurityState = {
  loginAttempts: RateLimitTracker;
  resetAttempts: RateLimitTracker;
  totpAttempts: RateLimitTracker;
  usedChallengeNonces: Record<string, number>;
  usedTotpCodes: UsedTotpTracker;
};

export type SessionUser = {
  accessibleSiteIds: string[];
  email: string;
  groupIds: string[];
  hasTwoFactor: boolean;
  id: string;
  name: string;
  permissions: Permission[];
  role: AuthRole;
  sitePermissions: Record<string, Permission[]>;
};

export type ManagedUserSummary = {
  activeSessionCount: number;
  createdAt: string;
  email: string;
  groupIds: string[];
  hasTwoFactor: boolean;
  id: string;
  lastSeenAt: string | null;
  name: string;
  permissions: Permission[];
  role: AuthRole;
  updatedAt: string;
};

export type AuthSession = {
  expiresAt: string;
  id: string;
  user: SessionUser;
};

export type TwoFactorSetup = {
  manualEntryKey: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
};

type LoginChallenge = {
  expiresAt: string;
  nonce: string;
  userId: string;
};

type GuestShellStepUp = {
  expiresAt: string;
  sessionId: string;
  userId: string;
  verifiedAt: string;
};

function defaultAuthStore(): AuthStore {
  return {
    passwordResets: [],
    sessions: [],
    users: [],
  };
}

function defaultAuthSecurityState(): AuthSecurityState {
  return {
    loginAttempts: {},
    resetAttempts: {},
    totpAttempts: {},
    usedChallengeNonces: {},
    usedTotpCodes: {},
  };
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(value);
}

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60_000);
}

function isPrivateOrLocalHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }

  // RFC 1918 private IPv4 ranges (10.x, 172.16-31.x, 192.168.x) and link-local
  const segments = hostname.split(".").map(Number);
  if (segments.length === 4 && segments.every((s) => Number.isFinite(s))) {
    const [a = 0, b = 0] = segments;
    if (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    ) {
      return true;
    }
  }

  return false;
}

function shouldUseSecureCookies() {
  const explicit = process.env.AUTH_COOKIE_SECURE?.trim();
  if (explicit === "true") return true;
  if (explicit === "false") return false;

  if (process.env.NODE_ENV === "development") {
    return false;
  }

  // In production, disable secure cookies for private/local APP_URL hosts
  // (typically accessed over plain HTTP on corporate networks).
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    try {
      const url = new URL(appUrl);
      if (isPrivateOrLocalHost(url.hostname) || url.protocol === "http:") return false;
    } catch {}
  }

  return true;
}

function ensureStrongPassword(password: string) {
  if (password.length < 12) {
    throw new Error("Passwords must be at least 12 characters long.");
  }
  if (password.length > 256) {
    throw new Error("Passwords must be at most 256 characters long.");
  }
}

function normalizeRecoveryCode(code: string) {
  return code.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function normalizeTotpCode(code: string) {
  return code.replace(/\s+/g, "");
}

function hashOpaqueValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function timingSafeHashEqual(a: string, b: string) {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");

  if (bufA.length !== bufB.length) {
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

function buildCookieValue(payload: string, secret: Buffer, namespace: string) {
  const encodedPayload = Buffer.from(payload, "utf8").toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${namespace}:${encodedPayload}`)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

function readCookieValue(value: string, secret: Buffer, namespace: string) {
  const parts = value.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, signature] = parts;

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(`${namespace}:${encodedPayload}`)
    .digest("base64url");

  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  try {
    return Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

async function readAuthStore(): Promise<AuthStore> {
  return readDataJsonFileCached("auth-store.json", {
    failClosed: true,
    fallback: defaultAuthStore,
    normalize: (parsed) => {
      const store = parsed as Partial<AuthStore>;
      return {
        passwordResets: Array.isArray(store.passwordResets) ? store.passwordResets : [],
        sessions: Array.isArray(store.sessions) ? store.sessions : [],
        users: Array.isArray(store.users) ? store.users : [],
      };
    },
  });
}

async function writeAuthStore(store: AuthStore) {
  const filePath = await resolveDataFilePath("auth-store.json");
  await writeJsonFileAtomically(filePath, store);
}

let authStoreMutationQueue = Promise.resolve();
let twoFactorLoginQueue = Promise.resolve();

async function mutateAuthStore<T>(callback: (store: AuthStore) => Promise<T> | T) {
  const previousMutation = authStoreMutationQueue;
  let releaseQueue!: () => void;

  authStoreMutationQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previousMutation.catch((err) => { console.error("[auth] Previous mutation failed:", err); });

  try {
    const store = await readAuthStore();
    const nextStore: AuthStore = {
      passwordResets: store.passwordResets.filter(
        (item) => !item.usedAt && new Date(item.expiresAt).getTime() > Date.now(),
      ),
      sessions: store.sessions.filter(
        (item) => !item.revokedAt && new Date(item.expiresAt).getTime() > Date.now(),
      ),
      users: store.users,
    };
    const result = await callback(nextStore);
    await writeAuthStore(nextStore);

    return result;
  } finally {
    releaseQueue();
  }
}

async function serializeTwoFactorLogin<T>(callback: () => Promise<T>) {
  const previousLogin = twoFactorLoginQueue;
  let releaseQueue!: () => void;

  twoFactorLoginQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previousLogin.catch((error) => {
    console.error("[auth] Previous 2FA login failed:", error);
  });

  try {
    return await callback();
  } finally {
    releaseQueue();
  }
}

function isRateLimitEntry(value: unknown): value is RateLimitEntry {
  return Boolean(
    value &&
      typeof value === "object" &&
      Number.isFinite((value as RateLimitEntry).count) &&
      Number.isFinite((value as RateLimitEntry).firstAttempt),
  );
}

function isStringNumberRecord(value: unknown): value is Record<string, number> {
  return Boolean(
    value &&
      typeof value === "object" &&
      Object.values(value as Record<string, unknown>).every((entry) => Number.isFinite(entry)),
  );
}

function sanitizeRateLimitTracker(value: unknown): RateLimitTracker {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, entry]) => isRateLimitEntry(entry)),
  ) as RateLimitTracker;
}

function sanitizeUsedTotpTracker(value: unknown): UsedTotpTracker {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, entry]) => isStringNumberRecord(entry)),
  ) as UsedTotpTracker;
}

async function readAuthSecurityState(): Promise<AuthSecurityState> {
  return readDataJsonFileCached(AUTH_SECURITY_STATE_FILE_NAME, {
    fallback: defaultAuthSecurityState,
    normalize: (parsed) => {
      const state = parsed as Partial<AuthSecurityState>;
      return {
        loginAttempts: sanitizeRateLimitTracker(state.loginAttempts),
        resetAttempts: sanitizeRateLimitTracker(state.resetAttempts),
        totpAttempts: sanitizeRateLimitTracker(state.totpAttempts),
        usedChallengeNonces: isStringNumberRecord(state.usedChallengeNonces)
          ? state.usedChallengeNonces
          : {},
        usedTotpCodes: sanitizeUsedTotpTracker(state.usedTotpCodes),
      };
    },
  });
}

async function writeAuthSecurityState(state: AuthSecurityState) {
  const filePath = await resolveDataFilePath(AUTH_SECURITY_STATE_FILE_NAME);
  await writeJsonFileAtomically(filePath, state);
}

const mutateAuthSecurityState = createStoreMutator(
  "auth-security",
  readAuthSecurityState,
  writeAuthSecurityState,
);

async function hashPassword(password: string) {
  ensureStrongPassword(password);

  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64, SCRYPT_PARAMS);

  return `scrypt:${salt.toString("base64url")}:${derivedKey.toString("base64url")}`;
}

async function verifyPassword(password: string, storedHash: string) {
  // SSO-provisioned users have an empty `passwordHash` — they cannot authenticate
  // via the password flow at all. Reject before parsing so the caller's "wrong
  // credentials" message is consistent with a non-SSO unknown user.
  if (!storedHash) return false;

  const [algorithm, saltRaw, keyRaw] = storedHash.split(":");

  if (algorithm !== "scrypt" || !saltRaw || !keyRaw) {
    return false;
  }

  const salt = Buffer.from(saltRaw, "base64url");
  const expected = Buffer.from(keyRaw, "base64url");
  const derived = await scrypt(password, salt, expected.length, SCRYPT_PARAMS);

  return timingSafeEqual(derived, expected);
}

function generateRandomBase32Secret() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }

  return output;
}

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.replace(/=+$/g, "").toUpperCase().replace(/\s+/g, "");
  let bits = 0;
  let aggregate = 0;
  const output: number[] = [];

  for (const character of normalized) {
    const index = alphabet.indexOf(character);

    if (index === -1) {
      throw new Error("Invalid base32 secret.");
    }

    aggregate = (aggregate << 5) | index;
    bits += 5;

    if (bits >= 8) {
      output.push((aggregate >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

function generateTotp(secret: string, timestamp: number) {
  const counter = Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", decodeBase32(secret))
    .update(counterBuffer)
    .digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function verifyTotp(secret: string, token: string) {
  const normalized = token.replace(/\s+/g, "");

  if (!/^\d{6}$/.test(normalized)) {
    return false;
  }

  const now = Date.now();
  const normalizedBuf = Buffer.from(normalized, "utf8");

  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
    const candidate = generateTotp(secret, now + offset * TOTP_PERIOD_SECONDS * 1000);
    const candidateBuf = Buffer.from(candidate, "utf8");

    if (candidateBuf.length === normalizedBuf.length && timingSafeEqual(candidateBuf, normalizedBuf)) {
      return true;
    }
  }

  return false;
}

function buildOtpAuthUrl(user: Pick<StoredUser, "email">, secret: string) {
  const issuer = encodeURIComponent("Tainer");
  const label = encodeURIComponent(`Tainer:${user.email}`);

  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

function generateRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    Array.from({ length: RECOVERY_CODE_SEGMENTS }, () =>
      randomBytes(RECOVERY_CODE_SEGMENT_LENGTH / 2)
        .toString("hex")
        .toUpperCase(),
    ).join("-"),
  );
}

async function sanitizeUser(user: StoredUser): Promise<SessionUser> {
  const groupIds = user.groupIds ?? [];
  const { resolveEffectivePermissions } = await import("@/lib/user-groups");
  const resolved = await resolveEffectivePermissions(groupIds);

  // Determine effective role: honour group-based admin flag, but also
  // respect the stored user.role when the user has no groups assigned
  // (e.g. the initial admin created during setup).
  const effectiveAdmin = resolved.isAdmin || user.role === "admin";

  // Admins get the full permission set populated explicitly. Previously
  // `hasPermission` short-circuited on `role === "admin"` — meaning anything
  // that flipped role to admin was a full takeover even if `permissions`
  // stayed empty. With permissions enumerated here, the source of truth is
  // the list itself: a future code path that mutated role without going
  // through sanitizeUser would no longer escalate. The visible behaviour is
  // unchanged (admins still see / do everything), but the security property
  // tightens.
  const permissions = effectiveAdmin
    ? [...ALL_PERMISSIONS]
    : resolved.globalPermissions;

  return {
    accessibleSiteIds: resolved.accessibleSiteIds,
    email: user.email,
    groupIds,
    hasTwoFactor: Boolean(user.twoFactorSecret),
    id: user.id,
    name: user.name,
    permissions,
    role: effectiveAdmin ? "admin" : "operator",
    sitePermissions: resolved.sitePermissions,
  };
}

async function setSessionCookie(sessionId: string, expiresAt: string) {
  const cookieStore = await cookies();
  const secret = await getAuthSecret();
  const value = buildCookieValue(sessionId, secret, SESSION_COOKIE_NAME);
  const secure = shouldUseSecureCookies();

  cookieStore.set(SESSION_COOKIE_NAME, value, {
    expires: new Date(expiresAt),
    httpOnly: true,
    path: "/",
    // `lax` (not `strict`) is required for federated sign-in flows: when the
    // user comes back from an OIDC IdP via a cross-site redirect, Chrome
    // refuses to send `strict` cookies on the first navigation, so the user
    // lands on /login until they reload (the bug we just hit). `lax` still
    // blocks CSRF on cross-site form POSTs (the threat model `strict`
    // protects against) — it only relaxes top-level navigations.
    sameSite: "lax",
    secure,
  });
}

async function clearSessionCookie() {
  const cookieStore = await cookies();
  const secure = shouldUseSecureCookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    expires: new Date(0),
    httpOnly: true,
    path: "/",
    // Match setSessionCookie so the browser's cookie-jar lookup paired with
    // the same SameSite is what removes the entry.
    sameSite: "lax",
    secure,
  });
}

async function setLoginChallengeCookie(challenge: LoginChallenge) {
  const cookieStore = await cookies();
  const secret = await getAuthSecret();
  const value = buildCookieValue(JSON.stringify(challenge), secret, LOGIN_CHALLENGE_COOKIE_NAME);
  const secure = shouldUseSecureCookies();

  cookieStore.set(LOGIN_CHALLENGE_COOKIE_NAME, value, {
    expires: new Date(challenge.expiresAt),
    httpOnly: true,
    path: "/",
    sameSite: "strict",
    secure,
  });
}

async function clearLoginChallengeCookie() {
  const cookieStore = await cookies();
  const secure = shouldUseSecureCookies();
  cookieStore.set(LOGIN_CHALLENGE_COOKIE_NAME, "", {
    expires: new Date(0),
    httpOnly: true,
    path: "/",
    sameSite: "strict",
    secure,
  });
}

async function setGuestShellStepUpCookie(stepUp: GuestShellStepUp) {
  const cookieStore = await cookies();
  const secret = await getAuthSecret();
  const value = buildCookieValue(JSON.stringify(stepUp), secret, SSH_STEP_UP_COOKIE_NAME);
  const secure = shouldUseSecureCookies();

  cookieStore.set(SSH_STEP_UP_COOKIE_NAME, value, {
    expires: new Date(stepUp.expiresAt),
    httpOnly: true,
    path: "/",
    sameSite: "strict",
    secure,
  });
}

async function clearGuestShellStepUpCookie() {
  const cookieStore = await cookies();
  const secure = shouldUseSecureCookies();
  cookieStore.set(SSH_STEP_UP_COOKIE_NAME, "", {
    expires: new Date(0),
    httpOnly: true,
    path: "/",
    sameSite: "strict",
    secure,
  });
}

async function readLoginChallengeCookie() {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(LOGIN_CHALLENGE_COOKIE_NAME)?.value;

  if (!cookie) {
    return null;
  }

  const secret = await getAuthSecret();
  const decoded = readCookieValue(cookie, secret, LOGIN_CHALLENGE_COOKIE_NAME);

  if (!decoded) {
    return null;
  }

  try {
    const challenge = JSON.parse(decoded) as LoginChallenge;

    if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
      return null;
    }

    return challenge;
  } catch {
    return null;
  }
}

async function readSessionIdFromCookies() {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!cookie) {
    return null;
  }

  const secret = await getAuthSecret();

  return readCookieValue(cookie, secret, SESSION_COOKIE_NAME);
}

async function readGuestShellStepUpCookie() {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SSH_STEP_UP_COOKIE_NAME)?.value;

  if (!cookie) {
    return null;
  }

  const secret = await getAuthSecret();
  const decoded = readCookieValue(cookie, secret, SSH_STEP_UP_COOKIE_NAME);

  if (!decoded) {
    return null;
  }

  try {
    const stepUp = JSON.parse(decoded) as GuestShellStepUp;

    if (
      typeof stepUp.expiresAt !== "string" ||
      typeof stepUp.sessionId !== "string" ||
      typeof stepUp.userId !== "string" ||
      typeof stepUp.verifiedAt !== "string"
    ) {
      return null;
    }

    if (new Date(stepUp.expiresAt).getTime() <= Date.now()) {
      return null;
    }

    return stepUp;
  } catch {
    return null;
  }
}

async function savePasswordResetDebugEntry(entry: PasswordResetDebugEntry) {
  // Previously this persisted the reset link (with the single-use token in
  // the path) to password-reset-debug.json in the data directory. That made
  // any disk-level compromise — backup leak, snapshot copy, post-RCE read
  // — a path to hijack any pending reset within the link's TTL. We now log
  // the link to stderr only; the operator running the container is the
  // only intended audience, and the link disappears with the log line.
  console.info(
    `[auth] Password reset link for ${entry.email} (expires ${entry.expiresAt}): ${entry.link}`,
  );
}

async function sendPasswordResetEmail(email: string, name: string, link: string) {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number.parseInt(process.env.SMTP_PORT ?? "587", 10);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim();

  if (!host || !from) {
    await savePasswordResetDebugEntry({
      createdAt: nowIso(),
      email,
      expiresAt: addMinutes(new Date(), PASSWORD_RESET_TTL_MINUTES).toISOString(),
      link,
    });
    return false;
  }

  const transporter = nodemailer.createTransport({
    auth: user && pass ? { pass, user } : undefined,
    host,
    port,
    secure: port === 465,
    ...(port !== 465 ? { requireTLS: true } : {}),
  });

  await transporter.sendMail({
    from,
    html: `<p>Hello ${escapeHtml(name || "there")},</p><p>Use the link below to reset your Tainer password. It expires in ${PASSWORD_RESET_TTL_MINUTES} minutes.</p><p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
    subject: "Reset your Tainer password",
    text: `Hello ${name || "there"},\n\nReset your Tainer password with this link:\n${link}\n\nThis link expires in ${PASSWORD_RESET_TTL_MINUTES} minutes.`,
    to: email,
  });

  return true;
}

export async function getUserCount() {
  const store = await readAuthStore();
  return store.users.length;
}

/**
 * Bearer-token fallback for automation clients (scripts, Terraform, CI).
 * Only consulted when no session cookie is present; the resulting session
 * is role "operator" with exactly the token's granted site permissions, so
 * admin-only surfaces and ungranted capabilities refuse it. Tokens are not
 * ambient authority — browsers never attach the header on their own, so
 * this adds no CSRF surface.
 */
async function getApiTokenSession(): Promise<AuthSession | null> {
  try {
    const headerStore = await headers();
    const authorization = headerStore.get("authorization");
    if (!authorization?.startsWith("Bearer tnr_")) return null;
    const { getSessionForBearerToken } = await import("@/lib/api-tokens");
    return await getSessionForBearerToken(authorization);
  } catch {
    // headers() unavailable (static render) or store read failure — treat
    // as unauthenticated rather than erroring the caller.
    return null;
  }
}

export async function getCurrentSession(): Promise<AuthSession | null> {
  const sessionId = await readSessionIdFromCookies();

  if (!sessionId) {
    return getApiTokenSession();
  }

  const { ensureUserGroupsMigrated } = await import("@/lib/user-groups");
  await ensureUserGroupsMigrated();

  const store = await readAuthStore();
  const session = store.sessions.find(
    (entry) =>
      entry.id === sessionId &&
      !entry.revokedAt &&
      new Date(entry.expiresAt).getTime() > Date.now(),
  );

  if (!session) {
    return null;
  }

  const user = store.users.find((entry) => entry.id === session.userId);

  if (!user) {
    return null;
  }

  if (Date.now() - new Date(session.lastSeenAt).getTime() >= SESSION_LAST_SEEN_UPDATE_MS) {
    const refreshedAt = nowIso();

    await mutateAuthStore((nextStore) => {
      const nextSession = nextStore.sessions.find(
        (entry) =>
          entry.id === session.id &&
          !entry.revokedAt &&
          new Date(entry.expiresAt).getTime() > Date.now(),
      );

      if (nextSession) {
        nextSession.lastSeenAt = refreshedAt;
      }
    });
  }

  return {
    expiresAt: session.expiresAt,
    id: session.id,
    user: await sanitizeUser(user),
  };
}

export async function requireSession() {
  const session = await getCurrentSession();

  if (!session) {
    throw new Error("Authentication required.");
  }

  return session;
}

export async function requireAdminSession() {
  const session = await requireSession();

  if (session.user.role !== "admin") {
    throw new Error("Administrator access required.");
  }

  return session;
}

export function hasPermission(session: AuthSession, permission: Permission): boolean {
  // No `role === "admin"` short-circuit: admin grants are now explicit in
  // `session.user.permissions` (see sanitizeUser). The list is the source
  // of truth for capability checks, so any path that grants a permission
  // has to go through sanitizeUser → group resolution. `requireAdminSession`
  // remains for things that gate specifically on admin role (audit log,
  // IdP config, user management UI), but ad-hoc `role === "admin"` checks
  // for capability-style gates are an antipattern — use `requirePermission`.
  return session.user.permissions.includes(permission);
}

export function requirePermission(session: AuthSession, permission: Permission): void {
  if (!hasPermission(session, permission)) {
    throw new Error(`Insufficient permissions: requires ${permission}.`);
  }
}

export function hasSitePermission(
  session: AuthSession,
  siteId: string,
  permission: Permission,
): boolean {
  if (session.user.role === "admin") return true;
  const perms = session.user.sitePermissions[siteId];
  return perms?.includes(permission) ?? false;
}

export function requireSitePermission(
  session: AuthSession,
  siteId: string,
  permission: Permission,
): void {
  if (!hasSitePermission(session, siteId, permission)) {
    throw new Error(`Insufficient permissions for this site: requires ${permission}.`);
  }
}

export function hasSiteAccess(
  session: AuthSession,
  siteId: string,
): boolean {
  if (session.user.role === "admin") return true;
  return session.user.accessibleSiteIds.includes(siteId);
}

export function requireSiteAccess(
  session: AuthSession,
  siteId: string,
): void {
  if (!hasSiteAccess(session, siteId)) {
    throw new Error("You do not have access to this site.");
  }
}

async function isStoredUserAdmin(user: StoredUser): Promise<boolean> {
  if (user.role === "admin") return true;
  const groupIds = user.groupIds ?? [];
  if (groupIds.length === 0) return false;
  const { getUserGroupsByIds } = await import("@/lib/user-groups");
  const groups = await getUserGroupsByIds(groupIds);
  return groups.some((g) => g.isAdmin);
}

export async function getUserGroupMembership(
  userId: string,
): Promise<{ groupIds: string[]; isAdmin: boolean } | null> {
  const store = await readAuthStore();
  const user = store.users.find((u) => u.id === userId);
  if (!user) return null;
  return { groupIds: user.groupIds ?? [], isAdmin: await isStoredUserAdmin(user) };
}

export function canGrantGroup(
  session: AuthSession,
  group: Pick<UserGroupInput, "isAdmin" | "globalPermissions" | "siteAccess">,
): boolean {
  if (session.user.role === "admin") return true;
  if (group.isAdmin) return false;
  return (
    group.globalPermissions.every((p) => hasPermission(session, p)) &&
    group.siteAccess.every((entry) =>
      entry.permissions.every((p) => hasSitePermission(session, entry.siteId, p)),
    )
  );
}

async function requireAdminToManageUser(session: AuthSession, target: StoredUser) {
  if (session.user.role === "admin") return;
  const { getUserGroupsByIds } = await import("@/lib/user-groups");
  const groups = await getUserGroupsByIds(target.groupIds ?? []);
  if (target.role === "admin" || groups.some((g) => g.isAdmin)) {
    throw new Error("Only admins can manage admin users.");
  }
  if (!groups.every((g) => canGrantGroup(session, g))) {
    throw new Error("You cannot manage users with permissions you do not have.");
  }
}

export async function updateUserGroups(
  userId: string,
  groupIds: string[],
): Promise<void> {
  await mutateAuthStore(async (store) => {
    const user = store.users.find((u) => u.id === userId);
    if (!user) throw new Error("User not found.");

    const { getUserGroupsByIds } = await import("@/lib/user-groups");
    const groups = await getUserGroupsByIds(groupIds);
    const validGroupIds = groups.map((g) => g.id);

    user.groupIds = validGroupIds;
    user.role = groups.some((g) => g.isAdmin) ? "admin" : "operator";
    user.permissions = [];
    user.updatedAt = new Date().toISOString();
  });
}

export async function updateUserPermissions(
  userId: string,
  permissions: Permission[],
): Promise<void> {
  const validPermissions = permissions.filter((p) =>
    ALL_PERMISSIONS.includes(p),
  );

  await mutateAuthStore(async (store) => {
    const user = store.users.find((u) => u.id === userId);
    if (!user) throw new Error("User not found.");
    user.permissions = validPermissions;
    user.updatedAt = new Date().toISOString();
  });
}

export async function migrateUsersToGroups(
  adminGroupId: string,
  operatorGroupId: string,
): Promise<void> {
  await mutateAuthStore((store) => {
    const timestamp = new Date().toISOString();

    for (const user of store.users) {
      if (user.groupIds && user.groupIds.length > 0) continue;

      if (user.role === "admin") {
        user.groupIds = [adminGroupId];
      } else {
        user.groupIds = [operatorGroupId];
      }

      user.updatedAt = timestamp;
    }
  });
}

export async function signOutCurrentSession() {
  const sessionId = await readSessionIdFromCookies();

  if (sessionId) {
    await mutateAuthStore((store) => {
      const session = store.sessions.find((entry) => entry.id === sessionId);

      if (session) {
        session.revokedAt = nowIso();
      }
    });
  }

  await clearSessionCookie();
  await clearLoginChallengeCookie();
  await clearGuestShellStepUpCookie();
}

export async function createInitialAdministrator(input: {
  email: string;
  name: string;
  password: string;
}) {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();

  if (!email || !name) {
    throw new Error("Name and email are required.");
  }

  if (!isValidEmail(email)) {
    throw new Error("Enter a valid email address.");
  }

  return mutateAuthStore(async (store) => {
    if (store.users.length > 0) {
      throw new Error("Initial setup has already been completed.");
    }

    const passwordHash = await hashPassword(input.password);
    const timestamp = nowIso();

    store.users.push({
      createdAt: timestamp,
      email,
      id: randomUUID(),
      name,
      passwordHash,
      passwordUpdatedAt: timestamp,
      pendingTwoFactorSecret: null,
      pendingTwoFactorExpiresAt: null,
      role: "admin",
      twoFactorRecoveryCodeHashes: [],
      twoFactorSecret: null,
      twoFactorUpdatedAt: null,
      updatedAt: timestamp,
    });
  });
}

function pruneRateLimitTracker(tracker: RateLimitTracker, windowMs: number) {
  const cutoff = Date.now() - windowMs;

  for (const [key, entry] of Object.entries(tracker)) {
    if (entry.firstAttempt < cutoff) {
      delete tracker[key];
    }
  }
}

function pruneUsedTotpCodes(tracker: UsedTotpTracker) {
  const cutoff = Date.now() - 90_000;

  for (const [userId, codes] of Object.entries(tracker)) {
    for (const [code, timestamp] of Object.entries(codes)) {
      if (timestamp < cutoff) {
        delete codes[code];
      }
    }

    if (Object.keys(codes).length === 0) {
      delete tracker[userId];
    }
  }
}

function pruneUsedChallengeNonces(usedChallengeNonces: Record<string, number>) {
  const cutoff = Date.now() - LOGIN_CHALLENGE_TTL_MINUTES * 60_000;

  for (const [nonce, timestamp] of Object.entries(usedChallengeNonces)) {
    if (timestamp < cutoff) {
      delete usedChallengeNonces[nonce];
    }
  }
}

function pruneAuthSecurityState(state: AuthSecurityState) {
  pruneRateLimitTracker(state.loginAttempts, LOGIN_WINDOW_MS);
  pruneRateLimitTracker(state.resetAttempts, RESET_WINDOW_MS);
  pruneRateLimitTracker(state.totpAttempts, TOTP_WINDOW_MS);
  pruneUsedTotpCodes(state.usedTotpCodes);
  pruneUsedChallengeNonces(state.usedChallengeNonces);
}

async function checkRateLimit(
  tracker: keyof Pick<AuthSecurityState, "loginAttempts" | "resetAttempts" | "totpAttempts">,
  key: string,
  maxAttempts: number,
  windowMs: number,
  message: string,
) {
  await mutateAuthSecurityState((state) => {
    pruneAuthSecurityState(state);

    const bucket = state[tracker];
    const now = Date.now();
    const entry = bucket[key];

    if (entry && now - entry.firstAttempt < windowMs) {
      if (entry.count >= maxAttempts) {
        throw new Error(message);
      }

      entry.count += 1;
      return;
    }

    bucket[key] = {
      count: 1,
      firstAttempt: now,
    };
  });
}

async function clearRateLimit(
  tracker: keyof Pick<AuthSecurityState, "loginAttempts" | "resetAttempts" | "totpAttempts">,
  key: string,
) {
  await mutateAuthSecurityState((state) => {
    pruneAuthSecurityState(state);
    delete state[tracker][key];
  });
}

async function reserveTotpCode(userId: string, code: string) {
  const normalizedCode = normalizeTotpCode(code);

  return mutateAuthSecurityState((state) => {
    pruneAuthSecurityState(state);

    const userCodes = state.usedTotpCodes[userId] ?? {};

    if (userCodes[normalizedCode]) {
      return false;
    }

    userCodes[normalizedCode] = Date.now();
    state.usedTotpCodes[userId] = userCodes;

    return true;
  });
}

async function recordChallengeNonce(nonce: string) {
  return mutateAuthSecurityState((state) => {
    pruneAuthSecurityState(state);

    if (state.usedChallengeNonces[nonce]) {
      return false;
    }

    state.usedChallengeNonces[nonce] = Date.now();
    return true;
  });
}

async function claimTotpCodeForChallenge(userId: string, code: string, nonce: string) {
  const normalizedCode = normalizeTotpCode(code);

  return mutateAuthSecurityState((state) => {
    pruneAuthSecurityState(state);

    if (state.usedChallengeNonces[nonce]) {
      return "challenge-used" as const;
    }

    const userCodes = state.usedTotpCodes[userId] ?? {};

    if (userCodes[normalizedCode]) {
      return "code-used" as const;
    }

    const now = Date.now();
    state.usedChallengeNonces[nonce] = now;
    userCodes[normalizedCode] = now;
    state.usedTotpCodes[userId] = userCodes;

    return "ok" as const;
  });
}

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60_000;

async function checkLoginRateLimit(email: string, clientIp?: string) {
  await checkRateLimit(
    "loginAttempts",
    clientIp ? `${email}:${clientIp}` : email,
    LOGIN_MAX_ATTEMPTS,
    LOGIN_WINDOW_MS,
    "Too many login attempts. Try again in a few minutes.",
  );
}

async function clearLoginRateLimit(email: string, clientIp?: string) {
  await clearRateLimit("loginAttempts", clientIp ? `${email}:${clientIp}` : email);
}

const RESET_MAX_ATTEMPTS = 3;
const RESET_WINDOW_MS = 15 * 60_000;

async function checkResetRateLimit(email: string) {
  const normalized = email.toLowerCase().trim();

  await checkRateLimit(
    "resetAttempts",
    normalized,
    RESET_MAX_ATTEMPTS,
    RESET_WINDOW_MS,
    "Too many password reset requests. Try again later.",
  );
}

const TOTP_MAX_ATTEMPTS = 3;
const TOTP_WINDOW_MS = 5 * 60_000;

async function checkTotpRateLimit(userId: string) {
  await checkRateLimit(
    "totpAttempts",
    userId,
    TOTP_MAX_ATTEMPTS,
    TOTP_WINDOW_MS,
    "Too many verification attempts. Try again in a few minutes.",
  );
}

async function clearTotpRateLimit(userId: string) {
  await clearRateLimit("totpAttempts", userId);
}

export async function beginLogin(email: string, password: string, clientIp?: string) {
  const normalizedEmail = normalizeEmail(email);
  await checkLoginRateLimit(normalizedEmail, clientIp);

  // ── 1. Local password ──────────────────────────────────────────────
  const store = await readAuthStore();
  const localUser = store.users.find((entry) => entry.email === normalizedEmail);
  const localOk = localUser && (await verifyPassword(password, localUser.passwordHash));

  let authedUser: StoredUser | undefined = localOk ? localUser : undefined;

  // ── 2. LDAP fallback ────────────────────────────────────────────────
  // Tried only when local auth didn't succeed AND LDAP is configured. The
  // directory is the source of truth for the *LDAP-backed* subset of
  // users; locally-created accounts always take precedence (they hit the
  // local-password branch above first). Trust-boundary checks live inside
  // signInWithLdap.
  if (!authedUser) {
    const { isLdapEnabled, getLdapConfig, isEmailAllowed } = await import("@/lib/ldap-config");
    if (await isLdapEnabled()) {
      const config = await getLdapConfig();
      if (config) {
        // Domain allowlist applied BEFORE we touch the directory — saves
        // a directory round-trip for emails that are obviously out of
        // scope and avoids leaking the existence of arbitrary emails to
        // the LDAP audit log.
        if (!isEmailAllowed(normalizedEmail, config.allowedEmailDomains)) {
          // Fall through; no special-casing — user gets the generic
          // "Invalid email or password" treatment below.
        } else {
          const { authenticateLdap } = await import("@/lib/ldap");
          const ldapResult = await authenticateLdap(config, normalizedEmail, password);
          if (ldapResult.ok) {
            try {
              const signed = await signInWithLdap({
                dn: ldapResult.user.dn,
                email: ldapResult.user.email,
                name: ldapResult.user.name,
                autoProvision: config.autoProvision,
                defaultRole: config.defaultRole,
              });
              authedUser = signed.user;
              const { recordAdminAudit } = await import("@/lib/admin-audit-log");
              recordAdminAudit({
                action: signed.provisioned ? "ldap-user-provisioned" : "ldap-login-success",
                actorEmail: signed.user.email,
                actorName: signed.user.name,
                message: signed.provisioned
                  ? `Provisioned new ${signed.user.role} via LDAP (dn=${ldapResult.user.dn})`
                  : `Signed in via LDAP`,
              }).catch(() => {});
            } catch (err) {
              // Trust-boundary refusal lands here. We surface a generic
              // "invalid credentials" to the user rather than the precise
              // reason — exposing "this email is taken by a local-password
              // user" would let an attacker enumerate which Tainer users
              // exist locally vs in LDAP.
              const { recordAdminAudit } = await import("@/lib/admin-audit-log");
              recordAdminAudit({
                action: "ldap-login-failure",
                actorEmail: normalizedEmail,
                actorName: normalizedEmail,
                message: `LDAP sign-in refused: ${err instanceof Error ? err.message : "unknown"}`,
              }).catch(() => {});
            }
          } else {
            const { recordAdminAudit } = await import("@/lib/admin-audit-log");
            recordAdminAudit({
              action: "ldap-login-failure",
              actorEmail: normalizedEmail,
              actorName: normalizedEmail,
              message: `LDAP sign-in failed: ${ldapResult.reason}`,
            }).catch(() => {});
          }
        }
      }
    }
  }

  if (!authedUser) {
    throw new Error("Invalid email or password.");
  }

  await clearLoginRateLimit(normalizedEmail, clientIp);

  if (authedUser.twoFactorSecret) {
    const challenge: LoginChallenge = {
      expiresAt: addMinutes(new Date(), LOGIN_CHALLENGE_TTL_MINUTES).toISOString(),
      nonce: randomBytes(16).toString("base64url"),
      userId: authedUser.id,
    };

    await setLoginChallengeCookie(challenge);

    return {
      requiresTwoFactor: true,
      user: sanitizeUser(authedUser),
    };
  }

  await createSession(authedUser.id);
  return {
    requiresTwoFactor: false,
    user: sanitizeUser(authedUser),
  };
}

export async function completeTwoFactorLogin(code: string) {
  return serializeTwoFactorLogin(async () => {
    const challenge = await readLoginChallengeCookie();

    if (!challenge) {
      throw new Error("Your login session expired. Enter email and password again.");
    }

    await checkTotpRateLimit(challenge.userId);

    const store = await readAuthStore();
    const user = store.users.find((entry) => entry.id === challenge.userId);

    if (!user || !user.twoFactorSecret) {
      throw new Error("Two-factor authentication is not available for this account.");
    }

    const secret = await decryptText(user.twoFactorSecret);
    const normalizedRecoveryCode = normalizeRecoveryCode(code);
    const normalizedTotpCode = normalizeTotpCode(code);
    const isTotp = verifyTotp(secret, normalizedTotpCode);

    if (!isTotp) {
      const recoveryHash = hashOpaqueValue(normalizedRecoveryCode);

      // Record challenge nonce first to prevent replay, then atomically
      // verify and consume the recovery code inside mutateAuthStore.
      if (!(await recordChallengeNonce(challenge.nonce))) {
        throw new Error("This login challenge has already been used.");
      }

      const consumed = await mutateAuthStore((nextStore) => {
        const nextUser = nextStore.users.find((entry) => entry.id === user.id);

        if (!nextUser) {
          throw new Error("Two-factor authentication is not available for this account.");
        }

        const recoveryIndex = nextUser.twoFactorRecoveryCodeHashes.findIndex(
          (entry) => timingSafeHashEqual(entry, recoveryHash),
        );

        if (recoveryIndex === -1) {
          return false;
        }

        nextUser.twoFactorRecoveryCodeHashes.splice(recoveryIndex, 1);
        nextUser.updatedAt = nowIso();

        return true;
      });

      if (!consumed) {
        throw new Error("Invalid authenticator code or recovery code.");
      }
    } else {
      const claimResult = await claimTotpCodeForChallenge(
        user.id,
        normalizedTotpCode,
        challenge.nonce,
      );

      if (claimResult === "challenge-used") {
        throw new Error("This login challenge has already been used.");
      }

      if (claimResult === "code-used") {
        throw new Error("This code has already been used. Wait for a new code.");
      }
    }

    await clearTotpRateLimit(challenge.userId);
    await clearLoginChallengeCookie();
    await createSession(user.id);

    return sanitizeUser(user);
  });
}

// Mobile login — does not set cookies; returns an encrypted challenge token if 2FA is required.
export async function beginMobileLogin(email: string, password: string, clientIp?: string) {
  const normalizedEmail = normalizeEmail(email);
  await checkLoginRateLimit(normalizedEmail, clientIp);

  const store = await readAuthStore();
  const user = store.users.find((entry) => entry.email === normalizedEmail);

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new Error("Invalid email or password.");
  }

  await clearLoginRateLimit(normalizedEmail, clientIp);

  if (user.twoFactorSecret) {
    const challenge: LoginChallenge = {
      expiresAt: addMinutes(new Date(), LOGIN_CHALLENGE_TTL_MINUTES).toISOString(),
      nonce: randomBytes(16).toString("base64url"),
      userId: user.id,
    };

    const challengeToken = await encryptText(JSON.stringify(challenge));

    return {
      challengeToken,
      requiresTwoFactor: true as const,
      user: await sanitizeUser(user),
    };
  }

  const sessionId = await createSessionForMobile(user.id);

  return {
    requiresTwoFactor: false as const,
    sessionId,
    user: await sanitizeUser(user),
  };
}

export async function completeMobileTwoFactorLogin(challengeToken: string, code: string) {
  return serializeTwoFactorLogin(async () => {
    let challenge: LoginChallenge;

    try {
      const decrypted = await decryptText(challengeToken);
      challenge = JSON.parse(decrypted) as LoginChallenge;
    } catch {
      throw new Error("Your login session expired. Enter email and password again.");
    }

    if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
      throw new Error("Your login session expired. Enter email and password again.");
    }

    await checkTotpRateLimit(challenge.userId);

    const store = await readAuthStore();
    const user = store.users.find((entry) => entry.id === challenge.userId);

    if (!user || !user.twoFactorSecret) {
      throw new Error("Two-factor authentication is not available for this account.");
    }

    const secret = await decryptText(user.twoFactorSecret);
    const normalizedRecoveryCode = normalizeRecoveryCode(code);
    const normalizedTotpCode = normalizeTotpCode(code);
    const isTotp = verifyTotp(secret, normalizedTotpCode);

    if (!isTotp) {
      const recoveryHash = hashOpaqueValue(normalizedRecoveryCode);

      if (!(await recordChallengeNonce(challenge.nonce))) {
        throw new Error("This login challenge has already been used.");
      }

      const consumed = await mutateAuthStore((nextStore) => {
        const nextUser = nextStore.users.find((entry) => entry.id === user.id);

        if (!nextUser) {
          throw new Error("Two-factor authentication is not available for this account.");
        }

        const recoveryIndex = nextUser.twoFactorRecoveryCodeHashes.findIndex(
          (entry) => timingSafeHashEqual(entry, recoveryHash),
        );

        if (recoveryIndex === -1) {
          return false;
        }

        nextUser.twoFactorRecoveryCodeHashes.splice(recoveryIndex, 1);
        nextUser.updatedAt = nowIso();

        return true;
      });

      if (!consumed) {
        throw new Error("Invalid authenticator code or recovery code.");
      }
    } else {
      const claimResult = await claimTotpCodeForChallenge(
        user.id,
        normalizedTotpCode,
        challenge.nonce,
      );

      if (claimResult === "challenge-used") {
        throw new Error("This login challenge has already been used.");
      }

      if (claimResult === "code-used") {
        throw new Error("This code has already been used. Wait for a new code.");
      }
    }

    await clearTotpRateLimit(challenge.userId);

    const sessionId = await createSessionForMobile(user.id);

    return {
      sessionId,
      user: await sanitizeUser(user),
    };
  });
}

export async function createSession(userId: string) {
  const expiresAt = addDays(new Date(), SESSION_TTL_DAYS).toISOString();
  const sessionId = randomBytes(32).toString("base64url");
  const timestamp = nowIso();

  await mutateAuthStore((store) => {
    store.sessions.push({
      createdAt: timestamp,
      expiresAt,
      id: sessionId,
      lastSeenAt: timestamp,
      revokedAt: null,
      source: "web",
      userId,
    });
  });

  await setSessionCookie(sessionId, expiresAt);
}

export type SsoSignInInput = {
  providerId: string;
  /** Stable identifier from the IdP (`sub` claim). */
  subject: string;
  email: string;
  /**
   * `email_verified` claim from the IdP. `null` if absent. When `false` the
   * sign-in is refused outright — an attacker controlling a permissive IdP
   * can otherwise assert any email.
   */
  emailVerified: boolean | null;
  name: string;
  /** Whether to auto-create a Tainer user if no match is found. */
  autoProvision: boolean;
  /** Role assigned to a newly-provisioned user. Ignored if user already exists. */
  defaultRole: AuthRole;
};

export type SsoSignInResult = {
  /** True if a brand-new Tainer user was just created. */
  provisioned: boolean;
  user: StoredUser;
};

/**
 * Sign a user in using credentials already validated by an OIDC provider.
 *
 * Trust boundary: the IdP is allowed to assert *its own* users — it is not
 * allowed to take over Tainer users that already have local credentials.
 * Specifically:
 *
 *   - We refuse if the IdP reported `email_verified: false`.
 *   - We match by (providerId, subject) first — that's the stable, IdP-scoped
 *     identifier and survives email rotation.
 *   - We fall back to matching by email ONLY for users that are linkable:
 *     no local password, no 2FA enrolled, and no prior SSO link to a
 *     different provider. Otherwise an attacker who registers the same
 *     email at a permissive IdP could bypass the local password and 2FA.
 *     The remediation in that case is for an admin to remove the local
 *     credential or pre-link the user.
 *
 * 2FA is therefore enforced indirectly: if a user has it enrolled, SSO
 * cannot adopt that account without admin action — the local 2FA challenge
 * is what authorises the link.
 */
export async function signInWithSso(
  input: SsoSignInInput,
): Promise<SsoSignInResult> {
  const email = normalizeEmail(input.email);
  if (!email) throw new Error("Identity provider did not return a valid email.");
  if (input.emailVerified === false) {
    throw new Error(
      "Identity provider reported the email address is not verified. " +
        "Sign-in refused.",
    );
  }
  const name = input.name.trim() || email;

  let provisioned = false;
  const user = await mutateAuthStore((store) => {
    // 1. Match by stable IdP subject — survives email changes and is the
    //    only path that can adopt an existing record.
    let existing = store.users.find(
      (u) => u.ssoProviderId === input.providerId && u.ssoSubject === input.subject,
    );

    // 2. Fall back to email match — but only for users that are safe to
    //    auto-link (no local password, no 2FA, no other SSO binding).
    if (!existing) {
      const candidate = store.users.find((u) => u.email === email);
      if (candidate) {
        const hasLocalPassword = Boolean(candidate.passwordHash);
        const hasTwoFactor = Boolean(candidate.twoFactorSecret);
        const linkedToDifferentProvider =
          (candidate.ssoProviderId &&
            candidate.ssoProviderId !== input.providerId) ||
          (candidate.ssoSubject && candidate.ssoSubject !== input.subject);

        if (hasLocalPassword || hasTwoFactor || linkedToDifferentProvider) {
          throw new Error(
            "An account with this email already exists in Tainer with " +
              "different credentials. Ask an administrator to link your " +
              "identity provider before signing in this way.",
          );
        }

        existing = candidate;
      }
    }

    if (existing) {
      const timestamp = nowIso();
      existing.ssoProviderId = input.providerId;
      existing.ssoSubject = input.subject;
      // Refresh display name — IdPs are usually the source of truth here.
      if (name && name !== existing.name) existing.name = name;
      existing.updatedAt = timestamp;
      return existing;
    }

    if (!input.autoProvision) {
      throw new Error(
        "Your account isn't set up in Tainer yet. Ask an administrator to add you, then try signing in again.",
      );
    }

    const timestamp = nowIso();
    const newUser: StoredUser = {
      createdAt: timestamp,
      email,
      groupIds: [],
      id: randomUUID(),
      name,
      passwordHash: "", // SSO-provisioned, no local password
      passwordUpdatedAt: timestamp,
      pendingTwoFactorSecret: null,
      pendingTwoFactorExpiresAt: null,
      // Auto-provisioned users always land as operators with no group
      // memberships — that means zero permissions and zero site access
      // ("guest read-only" by default). An admin promotes them by
      // assigning groups via /users. The configured `defaultRole` is
      // ignored here; previously it could be set to "admin" with a
      // domain-allowlist guard, but that left a foot-gun where a
      // misconfigured allowlist auto-created admins. Now the only path
      // to admin is admin-side group assignment.
      role: "operator",
      twoFactorRecoveryCodeHashes: [],
      twoFactorSecret: null,
      twoFactorUpdatedAt: null,
      updatedAt: timestamp,
      ssoProviderId: input.providerId,
      ssoSubject: input.subject,
    };
    store.users.push(newUser);
    provisioned = true;
    return newUser;
  });

  await createSession(user.id);
  return { provisioned, user };
}

export type LdapSignInInput = {
  /** Distinguished name returned by the directory search. Stable. */
  dn: string;
  /** Canonical email pulled from the LDAP `mail` attribute. */
  email: string;
  /** Display name from the directory; falls back to email. */
  name: string;
  /** Whether to auto-create a Tainer user if no match is found. */
  autoProvision: boolean;
  /** Role assigned to a newly-provisioned user. Ignored if user already exists. */
  defaultRole: AuthRole;
};

export type LdapSignInResult = {
  /** True if a brand-new Tainer user was just created. */
  provisioned: boolean;
  user: StoredUser;
};

/**
 * Sign a user in using credentials already verified by an LDAP directory.
 *
 * Trust boundary (mirrors `signInWithSso`): the directory is allowed to
 * assert *its own* users — it is not allowed to take over Tainer users
 * that already have local credentials. Specifically:
 *
 *   - We match by stored `ldapDN` first (stable across email changes).
 *   - We fall back to email match ONLY when the existing user is
 *     adoptable: no local password, no 2FA enrolled, no SSO link, and
 *     no different LDAP DN already attached. Otherwise an attacker who
 *     gets credentials at the corporate directory could bypass a Tainer
 *     user's locally-set password and 2FA. The remediation in that case
 *     is for an admin to remove the local credential or pre-link the
 *     LDAP DN.
 *
 * Note that 2FA is enforced indirectly: if a user has it enrolled, LDAP
 * cannot adopt that account without admin action — the local 2FA challenge
 * is what authorises the link.
 */
export async function signInWithLdap(
  input: LdapSignInInput,
): Promise<LdapSignInResult> {
  const email = normalizeEmail(input.email);
  if (!email) throw new Error("LDAP returned an empty email — refusing to sign in.");
  const name = input.name.trim() || email;

  let provisioned = false;
  const user = await mutateAuthStore((store) => {
    // 1. Match by stored DN — survives email changes and is the only
    //    path that can adopt an existing record without further checks.
    let existing = store.users.find((u) => u.ldapDN && u.ldapDN === input.dn);

    // 2. Fall back to email match — only for users safe to auto-link.
    if (!existing) {
      const candidate = store.users.find((u) => u.email === email);
      if (candidate) {
        const hasLocalPassword = Boolean(candidate.passwordHash);
        const hasTwoFactor = Boolean(candidate.twoFactorSecret);
        const linkedToSso = Boolean(candidate.ssoProviderId || candidate.ssoSubject);
        const linkedToDifferentDn = Boolean(
          candidate.ldapDN && candidate.ldapDN !== input.dn,
        );

        if (hasLocalPassword || hasTwoFactor || linkedToSso || linkedToDifferentDn) {
          throw new Error(
            "An account with this email already exists in Tainer with " +
              "different credentials. Ask an administrator to link your " +
              "directory account before signing in this way.",
          );
        }

        existing = candidate;
      }
    }

    if (existing) {
      const timestamp = nowIso();
      existing.ldapDN = input.dn;
      // Refresh display name — directories are usually the source of truth.
      if (name && name !== existing.name) existing.name = name;
      existing.updatedAt = timestamp;
      return existing;
    }

    if (!input.autoProvision) {
      throw new Error(
        "Your account isn't set up in Tainer yet. Ask an administrator to add you, then try signing in again.",
      );
    }

    const timestamp = nowIso();
    const newUser: StoredUser = {
      createdAt: timestamp,
      email,
      groupIds: [],
      id: randomUUID(),
      name,
      passwordHash: "", // LDAP-provisioned, no local password
      passwordUpdatedAt: timestamp,
      pendingTwoFactorSecret: null,
      pendingTwoFactorExpiresAt: null,
      // See signInWithSso for the same reasoning: auto-provisioned
      // users always land as operators with no groups (zero
      // permissions, zero site access). Promotion happens via /users.
      role: "operator",
      twoFactorRecoveryCodeHashes: [],
      twoFactorSecret: null,
      twoFactorUpdatedAt: null,
      updatedAt: timestamp,
      ldapDN: input.dn,
    };
    store.users.push(newUser);
    provisioned = true;
    return newUser;
  });

  return { provisioned, user };
}

// No cookie is set; caller wraps the returned session ID in a JWT via generateMobileToken().
export async function createSessionForMobile(userId: string): Promise<string> {
  const expiresAt = addDays(new Date(), SESSION_TTL_DAYS).toISOString();
  const sessionId = randomBytes(32).toString("base64url");
  const timestamp = nowIso();

  await mutateAuthStore((store) => {
    store.sessions.push({
      createdAt: timestamp,
      expiresAt,
      id: sessionId,
      lastSeenAt: timestamp,
      revokedAt: null,
      source: "mobile",
      userId,
    });
  });

  return sessionId;
}

export async function getSessionById(sessionId: string): Promise<AuthSession | null> {
  const { ensureUserGroupsMigrated } = await import("@/lib/user-groups");
  await ensureUserGroupsMigrated();

  const store = await readAuthStore();
  const session = store.sessions.find(
    (entry) =>
      entry.id === sessionId &&
      !entry.revokedAt &&
      new Date(entry.expiresAt).getTime() > Date.now(),
  );

  if (!session) {
    return null;
  }

  const user = store.users.find((entry) => entry.id === session.userId);

  if (!user) {
    return null;
  }

  if (Date.now() - new Date(session.lastSeenAt).getTime() >= SESSION_LAST_SEEN_UPDATE_MS) {
    const refreshedAt = nowIso();

    await mutateAuthStore((nextStore) => {
      const nextSession = nextStore.sessions.find(
        (entry) =>
          entry.id === session.id &&
          !entry.revokedAt &&
          new Date(entry.expiresAt).getTime() > Date.now(),
      );

      if (nextSession) {
        nextSession.lastSeenAt = refreshedAt;
      }
    });
  }

  return {
    expiresAt: session.expiresAt,
    id: session.id,
    user: await sanitizeUser(user),
  };
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  await mutateAuthStore((store) => {
    const session = store.sessions.find((entry) => entry.id === sessionId);

    if (session) {
      session.revokedAt = nowIso();
    }
  });
}

export async function updateProfile(input: { name: string }) {
  const session = await requireSession();
  const name = input.name.trim();

  if (!name) {
    throw new Error("Name is required.");
  }

  await mutateAuthStore((store) => {
    const user = store.users.find((entry) => entry.id === session.user.id);

    if (!user) {
      throw new Error("User account could not be found.");
    }

    user.name = name;
    user.updatedAt = nowIso();
  });
}

function summarizeManagedUser(user: StoredUser, store: AuthStore): ManagedUserSummary {
  const now = Date.now();
  const sessions = store.sessions.filter(
    (entry) =>
      entry.userId === user.id &&
      !entry.revokedAt &&
      new Date(entry.expiresAt).getTime() > now,
  );
  const latestSession = [...sessions].sort((left, right) =>
    right.lastSeenAt.localeCompare(left.lastSeenAt),
  )[0];

  return {
    activeSessionCount: sessions.length,
    createdAt: user.createdAt,
    email: user.email,
    groupIds: user.groupIds ?? [],
    hasTwoFactor: Boolean(user.twoFactorSecret),
    id: user.id,
    lastSeenAt: latestSession?.lastSeenAt ?? null,
    name: user.name,
    permissions: user.permissions ?? [],
    role: user.role,
    updatedAt: user.updatedAt,
  };
}

export async function listManagedUsers() {
  const session = await requireSession();
  requirePermission(session, "manage-users");
  const store = await readAuthStore();

  return [...store.users]
    .sort((left, right) => left.email.localeCompare(right.email))
    .map((user) => summarizeManagedUser(user, store));
}

/**
 * Clear every login-lockout bucket associated with a user.
 *
 * Login attempts are tracked under keys that are either `email` (no client
 * IP available) or `email:{ip}` (when proxy headers are trusted). An admin
 * unlocking a user from the GUI doesn't know the offending IP set, so we
 * wipe every bucket whose key starts with their email — covering all
 * IP variants in one shot.
 *
 * Returns the number of buckets removed; 0 means there was nothing to clear.
 */
export async function clearLoginLockoutsForUser(userId: string): Promise<number> {
  const session = await requireSession();
  requirePermission(session, "manage-users");

  const store = await readAuthStore();
  const target = store.users.find((entry) => entry.id === userId);
  if (!target) {
    throw new Error("User not found.");
  }
  await requireAdminToManageUser(session, target);

  const emailPrefix = `${target.email}:`;
  return mutateAuthSecurityState((state) => {
    pruneAuthSecurityState(state);
    let removed = 0;
    for (const key of Object.keys(state.loginAttempts)) {
      if (key === target.email || key.startsWith(emailPrefix)) {
        delete state.loginAttempts[key];
        removed += 1;
      }
    }
    return removed;
  });
}

export async function createUserAsAdmin(input: {
  email: string;
  groupIds?: string[];
  name: string;
  password: string;
  role: AuthRole;
}) {
  const session = await requireSession();
  requirePermission(session, "manage-users");

  const email = normalizeEmail(input.email);
  const name = input.name.trim();

  if (!email || !name) {
    throw new Error("Name and email are required.");
  }

  if (!isValidEmail(email)) {
    throw new Error("Enter a valid email address.");
  }

  let effectiveRole = input.role;
  const groupIds = input.groupIds ?? [];
  if (groupIds.length > 0) {
    const { getUserGroupsByIds } = await import("@/lib/user-groups");
    const groups = await getUserGroupsByIds(groupIds);
    effectiveRole = groups.some((g) => g.isAdmin) ? "admin" : "operator";
    if (!groups.every((g) => canGrantGroup(session, g))) {
      throw new Error("You cannot assign groups with permissions you do not have.");
    }
  }

  if (effectiveRole === "admin" && session.user.role !== "admin") {
    throw new Error("Only admins can create admin users.");
  }

  return mutateAuthStore(async (store) => {
    if (store.users.some((entry) => entry.email === email)) {
      throw new Error("A user with that email already exists.");
    }

    const timestamp = nowIso();
    const user: StoredUser = {
      createdAt: timestamp,
      email,
      groupIds,
      id: randomUUID(),
      name,
      passwordHash: await hashPassword(input.password),
      passwordUpdatedAt: timestamp,
      pendingTwoFactorSecret: null,
      pendingTwoFactorExpiresAt: null,
      role: effectiveRole,
      twoFactorRecoveryCodeHashes: [],
      twoFactorSecret: null,
      twoFactorUpdatedAt: null,
      updatedAt: timestamp,
    };

    store.users.push(user);

    return summarizeManagedUser(user, store);
  });
}

export async function changePassword(input: {
  currentPassword: string;
  nextPassword: string;
}) {
  const session = await requireSession();

  await mutateAuthStore(async (store) => {
    const user = store.users.find((entry) => entry.id === session.user.id);

    if (!user) {
      throw new Error("User account could not be found.");
    }

    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new Error("Current password is incorrect.");
    }

    const timestamp = nowIso();
    user.passwordHash = await hashPassword(input.nextPassword);
    user.passwordUpdatedAt = timestamp;
    user.updatedAt = timestamp;

    store.sessions = store.sessions.map((entry) =>
      entry.userId === user.id && entry.id !== session.id
        ? {
            ...entry,
            revokedAt: timestamp,
          }
        : entry,
    );
  });
}

export async function adminSetUserPassword(targetUserId: string, nextPassword: string) {
  const session = await requireSession();
  requirePermission(session, "manage-users");

  await mutateAuthStore(async (store) => {
    const user = store.users.find((entry) => entry.id === targetUserId);

    if (!user) {
      throw new Error("User account could not be found.");
    }
    await requireAdminToManageUser(session, user);

    const timestamp = nowIso();
    user.passwordHash = await hashPassword(nextPassword);
    user.passwordUpdatedAt = timestamp;
    user.updatedAt = timestamp;

    store.sessions = store.sessions.map((entry) =>
      entry.userId === user.id
        ? { ...entry, revokedAt: timestamp }
        : entry,
    );
  });
}

export async function beginTwoFactorEnrollment() {
  const session = await requireSession();
  const store = await readAuthStore();
  const user = store.users.find((entry) => entry.id === session.user.id);

  if (!user) {
    throw new Error("User account could not be found.");
  }

  const secret = generateRandomBase32Secret();
  const encryptedSecret = await encryptText(secret);

  await mutateAuthStore((nextStore) => {
    const nextUser = nextStore.users.find((entry) => entry.id === session.user.id);

    if (!nextUser) {
      throw new Error("User account could not be found.");
    }

    nextUser.pendingTwoFactorSecret = encryptedSecret;
    nextUser.pendingTwoFactorExpiresAt = addMinutes(new Date(), 10).toISOString();
    nextUser.updatedAt = nowIso();
  });

  const otpauthUrl = buildOtpAuthUrl(user, secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
    margin: 1,
    width: 220,
  });

  return {
    manualEntryKey: secret,
    otpauthUrl,
    qrCodeDataUrl,
  } satisfies TwoFactorSetup;
}

export async function confirmTwoFactorEnrollment(code: string) {
  const session = await requireSession();
  const recoveryCodes = generateRecoveryCodes();
  const recoveryHashes = recoveryCodes.map((entry) =>
    hashOpaqueValue(normalizeRecoveryCode(entry)),
  );

  await mutateAuthStore(async (store) => {
    const user = store.users.find((entry) => entry.id === session.user.id);

    if (!user || !user.pendingTwoFactorSecret) {
      throw new Error("Start two-factor setup before confirming it.");
    }

    if (user.pendingTwoFactorExpiresAt && new Date(user.pendingTwoFactorExpiresAt).getTime() <= Date.now()) {
      user.pendingTwoFactorSecret = null;
      user.pendingTwoFactorExpiresAt = null;
      throw new Error("Two-factor setup has expired. Please start again.");
    }

    const secret = await decryptText(user.pendingTwoFactorSecret);

    if (!verifyTotp(secret, code)) {
      throw new Error("Authenticator code is invalid.");
    }

    if (!(await reserveTotpCode(session.user.id, code))) {
      throw new Error("This code has already been used. Wait for a new code.");
    }

    const timestamp = nowIso();
    user.pendingTwoFactorSecret = null;
    user.pendingTwoFactorExpiresAt = null;
    user.twoFactorRecoveryCodeHashes = recoveryHashes;
    user.twoFactorSecret = await encryptText(secret);
    user.twoFactorUpdatedAt = timestamp;
    user.updatedAt = timestamp;
  });

  return recoveryCodes;
}

export async function disableTwoFactor(input: { currentPassword: string }) {
  const session = await requireSession();

  await mutateAuthStore(async (store) => {
    const user = store.users.find((entry) => entry.id === session.user.id);

    if (!user) {
      throw new Error("User account could not be found.");
    }

    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new Error("Current password is incorrect.");
    }

    const timestamp = nowIso();
    user.pendingTwoFactorSecret = null;
    user.pendingTwoFactorExpiresAt = null;
    user.twoFactorRecoveryCodeHashes = [];
    user.twoFactorSecret = null;
    user.twoFactorUpdatedAt = timestamp;
    user.updatedAt = timestamp;
  });

  await clearGuestShellStepUpCookie();
}

export async function createPasswordReset(email: string, origin: string) {
  const normalizedEmail = normalizeEmail(email);
  await checkResetRateLimit(normalizedEmail);

  if (!normalizedEmail) {
    throw new Error("Enter the email address for your account.");
  }

  const resetToken = randomBytes(32).toString("base64url");
  const tokenHash = hashOpaqueValue(resetToken);
  const expiresAt = addMinutes(new Date(), PASSWORD_RESET_TTL_MINUTES).toISOString();

  let targetUserEmail = "";
  let targetUserName = "";

  await mutateAuthStore((store) => {
    const user = store.users.find((entry) => entry.email === normalizedEmail);

    if (!user) {
      return;
    }

    targetUserEmail = user.email;
    targetUserName = user.name;
    store.passwordResets.push({
      createdAt: nowIso(),
      expiresAt,
      id: randomUUID(),
      tokenHash,
      usedAt: null,
      userId: user.id,
    });
  });

  if (!targetUserEmail) {
    // Perform a dummy scrypt hash to equalize response timing regardless of
    // whether the user exists, preventing user-enumeration via timing attacks.
    await scrypt("dummy", randomBytes(16), 64, SCRYPT_PARAMS);
    return {
      delivery: "unavailable" as const,
    };
  }

  const link = `${origin.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(resetToken)}`;
  const sent = await sendPasswordResetEmail(targetUserEmail, targetUserName, link);

  return {
    delivery: sent ? ("email" as const) : ("file" as const),
  };
}

export async function validatePasswordResetToken(token: string) {
  const tokenHash = hashOpaqueValue(token.trim());
  const store = await readAuthStore();
  const reset = store.passwordResets.find(
    (entry) =>
      timingSafeHashEqual(entry.tokenHash, tokenHash) &&
      !entry.usedAt &&
      new Date(entry.expiresAt).getTime() > Date.now(),
  );

  if (!reset) {
    return null;
  }

  const user = store.users.find((entry) => entry.id === reset.userId);

  if (!user) {
    return null;
  }

  return sanitizeUser(user);
}

export async function resetPasswordWithToken(token: string, nextPassword: string) {
  const tokenHash = hashOpaqueValue(token.trim());

  await mutateAuthStore(async (store) => {
    const reset = store.passwordResets.find(
      (entry) =>
        timingSafeHashEqual(entry.tokenHash, tokenHash) &&
        !entry.usedAt &&
        new Date(entry.expiresAt).getTime() > Date.now(),
    );

    if (!reset) {
      throw new Error("This password reset link is invalid or expired.");
    }

    const user = store.users.find((entry) => entry.id === reset.userId);

    if (!user) {
      throw new Error("User account could not be found.");
    }

    const timestamp = nowIso();
    const had2fa = !!user.twoFactorSecret;
    user.passwordHash = await hashPassword(nextPassword);
    user.passwordUpdatedAt = timestamp;
    user.updatedAt = timestamp;

    // Revoke 2FA on password reset to prevent bypass attacks. Users who
    // had 2FA enabled must re-enroll after resetting their password.
    if (had2fa) {
      user.pendingTwoFactorSecret = null;
      user.twoFactorRecoveryCodeHashes = [];
      user.twoFactorSecret = null;
      user.twoFactorUpdatedAt = timestamp;
      console.warn(
        `[auth] Password reset completed for user ${user.email} who had 2FA enabled. ` +
        `2FA has been revoked — user must re-enroll. All sessions revoked.`,
      );
    }

    reset.usedAt = timestamp;
    store.sessions = store.sessions.map((entry) =>
      entry.userId === user.id
        ? {
            ...entry,
            revokedAt: timestamp,
          }
        : entry,
    );
  });

  await clearSessionCookie();
  await clearLoginChallengeCookie();
  await clearGuestShellStepUpCookie();
}

export async function getAccountSettings() {
  const session = await requireSession();
  const store = await readAuthStore();
  const user = store.users.find((entry) => entry.id === session.user.id);

  if (!user) {
    throw new Error("User account could not be found.");
  }

  return {
    createdAt: user.createdAt,
    email: user.email,
    hasLocalPassword: Boolean(user.passwordHash),
    hasTwoFactor: Boolean(user.twoFactorSecret),
    id: user.id,
    name: user.name,
    role: user.role,
    ssoProviderId: user.ssoProviderId ?? null,
    ssoSubject: user.ssoSubject ?? null,
    twoFactorUpdatedAt: user.twoFactorUpdatedAt,
  };
}

/**
 * Clear the current user's local password (set passwordHash = ""). Refuses
 * if no SSO link is set, otherwise the user would be locked out. Revokes
 * all OTHER active sessions for safety — anyone who learned the password
 * before now no longer has access; the current device stays signed in.
 */
export async function disableLocalPassword(): Promise<void> {
  const session = await requireSession();
  const timestamp = nowIso();

  await mutateAuthStore((store) => {
    const user = store.users.find((entry) => entry.id === session.user.id);
    if (!user) {
      throw new Error("User account could not be found.");
    }
    if (!user.passwordHash) {
      // Already disabled — nothing to do.
      return;
    }
    if (!user.ssoProviderId || !user.ssoSubject) {
      throw new Error(
        "Link an SSO provider before disabling your local password — without one, you would be locked out.",
      );
    }
    user.passwordHash = "";
    user.passwordUpdatedAt = timestamp;
    user.updatedAt = timestamp;
    // Revoke every session for this user EXCEPT the active one, so anyone who
    // had the password (including the user themselves on other devices) needs
    // to re-auth via SSO.
    for (const s of store.sessions) {
      if (s.userId !== user.id) continue;
      if (s.id === session.id) continue;
      if (s.revokedAt) continue;
      s.revokedAt = timestamp;
    }
  });
}

export async function verifyGuestShellStepUp(code: string) {
  const session = await requireSession();
  const store = await readAuthStore();
  const user = store.users.find((entry) => entry.id === session.user.id);

  if (!user || !user.twoFactorSecret) {
    throw new Error("Enable 2FA before opening in-app SSH sessions.");
  }

  await checkTotpRateLimit(user.id);

  const secret = await decryptText(user.twoFactorSecret);
  const normalizedRecoveryCode = normalizeRecoveryCode(code);
  const normalizedTotpCode = normalizeTotpCode(code);
  const isTotp = verifyTotp(secret, normalizedTotpCode);

  if (!isTotp) {
    const recoveryHash = hashOpaqueValue(normalizedRecoveryCode);
    const consumed = await mutateAuthStore((nextStore) => {
      const nextUser = nextStore.users.find((entry) => entry.id === user.id);

      if (!nextUser) {
        throw new Error("Two-factor authentication is not available for this account.");
      }

      const recoveryIndex = nextUser.twoFactorRecoveryCodeHashes.findIndex(
        (entry) => timingSafeHashEqual(entry, recoveryHash),
      );

      if (recoveryIndex === -1) {
        return false;
      }

      nextUser.twoFactorRecoveryCodeHashes.splice(recoveryIndex, 1);
      nextUser.updatedAt = nowIso();
      return true;
    });

    if (!consumed) {
      throw new Error("Invalid authenticator code or recovery code.");
    }
  } else if (!(await reserveTotpCode(user.id, normalizedTotpCode))) {
    throw new Error("This code has already been used. Wait for a new code.");
  }

  const verifiedAt = nowIso();
  await clearTotpRateLimit(user.id);
  await setGuestShellStepUpCookie({
    expiresAt: addMinutes(new Date(), SSH_STEP_UP_TTL_MINUTES).toISOString(),
    sessionId: session.id,
    userId: session.user.id,
    verifiedAt,
  });

  return {
    expiresAt: addMinutes(new Date(verifiedAt), SSH_STEP_UP_TTL_MINUTES).toISOString(),
    verifiedAt,
  };
}

export async function hasFreshGuestShellStepUp() {
  const session = await requireSession();
  const stepUp = await readGuestShellStepUpCookie();

  if (!stepUp) {
    return false;
  }

  return stepUp.sessionId === session.id && stepUp.userId === session.user.id;
}

export type SessionSummary = {
  createdAt: string;
  expiresAt: string;
  id: string;
  isCurrent: boolean;
  lastSeenAt: string;
};

export async function listCurrentUserSessions(): Promise<SessionSummary[]> {
  const session = await requireSession();
  const store = await readAuthStore();
  const now = Date.now();

  return store.sessions
    .filter(
      (entry) =>
        entry.userId === session.user.id &&
        !entry.revokedAt &&
        new Date(entry.expiresAt).getTime() > now,
    )
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .map((entry) => ({
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      id: entry.id,
      isCurrent: entry.id === session.id,
      lastSeenAt: entry.lastSeenAt,
    }));
}

export async function revokeSession(targetSessionId: string) {
  const session = await requireSession();

  if (targetSessionId === session.id) {
    throw new Error("Cannot revoke the current session. Use sign out instead.");
  }

  await mutateAuthStore((store) => {
    const target = store.sessions.find(
      (entry) =>
        entry.id === targetSessionId &&
        entry.userId === session.user.id &&
        !entry.revokedAt,
    );

    if (!target) {
      throw new Error("Session not found or already revoked.");
    }

    target.revokedAt = nowIso();
  });
}

export async function revokeAllOtherSessions() {
  const session = await requireSession();

  await mutateAuthStore((store) => {
    const timestamp = nowIso();
    for (const entry of store.sessions) {
      if (
        entry.userId === session.user.id &&
        entry.id !== session.id &&
        !entry.revokedAt
      ) {
        entry.revokedAt = timestamp;
      }
    }
  });
}

export async function getAuthDebugPaths() {
  return {
    authStorePath: await resolveDataFilePath("auth-store.json"),
    passwordResetDebugPath: "stderr (Tainer container logs)",
  };
}
