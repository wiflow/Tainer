import { requirePermission, requireSession } from "@/lib/auth";
import { SiteManagementPanel } from "@/components/site-management-panel";
import { getSiteStore } from "@/lib/site-store";

export const dynamic = "force-dynamic";

export default async function SitesManagementPage() {
  const session = await requireSession();
  requirePermission(session, "manage-sites");
  const store = await getSiteStore();

  const sites = store.sites.map((site) => ({
    id: site.id,
    slug: site.slug,
    name: site.name,
    enabled: site.enabled,
    apiUrl: site.payload.apiUrl,
    username: site.payload.username,
    defaultNode: site.payload.defaultNode,
    tlsMode: site.payload.tlsMode,
    tlsCustomCaPem: site.payload.tlsCustomCaPem ?? null,
    lastValidationOk: site.lastValidationOk,
    lastValidatedAt: site.lastValidatedAt,
    isDefault: site.id === store.defaultSiteId,
    location: site.location ?? null,
    countryCode: site.countryCode ?? null,
  }));

  return (
    <div className="space-y-4">
      <SiteManagementPanel sites={sites} defaultSiteId={store.defaultSiteId} />
    </div>
  );
}
