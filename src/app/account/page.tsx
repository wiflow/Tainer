import { AccountSettingsPanel } from "@/components/account-settings-panel";
import { SessionManagementCard } from "@/components/session-management-card";
import { redirect } from "next/navigation";

import {
  getAccountSettings,
  getAuthDebugPaths,
  getCurrentSession,
  listCurrentUserSessions,
} from "@/lib/auth";
import { getIdpProviderById } from "@/lib/idp-providers";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const [account, sessions] = await Promise.all([
    getAccountSettings(),
    listCurrentUserSessions(),
  ]);
  const isAdmin = session.user.role === "admin";
  const debugPaths = isAdmin ? await getAuthDebugPaths() : null;

  let ssoProviderName: string | null = null;
  if (account.ssoProviderId) {
    const provider = await getIdpProviderById(account.ssoProviderId);
    ssoProviderName = provider?.name ?? account.ssoProviderId;
  }

  return (
    <div className="space-y-4">
      <AccountSettingsPanel
        account={account}
        passwordResetDebugPath={isAdmin ? debugPaths?.passwordResetDebugPath : undefined}
        smtpConfigured={Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim())}
        ssoProviderName={ssoProviderName}
      />

      <SessionManagementCard sessions={sessions} />
    </div>
  );
}
