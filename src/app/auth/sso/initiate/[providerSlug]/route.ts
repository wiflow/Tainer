import { NextResponse, type NextRequest } from "next/server";

import { getIdpProviderBySlug } from "@/lib/idp-providers";
import { OIDC_FLOW_COOKIE, oidcFlowCookieHelpers, startOidcAuthorization } from "@/lib/oidc";

export const dynamic = "force-dynamic";

function buildRedirectUri(request: NextRequest, providerSlug: string): string {
  // Honour x-forwarded-* when sitting behind a reverse proxy. Falls back to
  // the request's own protocol/host. Final URL must EXACTLY match the
  // redirect URI registered in the IdP — typos here are the #1 OIDC failure.
  const headers = request.headers;
  const proto = headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? request.nextUrl.host;
  return `${proto}://${host}/auth/sso/callback/${providerSlug}`;
}

function sanitizeReturnTo(raw: string | null, fallback = "/"): string {
  if (!raw) return fallback;
  // Block protocol-relative URLs and absolute URLs to prevent open-redirect.
  // Only same-origin paths are allowed back through this entrypoint.
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ providerSlug: string }> },
) {
  const { providerSlug } = await context.params;
  const provider = await getIdpProviderBySlug(providerSlug);
  if (!provider || !provider.enabled) {
    return NextResponse.redirect(
      new URL("/login?sso_error=unknown_provider", request.url),
    );
  }

  const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get("return_to"));
  const redirectUri = buildRedirectUri(request, providerSlug);

  try {
    const { url, flowState } = await startOidcAuthorization(
      provider,
      redirectUri,
      returnTo,
    );
    const cookieValue = await oidcFlowCookieHelpers.sign(flowState);

    const response = NextResponse.redirect(url);
    response.cookies.set(OIDC_FLOW_COOKIE, cookieValue, {
      httpOnly: true,
      maxAge: Math.floor(oidcFlowCookieHelpers.ttlMs / 1000),
      path: "/auth/sso",
      sameSite: "lax", // must allow the IdP redirect-back
      secure: request.nextUrl.protocol === "https:",
    });
    return response;
  } catch (error) {
    console.error(
      `[oidc] Failed to start authorization for ${provider.slug}:`,
      error instanceof Error ? error.message : error,
    );
    return NextResponse.redirect(
      new URL(
        `/login?sso_error=${encodeURIComponent("Failed to start sign-in. Check the provider configuration.")}`,
        request.url,
      ),
    );
  }
}
