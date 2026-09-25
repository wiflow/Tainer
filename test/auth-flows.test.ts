import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import fc from "fast-check";

import {
  ALL_PERMISSIONS,
  completeMobileTwoFactorLogin,
  getSessionById,
  signInWithLdap,
  signInWithSso,
  type SsoSignInInput,
} from "@/lib/auth";
import { encryptText } from "@/lib/crypto";
import { ensureUserGroupsMigrated } from "@/lib/user-groups";

process.env.AUTH_SECRET = "auth-flow-test-secret";

type TestUser = Record<string, unknown> & { id: string };
type TestSession = Record<string, unknown> & { id: string };
type TestStore = { passwordResets: unknown[]; sessions: TestSession[]; users: TestUser[] };

const USER_KEYS = [
  "createdAt",
  "email",
  "groupIds",
  "id",
  "name",
  "passwordHash",
  "passwordUpdatedAt",
  "pendingTwoFactorSecret",
  "pendingTwoFactorExpiresAt",
  "role",
  "twoFactorRecoveryCodeHashes",
  "twoFactorSecret",
  "twoFactorUpdatedAt",
  "updatedAt",
];
const OLD = "2020-01-01T00:00:00.000Z";
const CHALLENGE_USED = "This login challenge has already been used.";
const CODE_USED = "This code has already been used. Wait for a new code.";
const INVALID = "Invalid authenticator code or recovery code.";
const RATE_LIMITED = "Too many verification attempts. Try again in a few minutes.";
const UNAVAILABLE = "Two-factor authentication is not available for this account.";
const SESSION_EXPIRED = "Your login session expired. Enter email and password again.";
const NOT_SET_UP = "Your account isn't set up in Tainer yet. Ask an administrator to add you, then try signing in again.";
const NO_REQUEST_SCOPE = "No request scope in tests.";

const dataDirs: string[] = [];

async function seedFreshStore(store: Partial<TestStore> = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "tainer-auth-test-"));
  dataDirs.push(dir);
  process.env.TAINER_DATA_DIR = dir;
  const full: TestStore = { passwordResets: [], sessions: [], users: [], ...store };
  await writeFile(path.join(dir, "auth-store.json"), JSON.stringify(full));
}

async function readStore(): Promise<TestStore> {
  return JSON.parse(await readFile(path.join(process.env.TAINER_DATA_DIR!, "auth-store.json"), "utf8"));
}

async function storedUser(id: string) {
  const user = (await readStore()).users.find((entry) => entry.id === id);
  assert.ok(user);
  return user;
}

function makeUser(overrides: Record<string, unknown> = {}): TestUser {
  return {
    createdAt: OLD,
    email: `${randomUUID()}@example.com`,
    groupIds: [],
    id: randomUUID(),
    name: "Existing Name",
    passwordHash: "",
    passwordUpdatedAt: OLD,
    pendingTwoFactorSecret: null,
    pendingTwoFactorExpiresAt: null,
    role: "operator",
    twoFactorRecoveryCodeHashes: [],
    twoFactorSecret: null,
    twoFactorUpdatedAt: null,
    updatedAt: OLD,
    ...overrides,
  };
}

function base32Secret() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  return Array.from(randomBytes(32), (byte) => alphabet[byte & 31]).join("");
}

function totp(secret: string, timestamp: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timestamp / 30_000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function recoveryCode() {
  return Array.from({ length: 4 }, () => randomBytes(4).toString("hex").toUpperCase()).join("-");
}

function recoveryHash(code: string) {
  return createHash("sha256").update(code.replace(/[^a-z0-9]/gi, "").toUpperCase()).digest("hex");
}

async function twoFactorUser(recoveryCodes: string[] = []) {
  const secret = base32Secret();
  const user = makeUser({
    twoFactorRecoveryCodeHashes: recoveryCodes.map(recoveryHash),
    twoFactorSecret: await encryptText(secret),
    twoFactorUpdatedAt: OLD,
  });
  return { secret, user };
}

async function challengeToken(userId: string, expiresInMs = 10 * 60_000) {
  return encryptText(
    JSON.stringify({
      expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
      nonce: randomBytes(16).toString("base64url"),
      userId,
    }),
  );
}

function reformat(code: string, flips: boolean[], separators: string[]) {
  return [...code.replace(/-/g, "")]
    .map((character, i) => {
      const cased = flips[i % flips.length] ? character.toLowerCase() : character;
      return `${separators[i % separators.length]}${cased}`;
    })
    .join("");
}

before(async () => {
  await seedFreshStore();
  await ensureUserGroupsMigrated();
});

after(async () => {
  await Promise.all(dataDirs.map((dir) => rm(dir, { force: true, recursive: true })));
});

test("mobile 2FA accepts each TOTP code once and each challenge once", async () => {
  const recovery = recoveryCode();
  const { secret, user } = await twoFactorUser([recovery]);
  await seedFreshStore({ users: [user] });
  const now = Date.now();
  const current = totp(secret, now);
  const next = totp(secret, now + 30_000);

  const tokenA = await challengeToken(user.id);
  const result = await completeMobileTwoFactorLogin(tokenA, `${current.slice(0, 3)} ${current.slice(3)}`);
  assert.equal(result.user.id, user.id);
  assert.equal(result.user.hasTwoFactor, true);
  assert.deepEqual(result.user.permissions, []);
  const session = (await readStore()).sessions.find((entry) => entry.id === result.sessionId);
  assert.ok(session);
  assert.equal(session.userId, user.id);
  assert.equal(session.source, "mobile");
  assert.equal(session.revokedAt, null);

  await assert.rejects(completeMobileTwoFactorLogin(tokenA, next), { message: CHALLENGE_USED });
  await assert.rejects(completeMobileTwoFactorLogin(await challengeToken(user.id), current), { message: CODE_USED });
  const second = await completeMobileTwoFactorLogin(await challengeToken(user.id), next);
  assert.notEqual(second.sessionId, result.sessionId);

  const stored = await storedUser(user.id);
  assert.deepEqual(stored.twoFactorRecoveryCodeHashes, [recoveryHash(recovery)]);
  assert.equal(stored.updatedAt, OLD);
  assert.equal((await readStore()).sessions.length, 2);
});

test("mobile 2FA consumes a recovery code once and burns the challenge on failure", async () => {
  const codes = [recoveryCode(), recoveryCode()];
  const { user } = await twoFactorUser(codes);
  await seedFreshStore({ users: [user] });

  const tokenA = await challengeToken(user.id);
  const result = await completeMobileTwoFactorLogin(tokenA, codes[0].toLowerCase().replace(/-/g, " "));
  assert.equal(result.user.id, user.id);
  let stored = await storedUser(user.id);
  assert.deepEqual(stored.twoFactorRecoveryCodeHashes, [recoveryHash(codes[1])]);
  assert.notEqual(stored.updatedAt, OLD);

  await assert.rejects(completeMobileTwoFactorLogin(tokenA, codes[1]), { message: CHALLENGE_USED });
  const tokenB = await challengeToken(user.id);
  await assert.rejects(completeMobileTwoFactorLogin(tokenB, codes[0]), { message: INVALID });
  await assert.rejects(completeMobileTwoFactorLogin(tokenB, codes[1]), { message: CHALLENGE_USED });
  await assert.rejects(completeMobileTwoFactorLogin(await challengeToken(user.id), codes[1]), { message: RATE_LIMITED });

  stored = await storedUser(user.id);
  assert.deepEqual(stored.twoFactorRecoveryCodeHashes, [recoveryHash(codes[1])]);
  assert.equal((await readStore()).sessions.length, 1);
});

test("mobile 2FA rejects expired, forged and unusable challenges", async () => {
  const { secret, user } = await twoFactorUser();
  const plain = makeUser();
  await seedFreshStore({ users: [user, plain] });
  const code = totp(secret, Date.now());

  await assert.rejects(completeMobileTwoFactorLogin("not-a-token", code), { message: SESSION_EXPIRED });
  await assert.rejects(completeMobileTwoFactorLogin(await challengeToken(user.id, -1), code), { message: SESSION_EXPIRED });
  await assert.rejects(completeMobileTwoFactorLogin(await challengeToken(plain.id), code), { message: UNAVAILABLE });

  const ghost = randomUUID();
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(completeMobileTwoFactorLogin(await challengeToken(ghost), code), { message: UNAVAILABLE });
  }
  await assert.rejects(completeMobileTwoFactorLogin(await challengeToken(ghost), code), { message: RATE_LIMITED });

  const result = await completeMobileTwoFactorLogin(await challengeToken(user.id), code);
  assert.equal(result.user.id, user.id);
});

test("mobile 2FA accepts any formatting of a recovery code exactly once", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.nat(2),
      fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
      fc.array(fc.constantFrom("", "", "-", " ", "\t", "_", "."), { minLength: 1, maxLength: 8 }),
      async (index, flips, separators) => {
        const codes = [recoveryCode(), recoveryCode(), recoveryCode()];
        const { user } = await twoFactorUser(codes);
        await seedFreshStore({ users: [user] });
        const input = reformat(codes[index], flips, separators);

        await completeMobileTwoFactorLogin(await challengeToken(user.id), input);
        const remaining = codes.filter((_, i) => i !== index).map(recoveryHash);
        assert.deepEqual((await storedUser(user.id)).twoFactorRecoveryCodeHashes, remaining);

        await assert.rejects(completeMobileTwoFactorLogin(await challengeToken(user.id), input), { message: INVALID });
        assert.deepEqual((await storedUser(user.id)).twoFactorRecoveryCodeHashes, remaining);
      },
    ),
    { numRuns: 20 },
  );
});

test("mobile 2FA rejects arbitrary input without touching recovery codes", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string({ unit: "binary", maxLength: 40 }), async (input) => {
      fc.pre(!/^\d{6}$/.test(input.replace(/\s+/g, "")));
      const codes = [recoveryCode()];
      const { user } = await twoFactorUser(codes);
      await seedFreshStore({ users: [user] });

      await assert.rejects(completeMobileTwoFactorLogin(await challengeToken(user.id), input), { message: INVALID });
      const stored = await storedUser(user.id);
      assert.deepEqual(stored.twoFactorRecoveryCodeHashes, codes.map(recoveryHash));
      assert.equal(stored.updatedAt, OLD);
      assert.equal((await readStore()).sessions.length, 0);
    }),
    { numRuns: 20 },
  );
});

test("getSessionById returns live sessions and refreshes a stale lastSeenAt", async () => {
  const admin = makeUser({ role: "admin" });
  const operator = makeUser();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const recent = new Date(Date.now() - 60_000).toISOString();
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  const session = (id: string, userId: string, extra: Record<string, unknown> = {}): TestSession => ({
    createdAt: OLD,
    expiresAt: future,
    id,
    lastSeenAt: recent,
    revokedAt: null,
    source: "web",
    userId,
    ...extra,
  });
  await seedFreshStore({
    users: [admin, operator],
    sessions: [
      session("fresh", admin.id),
      session("stale", operator.id, { lastSeenAt: stale, source: "mobile" }),
      session("revoked", admin.id, { revokedAt: OLD }),
      session("expired", admin.id, { expiresAt: OLD }),
      session("orphan", randomUUID()),
    ],
  });

  const fresh = await getSessionById("fresh");
  assert.deepEqual(fresh, {
    expiresAt: future,
    id: "fresh",
    user: {
      accessibleSiteIds: [],
      email: admin.email,
      groupIds: [],
      hasTwoFactor: false,
      id: admin.id,
      name: admin.name,
      permissions: [...ALL_PERMISSIONS],
      role: "admin",
      sitePermissions: {},
    },
  });
  const initial = await readStore();
  assert.equal(initial.sessions.find((entry) => entry.id === "fresh")?.lastSeenAt, recent);
  assert.equal(initial.sessions.length, 5);

  for (const id of ["revoked", "expired", "orphan", "missing"]) {
    assert.equal(await getSessionById(id), null);
  }
  assert.equal((await readStore()).sessions.length, 5);

  const startedAt = Date.now();
  const refreshed = await getSessionById("stale");
  assert.equal(refreshed?.user.id, operator.id);
  assert.equal(refreshed?.user.role, "operator");
  assert.deepEqual(refreshed?.user.permissions, []);
  const updated = await readStore();
  const lastSeenAt = updated.sessions.find((entry) => entry.id === "stale")?.lastSeenAt as string;
  assert.ok(new Date(lastSeenAt).getTime() >= startedAt);
  assert.equal(updated.sessions.find((entry) => entry.id === "fresh")?.lastSeenAt, recent);
  assert.deepEqual(updated.sessions.map((entry) => entry.id).sort(), ["fresh", "orphan", "stale"]);
});

test("LDAP sign-in provisions a new user with a fixed shape", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string({ maxLength: 12 }), fc.boolean(), async (name, admin) => {
      await seedFreshStore();
      const dn = `uid=${randomUUID()},dc=example,dc=com`;
      const email = `${randomUUID()}@example.com`;
      const result = await signInWithLdap({
        autoProvision: true,
        defaultRole: admin ? "admin" : "operator",
        dn,
        email: `  ${email.toUpperCase()} `,
        name,
      });

      assert.equal(result.provisioned, true);
      assert.deepEqual(Object.keys(result.user), [...USER_KEYS, "ldapDN"]);
      assert.equal(result.user.email, email);
      assert.equal(result.user.name, name.trim() || email);
      assert.equal(result.user.role, "operator");
      assert.deepEqual(result.user.groupIds, []);
      assert.equal(result.user.passwordHash, "");
      assert.equal(result.user.twoFactorSecret, null);
      assert.equal(result.user.ldapDN, dn);
      assert.equal(result.user.createdAt, result.user.updatedAt);
      assert.equal(result.user.createdAt, result.user.passwordUpdatedAt);
      assert.deepEqual((await readStore()).users, [result.user]);
    }),
    { numRuns: 20 },
  );
});

test("LDAP sign-in updates a linked user and links a clean email match", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string({ maxLength: 12 }), async (name) => {
      const dn = `uid=${randomUUID()},dc=example,dc=com`;
      const linked = makeUser({ ldapDN: dn });
      const clean = makeUser();
      await seedFreshStore({ users: [linked, clean] });

      const first = await signInWithLdap({ autoProvision: false, defaultRole: "operator", dn, email: linked.email as string, name });
      assert.equal(first.provisioned, false);
      assert.equal(first.user.id, linked.id);
      assert.equal(first.user.name, name.trim() || linked.email);
      assert.notEqual(first.user.updatedAt, OLD);
      assert.deepEqual(await storedUser(linked.id), { ...linked, name: first.user.name, updatedAt: first.user.updatedAt });

      const cleanDn = `uid=${randomUUID()},dc=example,dc=com`;
      const second = await signInWithLdap({ autoProvision: false, defaultRole: "operator", dn: cleanDn, email: clean.email as string, name });
      assert.equal(second.provisioned, false);
      assert.equal(second.user.id, clean.id);
      const stored = await storedUser(clean.id);
      assert.deepEqual(Object.keys(stored), [...USER_KEYS, "ldapDN"]);
      assert.deepEqual(stored, { ...clean, ldapDN: cleanDn, name: second.user.name, updatedAt: second.user.updatedAt });
      assert.equal((await readStore()).users.length, 2);
    }),
    { numRuns: 15 },
  );
});

test("LDAP sign-in refuses conflicting accounts and missing provisioning", async () => {
  const email = "taken@example.com";
  const conflict =
    "An account with this email already exists in Tainer with different credentials. Ask an administrator to link your directory account before signing in this way.";
  const base = { autoProvision: true, defaultRole: "operator" as const, dn: "uid=new,dc=example,dc=com", email, name: "New" };

  for (const overrides of [
    { passwordHash: "scrypt:x:y" },
    { twoFactorSecret: "secret" },
    { ssoProviderId: "google" },
    { ssoSubject: "sub" },
    { ldapDN: "uid=other,dc=example,dc=com" },
  ]) {
    const user = makeUser({ email, ...overrides });
    await seedFreshStore({ users: [user] });
    await assert.rejects(signInWithLdap(base), { message: conflict });
    assert.deepEqual((await readStore()).users, [user]);
  }

  await seedFreshStore();
  await assert.rejects(signInWithLdap({ ...base, autoProvision: false }), { message: NOT_SET_UP });
  await assert.rejects(signInWithLdap({ ...base, email: "   " }), { message: "LDAP returned an empty email. Refusing to sign in." });
  assert.deepEqual((await readStore()).users, []);
});

function ssoInput(overrides: Partial<SsoSignInInput> = {}): SsoSignInInput {
  return {
    autoProvision: true,
    defaultRole: "operator",
    email: "person@example.com",
    emailVerified: true,
    name: "Person",
    providerId: "idp-1",
    providerName: "Example IdP",
    subject: "subject-1",
    ...overrides,
  };
}

test("SSO sign-in provisions a new user with a fixed shape before starting the session", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string({ maxLength: 12 }), async (name) => {
      await seedFreshStore();
      const email = `${randomUUID()}@example.com`;
      await assert.rejects(signInWithSso(ssoInput({ defaultRole: "admin", email: ` ${email.toUpperCase()}`, name })), {
        message: NO_REQUEST_SCOPE,
      });

      const store = await readStore();
      assert.equal(store.users.length, 1);
      const [user] = store.users;
      assert.deepEqual(Object.keys(user), [...USER_KEYS, "ssoProviderId", "ssoSubject"]);
      assert.equal(user.email, email);
      assert.equal(user.name, name.trim() || email);
      assert.equal(user.role, "operator");
      assert.deepEqual(user.groupIds, []);
      assert.equal(user.passwordHash, "");
      assert.equal(user.ssoProviderId, "idp-1");
      assert.equal(user.ssoSubject, "subject-1");
      assert.equal(user.createdAt, user.updatedAt);
      assert.equal(store.sessions.length, 1);
      assert.equal(store.sessions[0].userId, user.id);
      assert.equal(store.sessions[0].source, "web");
    }),
    { numRuns: 15 },
  );
});

test("SSO sign-in updates a linked user and links a clean email match", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string({ maxLength: 12 }), async (name) => {
      const linked = makeUser({ ssoProviderId: "idp-1", ssoSubject: "subject-1" });
      const linkedWithTwoFactor = makeUser({ ssoProviderId: "idp-1", ssoSubject: "subject-2", twoFactorSecret: "secret" });
      const clean = makeUser();
      await seedFreshStore({ users: [linked, linkedWithTwoFactor, clean] });

      await assert.rejects(signInWithSso(ssoInput({ autoProvision: false, email: linked.email as string, emailVerified: null, name })), {
        message: NO_REQUEST_SCOPE,
      });
      const first = await storedUser(linked.id);
      assert.notEqual(first.updatedAt, OLD);
      assert.deepEqual(first, { ...linked, name: name.trim() || linked.email, updatedAt: first.updatedAt });

      await assert.rejects(
        signInWithSso(ssoInput({ autoProvision: false, email: linkedWithTwoFactor.email as string, name, subject: "subject-2" })),
        { message: NO_REQUEST_SCOPE },
      );
      const second = await storedUser(linkedWithTwoFactor.id);
      assert.deepEqual(second, { ...linkedWithTwoFactor, name: name.trim() || linkedWithTwoFactor.email, updatedAt: second.updatedAt });

      await assert.rejects(
        signInWithSso(ssoInput({ autoProvision: false, email: clean.email as string, name, providerId: "idp-2", subject: "subject-3" })),
        { message: NO_REQUEST_SCOPE },
      );
      const third = await storedUser(clean.id);
      assert.deepEqual(Object.keys(third), [...USER_KEYS, "ssoProviderId", "ssoSubject"]);
      assert.deepEqual(third, {
        ...clean,
        name: name.trim() || clean.email,
        ssoProviderId: "idp-2",
        ssoSubject: "subject-3",
        updatedAt: third.updatedAt,
      });

      const store = await readStore();
      assert.equal(store.users.length, 3);
      assert.deepEqual(store.sessions.map((entry) => entry.userId), [linked.id, clean.id]);
    }),
    { numRuns: 15 },
  );
});

test("SSO sign-in refuses unverified email, conflicting accounts and missing provisioning", async () => {
  const email = "person@example.com";
  const conflict =
    "An account with this email already exists in Tainer with different credentials. Ask an administrator to link your identity provider before signing in this way.";

  await seedFreshStore();
  await assert.rejects(signInWithSso(ssoInput({ emailVerified: false })), {
    message: "Identity provider reported the email address is not verified. Sign-in refused.",
  });
  await assert.rejects(signInWithSso(ssoInput({ email: "  " })), { message: "Identity provider did not return a valid email." });
  await assert.rejects(signInWithSso(ssoInput({ emailVerified: null })), {
    message:
      'Example IdP did not confirm that person@example.com is verified, so it cannot be used to find or create a Tainer account. Ask an administrator to configure Example IdP to send email_verified, or to turn on "Trust email without email_verified claim" for it.',
  });
  await assert.rejects(signInWithSso(ssoInput({ autoProvision: false })), { message: NOT_SET_UP });
  assert.deepEqual(await readStore(), { passwordResets: [], sessions: [], users: [] });

  for (const overrides of [
    { passwordHash: "scrypt:x:y" },
    { twoFactorSecret: "secret" },
    { ssoProviderId: "idp-2" },
    { ssoSubject: "subject-2" },
    { ldapDN: "uid=person,dc=example,dc=com" },
  ]) {
    const user = makeUser({ email, ...overrides });
    await seedFreshStore({ users: [user] });
    await assert.rejects(signInWithSso(ssoInput()), { message: conflict });
    assert.deepEqual((await readStore()).users, [user]);
  }
});
