import { AuthShell } from "@/components/auth-shell";
import { SetupForm } from "@/components/setup-form";

export default function SetupPage() {
  return (
    <AuthShell>
      <SetupForm />
    </AuthShell>
  );
}
