import "server-only";

type HeaderReader = {
  get(name: string): string | null;
};

export function trustProxyHeaders(): boolean {
  return (
    process.env.TAINER_TRUST_PROXY_HEADERS === "true" ||
    process.env.TRUST_PROXY_HEADERS === "true"
  );
}

export function getTrustedClientIp(headers: HeaderReader): string | undefined {
  if (!trustProxyHeaders()) {
    return undefined;
  }

  return headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || headers.get("x-real-ip")?.trim()
    || undefined;
}
