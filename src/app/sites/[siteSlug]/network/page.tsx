import { headers } from "next/headers";
import { unstable_cache } from "next/cache";

import { IpPoolSettingsPanel } from "@/components/ip-pool-settings-panel";
import { AutoRefresh } from "@/components/auto-refresh";
import { NetworkDevicesTable } from "@/components/network-devices-table";
import { NetworkIntegrationPanel } from "@/components/network-integration-panel";
import { NetworkTopologyGraph } from "@/components/network-topology-graph";
import { VirtualSwitchPanel } from "@/components/virtual-switch-panel";
import { PillTabs } from "@/components/ui/pill-tabs";
import {
  hasSitePermission,
  requireSession,
  requireSiteAccess,
} from "@/lib/auth";
import { listContainerTags } from "@/lib/container-groups";
import { getIpPoolCatalog } from "@/lib/ip-pools";
import { getLldpAnnotationsForSite } from "@/lib/lldp-annotations";
import { listLldpTokensForSite } from "@/lib/lldp-credentials";
import {
  deriveTopology,
  getLldpSnapshotsForSite,
} from "@/lib/lldp-snapshots";
import {
  getSnmpConfigForSite,
  resolveAgentBaseUrl,
} from "@/lib/lldp-snmp-config";
import { getPublicOrigin } from "@/lib/oidc";
import { withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";
import { ensureSiteConfig } from "@/lib/site-context";
import { getVirtualSwitchingOverview } from "@/lib/virtual-switching";

// No `force-dynamic` here — the page is already request-rendered because it
// reads headers(), and force-dynamic would silently disable the
// unstable_cache below (same trap as the deployments page).

// The switching overview costs one Proxmox call per guest. Cache it briefly
// so tab switches, the 60s auto-refresh, and post-action router.refresh()
// don't each pay the full fan-out; the NIC action busts the tag on writes.
const getSwitchingData = unstable_cache(
  async (siteSlug: string) => {
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return withSiteConfig(siteConfig, () => getVirtualSwitchingOverview());
  },
  ["virtual-switching"],
  { revalidate: 15, tags: ["virtual-switching"] },
);

type Tab = "topology" | "switching" | "devices" | "ip-pools" | "integrations";

const VALID_TABS: Tab[] = ["topology", "switching", "devices", "ip-pools", "integrations"];

export default async function NetworkPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteSlug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { siteSlug } = await params;
  const { tab: tabParam } = await searchParams;
  const tab: Tab = VALID_TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "topology";

  const siteConfig = await ensureSiteConfig(siteSlug);
  const session = await requireSession();
  requireSiteAccess(session, siteConfig.siteId);

  const canManage = hasSitePermission(session, siteConfig.siteId, "manage-security");
  const canManageNics = hasSitePermission(session, siteConfig.siteId, "manage-deployments");
  // IP pool editing requires admin role (same gate as the legacy /settings
  // location). Non-admins don't see the IP Pools tab at all; admins see it
  // alongside the discovery tabs.
  const canManageIpPools = session.user.role === "admin";

  const [snapshots, tokens, annotations, snmpConfig, ipPoolData] = await Promise.all([
    getLldpSnapshotsForSite(siteConfig.siteId),
    listLldpTokensForSite(siteConfig.siteId),
    getLldpAnnotationsForSite(siteConfig.siteId),
    getSnmpConfigForSite(siteConfig.siteId),
    canManageIpPools
      ? withSiteConfig(siteConfig, () =>
          Promise.all([getIpPoolCatalog(), listContainerTags()]),
        )
      : Promise.resolve([[], []] as const),
  ]);
  const [ipPools, ipPoolTags] = ipPoolData as [
    Awaited<ReturnType<typeof getIpPoolCatalog>>,
    Awaited<ReturnType<typeof listContainerTags>>,
  ];
  const baseTopology = deriveTopology(snapshots);
  // Apply operator-supplied friendly names in listings without mutating the
  // original LldpDevice objects (the detail page surfaces both names).
  const topology = {
    ...baseTopology,
    devices: baseTopology.devices.map((d) => {
      const friendly = annotations[d.chassisId]?.friendlyName;
      return friendly ? { ...d, systemName: friendly } : d;
    }),
  };
  const agentHosts = Array.from(
    new Set([
      ...topology.agents,
      ...tokens.map((t) => t.label),
    ]),
  ).sort();

  const headerStore = await headers();
  let fallbackOrigin: string;
  try {
    fallbackOrigin = getPublicOrigin(headerStore);
  } catch {
    fallbackOrigin = "https://YOUR-TAINER-HOST";
  }
  // Precedence: per-site override → TAINER_AGENT_BASE_URL → request origin.
  // The override exists because the public origin (APP_URL) is often not
  // resolvable from the Proxmox nodes (LAN box reached by IP, split DNS).
  const agentBase = resolveAgentBaseUrl(snmpConfig.agentBaseUrl, fallbackOrigin);
  const ingestUrl = `${agentBase}/api/internal/lldp-ingest`;
  const snmpIngestUrl = `${agentBase}/api/internal/snmp-ingest`;

  const activeTokenCount = tokens.filter((t) => !t.revokedAt).length;

  // Only pay for the guest fan-out when the tab is actually open.
  const switching = tab === "switching" ? await getSwitchingData(siteSlug) : null;

  return (
    <main className="min-h-screen px-6 py-8 lg:px-10">
      <AutoRefresh />
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-zinc-500">
              Network
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-zinc-50">
              {tab === "switching" ? "Virtual switching" : "LLDP topology"}
            </h1>
            <p className="mt-1 max-w-2xl text-[13px] text-zinc-400">
              {tab === "switching"
                ? "Each Proxmox node rendered as a switch: bridges as panels, guest interfaces as ports, physical NICs as uplinks. Click a port to inspect it or change link state, VLAN, rate limit, and firewall."
                : "Auto-discovered upstream switches, routers, and access points reported by Proxmox nodes in this site. Data refreshes when each node's agent posts its 60-second snapshot."}
            </p>
          </div>
          {tab !== "switching" ? (
            <div className="flex flex-col items-end gap-1 text-right">
              <div className="text-[10.5px] uppercase tracking-[0.14em] text-zinc-500">
                Last push
              </div>
              <div className="font-mono text-[12px] text-zinc-300">
                {topology.freshestAt ? new Date(topology.freshestAt).toLocaleString() : "—"}
              </div>
            </div>
          ) : null}
        </header>

        <PillTabs
          items={[
            {
              label: "Topology",
              href: `/sites/${siteSlug}/network`,
              active: tab === "topology",
            },
            {
              label: "Switching",
              href: `/sites/${siteSlug}/network?tab=switching`,
              active: tab === "switching",
            },
            {
              label: "Devices",
              count: topology.devices.length,
              href: `/sites/${siteSlug}/network?tab=devices`,
              active: tab === "devices",
            },
            ...(canManageIpPools
              ? [
                  {
                    label: "IP pools",
                    count: ipPools.length,
                    href: `/sites/${siteSlug}/network?tab=ip-pools`,
                    active: tab === "ip-pools",
                  },
                ]
              : []),
            {
              label: "Integrations",
              count: activeTokenCount,
              href: `/sites/${siteSlug}/network?tab=integrations`,
              active: tab === "integrations",
            },
          ]}
        />

        {tab === "topology" ? (
          <NetworkTopologyGraph topology={topology} siteSlug={siteSlug} />
        ) : null}

        {tab === "switching" && switching ? (
          <VirtualSwitchPanel
            nodes={switching.nodes}
            siteSlug={siteSlug}
            canManage={canManageNics}
          />
        ) : null}

        {tab === "devices" ? (
          <NetworkDevicesTable devices={topology.devices} siteSlug={siteSlug} />
        ) : null}

        {tab === "ip-pools" && canManageIpPools ? (
          <IpPoolSettingsPanel availableTags={ipPoolTags} pools={ipPools} />
        ) : null}

        {tab === "integrations" ? (
          <NetworkIntegrationPanel
            siteSlug={siteSlug}
            tokens={tokens}
            agentHosts={agentHosts}
            ingestUrl={ingestUrl}
            snmpIngestUrl={snmpIngestUrl}
            snmpConfig={snmpConfig}
            canManage={canManage}
          />
        ) : null}
      </div>
    </main>
  );
}
