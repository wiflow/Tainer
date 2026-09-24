import { NextResponse, type NextRequest } from "next/server";

import { getIdpProviderBySlug } from "@/lib/idp-providers";
import {
  OIDC_FLOW_COOKIE,
  getPublicOrigin,
  oidcFlowCookieHelpers,
  sanitizeReturnTo,
  startOidcAuthorization,
} from "@/lib/oidc";

export const dynamic = "force-dynamic";

function buildRedirectUri(request: NextRequest, providerSlug: string): string {
  // Must match the callback's redirect_uri exactly; IdPs strict-compare it.
  const origin = getPublicOrigin(request.headers, request.url);
  return `${origin}/auth/sso/callback/${providerSlug}`;
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
