import { NextResponse, type NextRequest } from "next/server";
import {
  AuthorizationResponseError,
  ResponseBodyError,
} from "openid-client";

import { recordAdminAudit } from "@/lib/admin-audit-log";
import { signInWithSso } from "@/lib/auth";
import {
  getIdpProviderBySlug,
  isEmailAllowed,
  type IdpProvider,
} from "@/lib/idp-providers";
import {
  OIDC_FLOW_COOKIE,
  completeOidcAuthorization,
  getPublicOrigin,
  oidcFlowCookieHelpers,
  sanitizeReturnTo,
} from "@/lib/oidc";

export const dynamic = "force-dynamic";

/**
 * Build a URL anchored to the public origin (APP_URL / forwarded headers),
 * NOT request.url. Inside Docker `request.url` is often `http://0.0.0.0:3000/...`
 * which is the bind socket, not the public URL — using that for redirects
 * sends users to a broken URL.
 */
function publicUrl(request: NextRequest, path: string): URL {
  return new URL(path, getPublicOrigin(request.headers, request.url));
}

function loginRedirect(request: NextRequest, error: string): NextResponse {
  const url = publicUrl(request, "/login");
  url.searchParams.set("sso_error", error);
  const response = NextResponse.redirect(url);
  // Always clear the in-flight cookie on error so a stale state can't get
  // reused.
  response.cookies.delete(OIDC_FLOW_COOKIE);
  return response;
}

function auditSsoFailure(provider: IdpProvider, reason: string, email?: string, sub?: string) {
  const actor = email || "unknown";
  recordAdminAudit({
    action: "sso-login-failure",
    actorEmail: actor,
    actorName: actor,
    message: `SSO sign-in via ${provider.name} failed${sub ? ` (sub=${sub})` : ""}: ${reason}`,
  }).catch(() => {});
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ providerSlug: string }> },
) {
  const { providerSlug } = await context.params;
  const provider = await getIdpProviderBySlug(providerSlug);
  if (!provider || !provider.enabled) {
    return loginRedirect(request, "unknown_provider");
  }

  // The IdP may redirect with `error` if the user denied consent or something
  // went wrong upstream. Surface that directly rather than trying to grant.
  const idpError = request.nextUrl.searchParams.get("error");
  if (idpError) {
    const description = request.nextUrl.searchParams.get("error_description") ?? idpError;
    return loginRedirect(request, description);
  }

  const flowCookie = request.cookies.get(OIDC_FLOW_COOKIE)?.value;
  if (!flowCookie) {
    return loginRedirect(request, "Sign-in session expired. Please try again.");
  }
  const flowState = await oidcFlowCookieHelpers.verify(flowCookie);
  if (!flowState) {
    return loginRedirect(request, "Sign-in session was invalid or expired. Please try again.");
  }
  if (flowState.providerId !== provider.id) {
    return loginRedirect(request, "Sign-in session does not match the provider.");
  }

  // Build a plain URL instance pointing at the public origin (not 0.0.0.0:3000)
  // and pass that to openid-client. Two reasons to do this rather than reuse
  // request.nextUrl:
  //   1. NextURL extends URL but openid-client v6 sometimes fails the
  //      `instanceof URL` check across module boundaries when Next bundles
  //      its URL global separately. A plain new URL() always passes.
  //   2. request.nextUrl.origin can be the docker bind (0.0.0.0:3000) when
  //      sitting behind a reverse proxy without trust-proxy config — that
  //      breaks the redirect_uri match on the token endpoint.
  const callbackUrl = publicUrl(
    request,
    request.nextUrl.pathname + request.nextUrl.search,
  );

  let claims;
  try {
    claims = await completeOidcAuthorization(provider, flowState, callbackUrl);
  } catch (error) {
    // openid-client v6 raises ResponseBodyError when the IdP returns an
    // OAuth error response from the token endpoint (e.g. invalid_grant,
    // redirect_uri_mismatch, invalid_client) and AuthorizationResponseError
    // when the authorization response itself is malformed. Both carry
    // structured fields that are FAR more useful to display than the
    // generic "server responded with an error in the response body".
    let detail: string;
    let logBody: unknown = error;

    if (error instanceof ResponseBodyError) {
      const parts = [error.error];
      if (error.error_description) parts.push(error.error_description);
      detail = parts.filter(Boolean).join(" — ") || "OIDC token endpoint returned an error.";
      logBody = {
        error: error.error,
        error_description: error.error_description,
        status: error.status,
        cause: error.cause,
      };
    } else if (error instanceof AuthorizationResponseError) {
      const parts = [error.error];
      if (error.error_description) parts.push(error.error_description);
      detail = parts.filter(Boolean).join(" — ") || "OIDC authorization response was invalid.";
      logBody = {
        error: error.error,
        error_description: error.error_description,
        cause: error.cause,
      };
    } else {
      detail = error instanceof Error ? error.message : "Failed to complete sign-in.";
    }

    console.error(`[oidc] Token exchange failed for ${provider.slug}:`, logBody);
    auditSsoFailure(provider, detail);
    return loginRedirect(request, detail);
  }

  if (!isEmailAllowed(claims.email, provider.allowedEmailDomains)) {
    auditSsoFailure(provider, "email domain not allowed", claims.email, claims.sub);
    return loginRedirect(
      request,
      `${claims.email} is not in the allowed-domain list for this provider.`,
    );
  }

  let result;
  try {
    result = await signInWithSso({
      providerId: provider.id,
      subject: claims.sub,
      email: claims.email,
      emailVerified: claims.emailVerified,
      name: claims.name,
      autoProvision: provider.autoProvision,
      defaultRole: provider.defaultRole,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Sign-in failed.";
    auditSsoFailure(provider, reason, claims.email, claims.sub);
    return loginRedirect(request, reason);
  }

  if (result.requiresTwoFactor) {
    recordAdminAudit({
      action: "sso-login",
      actorEmail: result.user.email,
      actorName: result.user.name,
      targetEmail: result.user.email,
      message: `Signed in via ${provider.name}, awaiting 2FA challenge`,
    }).catch(() => {});
    const response = NextResponse.redirect(publicUrl(request, "/login?two_factor=1"));
    response.cookies.delete(OIDC_FLOW_COOKIE);
    return response;
  }

  // Audit trail. Distinguishes provisioned (first-ever SSO login → user
  // created) from regular SSO sign-ins so an admin can spot a flood of
  // unexpected new accounts.
  recordAdminAudit({
    action: result.provisioned ? "sso-user-provisioned" : "sso-login",
    actorEmail: result.user.email,
    actorName: result.user.name,
    targetEmail: result.user.email,
    message: result.provisioned
      ? `Provisioned new ${result.user.role} via ${provider.name} (sub=${claims.sub})`
      : `Signed in via ${provider.name}`,
  }).catch(() => {});

  // Send the user back where they came from. Cookie has been set by
  // signInWithSso → createSession.
  const home = publicUrl(request, "/");
  let target = publicUrl(request, sanitizeReturnTo(flowState.returnTo));
  if (target.origin !== home.origin) target = home;
  const response = NextResponse.redirect(target);
  response.cookies.delete(OIDC_FLOW_COOKIE);
  return response;
}
