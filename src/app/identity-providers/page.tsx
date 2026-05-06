import { KeyRound, Network } from "lucide-react";
import { redirect } from "next/navigation";

import { LdapConfigForm } from "@/app/ldap/ldap-config-form";
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

  const providers = await listIdpProvidersPublic();
  const ldapConfig = await getLdapConfigPublic();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-zinc-300" />
        <h1 className="text-[15px] font-medium text-white">Identity providers</h1>
      </div>
      <p className="-mt-4 text-[12px] text-zinc-500">
        Configure external identity sources. SSO providers add a button to
        the login page; LDAP / AD authenticates transparently through the
        standard email + password form once enabled.
      </p>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-zinc-300" />
          <h2 className="text-[13px] font-medium text-zinc-200">
            OIDC (Single Sign-On)
          </h2>
        </div>
        <p className="-mt-1 text-[11px] text-zinc-500">
          OpenID Connect providers like Microsoft Entra ID, Google Workspace,
          Okta, or Keycloak. SSO users skip Tainer&apos;s TOTP 2FA — the IdP
          enforces that upstream.
        </p>
        <SectionPanel>
          <IdentityProviderManager providers={providers} />
        </SectionPanel>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-zinc-300" />
          <h2 className="text-[13px] font-medium text-zinc-200">
            LDAP / Active Directory
          </h2>
        </div>
        <p className="-mt-1 text-[11px] text-zinc-500">
          Corporate LDAP / AD directory. When enabled, the standard sign-in
          form authenticates against the directory after local-password
          lookup fails — no separate &quot;Sign in with LDAP&quot; button.
          LDAPS required by default; bind password encrypted at rest.
        </p>
        <SectionPanel>
          <LdapConfigForm config={ldapConfig} />
        </SectionPanel>
      </div>
    </div>
  );
}
