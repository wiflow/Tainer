import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth";
import { resolveSiteConfig } from "@/lib/site-resolver";
import { listEnabledSites } from "@/lib/site-store";
import { validateSiteConnection } from "@/lib/site-validation";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allSites = await listEnabledSites();
  const sites =
    session.user.role === "admin"
      ? allSites
      : allSites.filter((s) =>
          session.user.accessibleSiteIds.includes(s.id),
        );
  const results: Record<string, {
    ok: boolean;
    latencyMs: number;
    version: string | null;
    message?: string;
  }> = {};

  const bySlug: typeof results = {};

  await Promise.all(
    sites.map(async (site) => {
      try {
        const config = await resolveSiteConfig(site);
        const result = await validateSiteConnection(config);
        const entry = {
          ok: result.ok,
          latencyMs: result.latencyMs,
          version: result.version,
          ...(result.message ? { message: result.message } : {}),
        };
        results[site.id] = entry;
        bySlug[site.slug] = entry;
      } catch (error) {
        const entry = {
          ok: false,
          latencyMs: 0,
          version: null,
          message: error instanceof Error ? error.message : "Failed to check",
        };
        results[site.id] = entry;
        bySlug[site.slug] = entry;
      }
    }),
  );

  return NextResponse.json({ sites: results, bySlug });
}
