import type { Metadata, Viewport } from "next";
import { getCurrentSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { listEnabledSites } from "@/lib/site-store";
import { OverviewMap } from "@/components/overview-map";

export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function OverviewPage() {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login");
  }

  const sites = await listEnabledSites();

  if (sites.length === 0) {
    redirect("/setup");
  }

  // Auto-provisioned users (and any non-admin without group assignments)
  // would otherwise land on the overview map with nothing visible —
  // every API call filters by `accessibleSiteIds`, which is empty for
  // them. Send them to /no-access so the empty state is explained
  // rather than silently broken. Admins always have access.
  if (
    session.user.role !== "admin" &&
    session.user.accessibleSiteIds.length === 0
  ) {
    redirect("/no-access");
  }

  return (
    <div className="overview-map-fullbleed relative h-screen bg-[#0e0e0e]" style={{ touchAction: "none" }}>
      {/* Server-rendered loading state visible immediately */}
      <div className="absolute inset-0 z-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-white/60" />
          <p className="text-[13px] text-zinc-500">Loading map...</p>
        </div>
      </div>
      {/* Client component renders on top once hydrated */}
      <div className="relative z-10 h-full">
        <OverviewMap />
      </div>
    </div>
  );
}
