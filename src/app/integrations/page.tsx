import { Plug } from "lucide-react";
import { redirect } from "next/navigation";

import {
  IntegrationsSection,
  type StorageBoxSiteState,
} from "@/components/ui/integrations-section";
import { getCurrentSession } from "@/lib/auth";
import {
  getHetznerStorageBox,
  listHetznerSnapshots,
  type HetznerSnapshot,
  type HetznerStorageBox,
} from "@/lib/hetzner-storage-api";
import { getIpamIntegrationPublic } from "@/lib/integrations";
import { withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import { listEnabledSites } from "@/lib/site-store";
import {
  getHetznerApiContext,
  getStorageBoxSummary,
  listOffloadLog,
} from "@/lib/storage-box";

export const dynamic = "force-dynamic";

async function loadSiteBoxStates(): Promise<StorageBoxSiteState[]> {
  const sites = await listEnabledSites();

  return Promise.all(
    sites.map(async (site) => {
      const siteConfig = await resolveSiteConfigBySlug(site.slug);
      return withSiteConfig(siteConfig, async (): Promise<StorageBoxSiteState> => {
        const [summary, offloadLog] = await Promise.all([
          getStorageBoxSummary(),
          listOffloadLog(8),
        ]);

        let hetznerBox: HetznerStorageBox | null = null;
        let hetznerSnapshots: HetznerSnapshot[] = [];
        let hetznerError: string | null = null;

        if (summary.hetznerConnected) {
          try {
            const context = await getHetznerApiContext();
            if (context) {
              [hetznerBox, hetznerSnapshots] = await Promise.all([
                getHetznerStorageBox(context.token, context.boxId),
                listHetznerSnapshots(context.token, context.boxId),
              ]);
            }
          } catch (err) {
            hetznerError = err instanceof Error ? err.message : "Hetzner API request failed.";
          }
        }

        return {
          hetznerBox,
          hetznerError,
          hetznerSnapshots,
          offloadLog,
          siteName: site.name,
          siteSlug: site.slug,
          summary,
        };
      });
    }),
  );
}

export default async function IntegrationsPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/");

  const [ipam, storageBoxSites] = await Promise.all([
    getIpamIntegrationPublic(),
    loadSiteBoxStates(),
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-zinc-300" />
          <h1 className="text-[15px] font-medium text-white">Integrations</h1>
        </div>
        <p className="text-[12px] text-zinc-500">
          Connect Tainer to external systems so it can pull live data into
          deployment flows. Click an integration to configure it.
        </p>
      </div>

      <IntegrationsSection ipam={ipam} storageBoxSites={storageBoxSites} />
    </div>
  );
}
