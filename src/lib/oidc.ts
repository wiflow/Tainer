import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import * as oidc from "openid-client";

import { getAuthSecret } from "@/lib/crypto";
import {
  getDecryptedClientSecret,
  type IdpProvider,
} from "@/lib/idp-providers";
import { trustProxyHeaders } from "@/lib/proxy-trust";

export function getPublicOrigin(headers: Headers, requestUrl?: string): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, "");

  if (trustProxyHeaders()) {
    const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    if ((proto === "http" || proto === "https") && host) return `${proto}://${host}`;
  }

  if (requestUrl) {
    try {
      const u = new URL(requestUrl);
      return `${u.protocol}//${u.host}`;
    } catch {
    }
  }

  throw new Error(
    "Cannot determine public origin. Set the APP_URL env var.",
  );
}

const RETURN_TO_BASE = "http://tainer.invalid";

export function sanitizeReturnTo(raw: string | null | undefined, fallback = "/"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, RETURN_TO_BASE);
    if (url.origin !== RETURN_TO_BASE || url.pathname.startsWith("//")) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

export const OIDC_FLOW_COOKIE = "tainer_oidc_flow";
const OIDC_FLOW_COOKIE_NAMESPACE = "oidc-flow:v1";
const OIDC_FLOW_TTL_MS = 5 * 60 * 1000;

export type OidcFlowState = {
  providerId: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  issuedAt: number;
};

async function signFlowCookie(state: OidcFlowState): Promise<string> {
  const secret = await getAuthSecret();
  const json = JSON.stringify(state);
  const payload = Buffer.from(json, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret)
    .update(`${OIDC_FLOW_COOKIE_NAMESPACE}:${payload}`)
    .digest("base64url");
  return `${payload}.${sig}`;
}

async function verifyFlowCookie(value: string): Promise<OidcFlowState | null> {
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const secret = await getAuthSecret();
  const expected = createHmac("sha256", secret)
    .update(`${OIDC_FLOW_COOKIE_NAMESPACE}:${payload}`)
    .digest();
  let received: Buffer;
  try {
    received = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (received.length !== expected.length) return null;
  if (!timingSafeEqual(expected, received)) return null;

  let parsed: OidcFlowState;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (Date.now() - parsed.issuedAt > OIDC_FLOW_TTL_MS) return null;
  return parsed;
}

export const oidcFlowCookieHelpers = {
  sign: signFlowCookie,
  verify: verifyFlowCookie,
  ttlMs: OIDC_FLOW_TTL_MS,
};

const discoveryCache = new Map<string, { config: oidc.Configuration; expiresAt: number }>();
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

async function getConfig(provider: IdpProvider): Promise<oidc.Configuration> {
  const cached = discoveryCache.get(provider.id);
  if (cached && cached.expiresAt > Date.now()) return cached.config;

  const clientSecret = await getDecryptedClientSecret(provider);
  const config = await oidc.discovery(
    new URL(provider.issuer),
    provider.clientId,
    undefined,
    oidc.ClientSecretPost(clientSecret),
  );
  discoveryCache.set(provider.id, {
    config,
    expiresAt: Date.now() + DISCOVERY_TTL_MS,
  });
  return config;
}

export function invalidateOidcDiscoveryCache(providerId?: string): void {
  if (providerId) {
    discoveryCache.delete(providerId);
  } else {
    discoveryCache.clear();
  }
}

export async function testOidcDiscovery(
  provider: IdpProvider,
): Promise<{ ok: true; authorizationEndpoint: string } | { ok: false; error: string }> {
  invalidateOidcDiscoveryCache(provider.id);
  try {
    const config = await getConfig(provider);
    const meta = config.serverMetadata();
    if (!meta.authorization_endpoint) {
      return { ok: false, error: "Discovery doc missing authorization_endpoint." };
    }
    return { ok: true, authorizationEndpoint: meta.authorization_endpoint };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function startOidcAuthorization(
  provider: IdpProvider,
  redirectUri: string,
  returnTo: string,
): Promise<{ url: URL; flowState: OidcFlowState }> {
  const config = await getConfig(provider);

  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return {
    url,
    flowState: {
      providerId: provider.id,
      state,
      nonce,
      codeVerifier,
      returnTo,
      issuedAt: Date.now(),
    },
  };
}

export type OidcUserClaims = {
  sub: string;
  email: string;
  emailVerified: boolean | null;
  name: string;
  groups: string[];
};

function parseEmailVerified(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export async function completeOidcAuthorization(
  provider: IdpProvider,
  flowState: OidcFlowState,
  callbackUrl: URL,
): Promise<OidcUserClaims> {
  if (flowState.providerId !== provider.id) {
    throw new Error("OIDC flow state does not match provider.");
  }

  const config = await getConfig(provider);

  const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
    expectedState: flowState.state,
    expectedNonce: flowState.nonce,
    pkceCodeVerifier: flowState.codeVerifier,
  });

  const claims = tokens.claims();
  if (!claims) {
    throw new Error("ID token did not contain claims.");
  }

  const sub = typeof claims.sub === "string" ? claims.sub : "";
  if (!sub) throw new Error("ID token has no subject claim.");

  // Entra often omits email claims; the fallbacks apply only when the provider opts in.
  const trustWithoutClaim = provider.trustEmailWithoutVerifiedClaim === true;
  let emailClaim: unknown = claims.email;
  let emailVerifiedClaim: unknown = (claims as Record<string, unknown>).email_verified;
  const needsUserInfo =
    typeof emailClaim !== "string" ||
    (parseEmailVerified(emailVerifiedClaim) === null && !trustWithoutClaim);
  if (needsUserInfo && tokens.access_token) {
    try {
      const info = await oidc.fetchUserInfo(config, tokens.access_token, sub);
      if (
        typeof info.email === "string" &&
        (typeof emailClaim !== "string" || info.email.toLowerCase() === emailClaim.toLowerCase())
      ) {
        emailClaim = info.email;
        emailVerifiedClaim = (info as Record<string, unknown>).email_verified;
      }
    } catch {}
  }
  const emailCandidates = [
    emailClaim,
    ...(trustWithoutClaim
      ? [
          (claims as Record<string, unknown>).preferred_username,
          (claims as Record<string, unknown>).upn,
        ]
      : []),
  ];
  let email = "";
  let fromEmailClaim = false;
  for (const [index, candidate] of emailCandidates.entries()) {
    if (typeof candidate === "string" && candidate.includes("@")) {
      email = candidate.toLowerCase();
      fromEmailClaim = index === 0;
      break;
    }
  }
  if (!email) {
    throw new Error(
      trustWithoutClaim
        ? "Identity provider did not return an email-like claim (checked email, preferred_username, upn)."
        : "Identity provider did not return an email claim.",
    );
  }

  const name =
    (typeof claims.name === "string" && claims.name) ||
    (typeof claims.preferred_username === "string" && claims.preferred_username) ||
    email;

  const groupsRaw = (claims as Record<string, unknown>).groups;
  const groups = Array.isArray(groupsRaw)
    ? groupsRaw.filter((g): g is string => typeof g === "string")
    : [];

  let emailVerified = fromEmailClaim ? parseEmailVerified(emailVerifiedClaim) : null;
  if (emailVerified === null && trustWithoutClaim) emailVerified = true;

  return { sub, email, emailVerified, name, groups };
}
