import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/login-form";
import { listLoginIdpButtons } from "@/lib/idp-providers";

type LoginPageProps = {
  searchParams: Promise<{
    reset?: string;
    sso_error?: string;
    two_factor?: string;
  }>;
};

export default async function LoginPage({
  searchParams,
}: LoginPageProps) {
  const params = await searchParams;
  const ssoProviders = await listLoginIdpButtons();

  return (
    <AuthShell>
      <LoginForm
        resetConfirmed={params.reset === "1"}
        ssoError={params.sso_error}
        ssoProviders={ssoProviders}
        twoFactorPending={params.two_factor === "1"}
      />
    </AuthShell>
  );
}
