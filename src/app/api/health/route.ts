import { access, constants } from "node:fs/promises";

import { NextResponse } from "next/server";

import { getDataDirectoryPath } from "@/lib/app-data";
import { getCurrentSession } from "@/lib/auth";
import { resolveSiteConfig } from "@/lib/site-resolver";
import { listEnabledSites } from "@/lib/site-store";
import { validateSiteConnection } from "@/lib/site-validation";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();

  // Unauthenticated callers get a minimal status-only response
  if (!session) {
    return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
  }

  const checks: Record<string, unknown> = {};

  // 1. Data directory writable
  try {
    const dataDir = getDataDirectoryPath();
    await access(dataDir, constants.R_OK | constants.W_OK);
    checks.dataDirectory = { ok: true };
  } catch {
    checks.dataDirectory = { ok: false, message: "Data directory not accessible" };
  }

  // 2. Per-site connectivity (admin-only detail)
  const sites = await listEnabledSites();
  const siteChecks: Record<string, { ok: boolean; latencyMs?: number; message?: string }> = {};

  if (session.user.role === "admin") {
    for (const site of sites) {
      try {
        const config = await resolveSiteConfig(site);
        const result = await validateSiteConnection(config);
        siteChecks[site.slug] = {
          ok: result.ok,
          latencyMs: result.latencyMs,
          ...(result.message ? { message: result.message } : {}),
        };
      } catch {
        siteChecks[site.slug] = { ok: false, message: "Failed to resolve site config" };
      }
    }
  }

  checks.sites = siteChecks;

  const dataOk = (checks.dataDirectory as { ok: boolean }).ok;
  const allSitesOk = Object.values(siteChecks).every((c) => c.ok);
  const allHealthy = dataOk && (sites.length === 0 || allSitesOk);

  return NextResponse.json(
    {
      checks,
      status: allHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
    },
    { status: allHealthy ? 200 : 503 },
  );
}
