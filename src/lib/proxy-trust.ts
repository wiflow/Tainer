import "server-only";

import { headers } from "next/headers";

export function trustProxyHeaders(): boolean {
  return process.env.TAINER_TRUST_PROXY_HEADERS === "true";
}

// server.mjs overwrites x-tainer-peer-ip with the TCP peer address on every request.
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
