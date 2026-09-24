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
 * Otherwise this returns the TCP peer address, which `server.mjs` writes to
 * `x-tainer-peer-ip` on every request (overwriting any client-supplied copy).
 * Behind an untrusted proxy that is the proxy's address.
 */
export function trustProxyHeaders(): boolean {
  return process.env.TAINER_TRUST_PROXY_HEADERS === "true";
}

export async function getClientIpForRateLimit(): Promise<string | undefined> {
  const headerStore = await headers();
  if (trustProxyHeaders()) {
    const forwarded =
      headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      headerStore.get("x-real-ip")?.trim();
    if (forwarded) {
      return forwarded;
    }
  }
  return headerStore.get("x-tainer-peer-ip")?.trim().replace(/^::ffff:/, "") || undefined;
}
