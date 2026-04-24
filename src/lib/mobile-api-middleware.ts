import "server-only";

import { NextResponse } from "next/server";

import type { AuthSession } from "@/lib/auth";
import { getSessionById } from "@/lib/auth";
import { validateMobileToken } from "@/lib/mobile-auth";
import { withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

export type MobileAuthResult =
  | { ok: true; session: AuthSession }
  | { ok: false; response: NextResponse };

export async function authenticateMobileRequest(
  request: Request,
): Promise<MobileAuthResult> {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      ),
    };
  }

  const token = authHeader.slice(7);
  const claims = await validateMobileToken(token);

  if (!claims) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or expired token." },
        { status: 401 },
      ),
    };
  }

  const session = await getSessionById(claims.sessionId);

  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Session expired or revoked." },
        { status: 401 },
      ),
    };
  }

  if (session.user.id !== claims.userId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid token." },
        { status: 401 },
      ),
    };
  }

  return { ok: true, session };
}

// Site slug comes from X-Site-Slug header (preferred) or ?site= query param.
export async function withMobileSiteContext<T>(
  request: Request,
  session: AuthSession,
  handler: () => Promise<T>,
): Promise<T | NextResponse> {
  const url = new URL(request.url);
  const siteSlug =
    request.headers.get("x-site-slug") ?? url.searchParams.get("site");

  if (!siteSlug) {
    return NextResponse.json(
      { error: "Site slug is required. Pass X-Site-Slug header or ?site= query parameter." },
      { status: 400 },
    );
  }

  try {
    const config = await resolveSiteConfigBySlug(siteSlug);

    if (
      session.user.role !== "admin" &&
      !session.user.accessibleSiteIds.includes(config.siteId)
    ) {
      return NextResponse.json(
        { error: "You do not have access to this site." },
        { status: 403 },
      );
    }

    return await withSiteConfig(config, handler);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 200)
        : "Failed to resolve site.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export function mobileErrorResponse(error: unknown, fallback = "An unexpected error occurred.") {
  const message =
    error instanceof Error
      ? error.message.slice(0, 200).replace(/\/[^\s]+/g, "[path]")
      : fallback;

  return NextResponse.json({ error: message }, { status: 500 });
}

export function requireMobileAdmin(session: AuthSession): NextResponse | null {
  if (session.user.role !== "admin") {
    return NextResponse.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  }

  return null;
}
