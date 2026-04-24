import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/login-form";

type LoginPageProps = {
  searchParams: Promise<{
    reset?: string;
  }>;
};

export default async function LoginPage({
  searchParams,
}: LoginPageProps) {
  const params = await searchParams;

  return (
    <AuthShell>
      <LoginForm resetConfirmed={params.reset === "1"} />
    </AuthShell>
  );
}
