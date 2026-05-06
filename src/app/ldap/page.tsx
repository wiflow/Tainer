import { Network } from "lucide-react";
import { redirect } from "next/navigation";

import { SectionPanel } from "@/components/ui/section-panel";
import { getCurrentSession } from "@/lib/auth";
import { getLdapConfigPublic } from "@/lib/ldap-config";

import { LdapConfigForm } from "./ldap-config-form";

export const dynamic = "force-dynamic";

export default async function LdapPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/");

  const config = await getLdapConfigPublic();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Network className="h-5 w-5 text-sky-400" />
        <h1 className="text-[15px] font-medium text-white">LDAP / Active Directory</h1>
      </div>
      <p className="-mt-2 text-[12px] text-zinc-500">
        Configure a corporate LDAP / AD directory. When enabled, the standard
        sign-in form transparently authenticates against the directory after
        local-password lookup fails — no separate &quot;Sign in with LDAP&quot; button.
        LDAPS is required by default; the bind password is encrypted at rest.
      </p>

      <SectionPanel>
        <LdapConfigForm config={config} />
      </SectionPanel>
    </div>
  );
}
