import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth";
import { withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import {
  getLoadBalancerSettings,
  saveLoadBalancerSettings,
} from "@/lib/load-balancer/settings";
import type { LoadBalancerSettings } from "@/lib/load-balancer/types";

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
    const settings = await withSiteConfig(config, () => getLoadBalancerSettings());
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get LB config" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const siteSlug = request.nextUrl.searchParams.get("siteSlug");
  if (!siteSlug) {
    return NextResponse.json({ error: "siteSlug is required" }, { status: 400 });
  }

  try {
    const body = (await request.json()) as Partial<LoadBalancerSettings>;
    const config = await resolveSiteConfigBySlug(siteSlug);
    const updated = await withSiteConfig(config, () => saveLoadBalancerSettings(body));
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update LB config" },
      { status: 500 },
    );
  }
}
