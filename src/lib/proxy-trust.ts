import "server-only";

import { headers } from "next/headers";

/**
 * Resolve the client IP for rate-limiting purposes.
 *
 * `X-Forwarded-For` is only honoured when `TAINER_TRUST_PROXY_HEADERS=true` is
 * set, signalling that the operator has confirmed Tainer sits behind a proxy
 * that strips/rewrites client-supplied forwarded headers. Without that opt-in
 * any direct caller can rotate the header to mint a fresh rate-limit bucket
 * per request, defeating per-IP login lockout.
 *
 * When unset (the default) this returns `undefined`, which causes downstream
 * rate-limit keys to fall back to email-only (`email` instead of
 * `email:ip`) — slower for the attacker on a single account, no false sense
 * of per-IP isolation.
 */
export async function getClientIpForRateLimit(): Promise<string | undefined> {
  if (process.env.TAINER_TRUST_PROXY_HEADERS !== "true") {
    return undefined;
  }
  const headerStore = await headers();
  return (
    headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headerStore.get("x-real-ip")?.trim() ||
    undefined
  );
}
