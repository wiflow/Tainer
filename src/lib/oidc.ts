import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import * as oidc from "openid-client";

import { getAuthSecret } from "@/lib/crypto";
import {
  getDecryptedClientSecret,
  type IdpProvider,
} from "@/lib/idp-providers";
import { trustProxyHeaders } from "@/lib/proxy-trust";

/**
 * Wrapper around `openid-client` v6. The library handles PKCE / state /
 * nonce / ID-token validation; we just provide the policy bits (which
 * scopes, where to redirect, how long the in-flight cookie lives).
 */

/**
 * Resolves the public origin Tainer is reachable at (e.g. https://tainer.example.com).
 * Order of preference:
 *   1. `APP_URL` env var — set explicitly by the deploy script and the most reliable
 *      source when sitting behind a reverse proxy. Use this whenever it's set.
 *   2. `x-forwarded-proto` + `x-forwarded-host` headers, only when
 *      `TAINER_TRUST_PROXY_HEADERS=true` (see proxy-trust.ts).
 *   3. The request's own `Host` header + protocol — last-resort fallback that
 *      can yield `http://0.0.0.0:3000` when the request hits the bind socket
 *      directly inside Docker. Avoid using this unless 1 + 2 are unavailable.
 *
 * Always returns a string with no trailing slash, ready to concatenate paths.
 */
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
      // fall through
    }
  }

  // Last resort. If we get here we'll likely build wrong URLs and the IdP
  // will reject the redirect_uri. Better to surface the misconfiguration
  // than silently use 0.0.0.0:3000.
  throw new Error(
    "Cannot determine public origin. Set the APP_URL env var.",
  );
}

const RETURN_TO_BASE = "http://tainer.invalid";

/** Reduce a caller-supplied return path to a same-origin relative path, or `fallback`. */
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
const OIDC_FLOW_TTL_MS = 5 * 60 * 1000; // 5 minutes — enough to complete the IdP redirect dance

export type OidcFlowState = {
  providerId: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  /** The page the user came from, so we send them back after login. */
  returnTo: string;
  /** Set at issuance; we reject cookies older than OIDC_FLOW_TTL_MS. */
  issuedAt: number;
};

/**
 * Sign a small JSON payload with the same auth secret used for session
 * cookies. Format: `<base64url(json)>.<base64url(hmac)>`.
 */
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

/**
 * Resolve a provider's discovered configuration. openid-client caches
 * nothing internally, so we cache by issuer URL for the lifetime of the
 * process — discovery is just a `GET /.well-known/openid-configuration`
 * but it's pointless to do it on every request.
 */
const discoveryCache = new Map<string, { config: oidc.Configuration; expiresAt: number }>();
const DISCOVERY_TTL_MS = 60 * 60 * 1000; // 1 hour

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

/** Force a fresh discovery on next call (used by the "Test connection" button). */
export function invalidateOidcDiscoveryCache(providerId?: string): void {
  if (providerId) {
    discoveryCache.delete(providerId);
  } else {
    discoveryCache.clear();
  }
}

/**
 * Test that a provider's issuer URL responds with a valid discovery doc.
 * Does NOT attempt a token exchange — just verifies metadata + auth endpoint
 * presence. Useful before saving the provider to catch typos in the issuer.
 */
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

/**
 * Build the authorize URL the user is redirected to. Caller should also
 * persist `flowState` in the OIDC_FLOW_COOKIE so the callback can verify it.
 */
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
  /** Stable identifier from the IdP. Always present. */
  sub: string;
  /** Most providers include this; we require it for user matching. */
  email: string;
  /**
   * Whether the IdP asserts the email was verified. Standard OIDC claim
   * (`email_verified`). `null` means the claim was absent — distinguish
   * from explicit `false` so callers can apply per-provider policy.
   */
  emailVerified: boolean | null;
  /** Display name; falls back to email if absent. */
  name: string;
  /** Optional groups claim — used by the (future) group-mapping feature. */
  groups: string[];
};

/**
 * Complete the authorization-code grant. Validates state/nonce/PKCE/ID-token
 * signature via openid-client, then extracts the claims we care about.
 */
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

  // Entra/Azure AD often omits the standard `email` claim and puts the
  // email-like value in `preferred_username` or `upn` instead. Other IdPs
  // (Google, Okta) reliably use `email`. Try them in order and use whatever
  // looks like an email address. We require an "@" so we don't accidentally
  // accept a non-email username as the canonical identifier.
  const emailCandidates = [
    claims.email,
    (claims as Record<string, unknown>).preferred_username,
    (claims as Record<string, unknown>).upn,
  ];
  let email = "";
  for (const candidate of emailCandidates) {
    if (typeof candidate === "string" && candidate.includes("@")) {
      email = candidate.toLowerCase();
      break;
    }
  }
  if (!email) {
    throw new Error(
      "Identity provider did not return an email-like claim (checked email, preferred_username, upn). " +
        "For Entra, ensure the app has User.Read permission and that the user has a UPN.",
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

  const emailVerifiedRaw = (claims as Record<string, unknown>).email_verified;
  const emailVerified =
    typeof emailVerifiedRaw === "boolean" ? emailVerifiedRaw : null;

  return { sub, email, emailVerified, name, groups };
}
