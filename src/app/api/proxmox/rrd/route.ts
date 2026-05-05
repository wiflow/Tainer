import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession, hasSiteAccess } from "@/lib/auth";
import { getClusterRRDData, withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

export const dynamic = "force-dynamic";

const VALID_TIMEFRAMES = new Set(["hour", "day", "week", "month", "year"]);

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const timeframe = searchParams.get("timeframe") ?? "hour";
  const siteSlug = searchParams.get("site") ?? "";

  if (!VALID_TIMEFRAMES.has(timeframe)) {
    return NextResponse.json({ error: "Invalid timeframe" }, { status: 400 });
  }

  if (!siteSlug) {
    return NextResponse.json({ error: "Missing site parameter" }, { status: 400 });
  }

  try {
    const tf = timeframe as "hour" | "day" | "week" | "month" | "year";
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    if (!hasSiteAccess(session, siteConfig.siteId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const data = await withSiteConfig(siteConfig, () => getClusterRRDData(tf));
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[rrd] Failed to fetch RRD data:", message);
    return NextResponse.json({ error: "Failed to fetch RRD data", detail: message }, { status: 500 });
  }
}
