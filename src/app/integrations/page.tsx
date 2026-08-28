import { Cloud, Plug } from "lucide-react";
import { redirect } from "next/navigation";

import { HetznerBoxPanel } from "@/components/hetzner-box-panel";
import { StorageBoxCard } from "@/components/storage-box-card";
import { IntegrationsSection } from "@/components/ui/integrations-section";
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
  type OffloadLogEntry,
  type StorageBoxSummary,
} from "@/lib/storage-box";

export const dynamic = "force-dynamic";

type SiteBoxState = {
  siteSlug: string;
  siteName: string;
  summary: StorageBoxSummary;
  offloadLog: OffloadLogEntry[];
  hetznerBox: HetznerStorageBox | null;
  hetznerSnapshots: HetznerSnapshot[];
  hetznerError: string | null;
};

async function loadSiteBoxStates(): Promise<SiteBoxState[]> {
  const sites = await listEnabledSites();

  return Promise.all(
    sites.map(async (site) => {
      const siteConfig = await resolveSiteConfigBySlug(site.slug);
      return withSiteConfig(siteConfig, async (): Promise<SiteBoxState> => {
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

  const [ipam, siteBoxStates] = await Promise.all([
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

      <IntegrationsSection ipam={ipam} />

      {/* Hetzner Storage Box — per site, since backups and offload are site-scoped */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Cloud className="h-4 w-4 text-zinc-300" />
          <h2 className="text-[14px] font-medium text-white">
            Hetzner Storage Box — off-site backup
          </h2>
        </div>
        <p className="text-[12px] text-zinc-500">
          Per-site off-site backup target. Once connected here, offload controls appear on the
          site&apos;s Backups page; adding a Hetzner Console API token unlocks box management
          (services, snapshots, usage).
        </p>
      </div>

      {siteBoxStates.map((state) => (
        <div className="space-y-4" key={state.siteSlug}>
          {siteBoxStates.length > 1 && (
            <h3 className="text-[13px] font-medium text-zinc-300">{state.siteName}</h3>
          )}
          <StorageBoxCard
            dirStorages={[]}
            nodes={[]}
            offloadLog={state.offloadLog}
            showRetrieve={false}
            siteSlug={state.siteSlug}
            summary={state.summary}
          />
          {state.summary.configured && (
            <HetznerBoxPanel
              box={state.hetznerBox}
              error={state.hetznerError}
              hetznerConnected={state.summary.hetznerConnected}
              siteSlug={state.siteSlug}
              snapshots={state.hetznerSnapshots}
            />
          )}
        </div>
      ))}
    </div>
  );
}
