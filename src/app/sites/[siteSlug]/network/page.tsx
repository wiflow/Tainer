import { IpPoolSettingsPanel } from "@/components/ip-pool-settings-panel";
import { AutoRefresh } from "@/components/auto-refresh";
import { NetworkIpamPanel } from "@/components/network-ipam-panel";
import { PillTabs } from "@/components/ui/pill-tabs";
import { requireSession, requireSiteAccess } from "@/lib/auth";
import { listContainerTags } from "@/lib/container-groups";
import { getIpamIntegrationPublic } from "@/lib/integrations";
import { getIpPoolCatalog } from "@/lib/ip-pools";
import { withSiteConfig } from "@/lib/proxmox";
import { requireSitePageAccess } from "@/lib/page-guard";
import { ensureSiteConfig } from "@/lib/site-context";

export default async function NetworkPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteSlug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { siteSlug } = await params;
  await requireSitePageAccess(siteSlug);
  const { tab: tabParam } = await searchParams;
  const tab = tabParam === "integrations" ? "integrations" : "ip-pools";

  const siteConfig = await ensureSiteConfig(siteSlug);
  const session = await requireSession();
  requireSiteAccess(session, siteConfig.siteId);

  const isAdmin = session.user.role === "admin";

  const [ipam, [ipPools, ipPoolTags]] = await Promise.all([
    getIpamIntegrationPublic(),
    isAdmin
      ? withSiteConfig(siteConfig, () =>
          Promise.all([getIpPoolCatalog(), listContainerTags()]),
        )
      : Promise.resolve([[], []] as [
          Awaited<ReturnType<typeof getIpPoolCatalog>>,
          Awaited<ReturnType<typeof listContainerTags>>,
        ]),
  ]);

  return (
    <main className="min-h-screen px-6 py-8 lg:px-10">
      <AutoRefresh />
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header>
          <p className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-zinc-500">
            Network
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-50">
            {tab === "integrations" ? "Integrations" : "IP pools"}
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] text-zinc-400">
            Subnets for static container addressing, checked against phpIPAM when it is connected.
          </p>
        </header>

        <PillTabs
          items={[
            {
              label: "IP pools",
              count: isAdmin ? ipPools.length : undefined,
              href: `/sites/${siteSlug}/network`,
              active: tab === "ip-pools",
            },
            {
              label: "Integrations",
              href: `/sites/${siteSlug}/network?tab=integrations`,
              active: tab === "integrations",
            },
          ]}
        />

        {tab === "ip-pools" ? (
          isAdmin ? (
            <IpPoolSettingsPanel availableTags={ipPoolTags} pools={ipPools} />
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 bg-zinc-950/40 px-6 py-10 text-center text-[12.5px] text-zinc-500">
              IP pools are managed by admins. Ask an admin to add or change a pool.
            </div>
          )
        ) : null}

        {tab === "integrations" ? <NetworkIpamPanel canManage={isAdmin} ipam={ipam} /> : null}
      </div>
    </main>
  );
}
