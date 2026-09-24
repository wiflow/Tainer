import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession, hasSiteAccess } from "@/lib/auth";
import { getLoadBalancerStatus } from "@/lib/load-balancer/observer";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const siteSlug = request.nextUrl.searchParams.get("siteSlug");
  if (!siteSlug) {
    return NextResponse.json({ error: "siteSlug is required" }, { status: 400 });
  }

  try {
    const config = await resolveSiteConfigBySlug(siteSlug);
    if (!hasSiteAccess(session, config.siteId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const status = getLoadBalancerStatus(config.siteId);
    const body = session.user.role === "admin" ? status : { ...status, lastError: null };
    return NextResponse.json(body, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get LB status" },
      { status: 500 },
    );
  }
}
