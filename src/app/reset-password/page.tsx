import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { validatePasswordResetToken } from "@/lib/auth";

type ResetPasswordPageProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = params.token?.trim() ?? "";
  const user = token ? await validatePasswordResetToken(token) : null;

  return (
    <AuthShell>
      {user ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="space-y-4">
          <h2 className="font-display text-xl font-bold tracking-tight text-zinc-50">
            Link expired
          </h2>
          <p className="text-[13px] text-zinc-500">
            This reset link is invalid or has expired. Request a new one to continue.
          </p>
          <Link
            className="inline-flex items-center justify-center rounded-md border border-white/10 bg-zinc-800 px-4 py-2 text-[13px] font-medium text-zinc-100 transition-colors hover:bg-zinc-700"
            href="/forgot-password"
          >
            Request a new link
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
