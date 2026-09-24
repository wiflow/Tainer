import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PAGE_PATHS = new Set([
  "/forgot-password",
  "/hero-demo",
  "/login",
  "/reset-password",
  "/setup",
]);

function needsSessionCookie(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PAGE_PATHS.has(pathname) ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/auth/sso/") ||
    pathname.startsWith("/_next/") ||
    /\.[^/]+$/.test(pathname)
  ) {
    return false;
  }

  if (request.headers.get("authorization")?.startsWith("Bearer tnr_")) {
    return false;
  }

  return !request.cookies.get("tainer_session")?.value;
}

export function proxy(request: NextRequest) {
  let response: NextResponse;

  if (needsSessionCookie(request)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    response = NextResponse.redirect(loginUrl);
  } else {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-pathname", request.nextUrl.pathname);

    response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
