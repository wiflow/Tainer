import { KeyRound } from "lucide-react";
import { redirect } from "next/navigation";

import { SectionPanel } from "@/components/ui/section-panel";
import { getCurrentSession } from "@/lib/auth";
import { listIdpProvidersPublic } from "@/lib/idp-providers";

import { IdentityProviderManager } from "./identity-provider-manager";

export const dynamic = "force-dynamic";

export default async function IdentityProvidersPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/");

  const providers = await listIdpProvidersPublic();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-sky-400" />
        <h1 className="text-[15px] font-medium text-white">Identity providers (SSO)</h1>
      </div>
      <p className="text-[12px] text-zinc-500 -mt-2">
        Configure OpenID Connect (OIDC) providers like Microsoft Entra ID, Google
        Workspace, Okta, or Keycloak. Once enabled, a Sign-in-with button appears on
        the login page. SSO users skip Tainer&apos;s TOTP 2FA — the IdP enforces that upstream.
      </p>

      <SectionPanel>
        <IdentityProviderManager providers={providers} />
      </SectionPanel>
    </div>
  );
}
