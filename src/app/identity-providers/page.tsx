import { KeyRound } from "lucide-react";
import { redirect } from "next/navigation";

import { SectionPanel } from "@/components/ui/section-panel";
import { getCurrentSession } from "@/lib/auth";
import { listIdpProvidersPublic } from "@/lib/idp-providers";
import { getLdapConfigPublic } from "@/lib/ldap-config";

import { IdentityProviderManager } from "./identity-provider-manager";

export const dynamic = "force-dynamic";

export default async function IdentityProvidersPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/");

  const [providers, ldapConfig] = await Promise.all([
    listIdpProvidersPublic(),
    getLdapConfigPublic(),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-zinc-300" />
        <h1 className="text-[15px] font-medium text-white">Identity providers</h1>
      </div>
      <p className="-mt-2 text-[12px] text-zinc-500">
        Configure external identity sources. OIDC adds a &quot;Sign in with X&quot;
        button to the login page; LDAP / AD authenticates transparently
        through the standard email + password form. Click <em>Add provider</em>
        to choose a type.
      </p>

      <SectionPanel>
        <IdentityProviderManager ldapConfig={ldapConfig} providers={providers} />
      </SectionPanel>
    </div>
  );
}
