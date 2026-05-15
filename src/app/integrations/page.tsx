import { Plug } from "lucide-react";
import { redirect } from "next/navigation";

import { IntegrationsSection } from "@/components/ui/integrations-section";
import { getCurrentSession } from "@/lib/auth";
import { getIpamIntegrationPublic } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/");

  const ipam = await getIpamIntegrationPublic();

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
    </div>
  );
}
