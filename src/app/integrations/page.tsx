import { Plug } from "lucide-react";
import { redirect } from "next/navigation";

import { SectionPanel } from "@/components/ui/section-panel";
import { getCurrentSession } from "@/lib/auth";
import { getIpamIntegrationPublic } from "@/lib/integrations";

import { IntegrationsManager } from "./integrations-manager";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/");

  const ipam = await getIpamIntegrationPublic();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Plug className="h-5 w-5 text-zinc-300" />
        <h1 className="text-[15px] font-medium text-white">Integrations</h1>
      </div>
      <p className="-mt-2 text-[12px] text-zinc-500">
        Connect Tainer to external systems so it can pull live data into
        deployment flows. Currently supports phpIPAM for IP-pool reservations.
      </p>

      <SectionPanel>
        <IntegrationsManager ipam={ipam} />
      </SectionPanel>
    </div>
  );
}
