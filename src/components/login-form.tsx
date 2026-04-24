"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowRight, LockKeyhole, Shield, UserRound } from "lucide-react";

import { loginAction } from "@/app/auth-actions";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { initialLoginActionState } from "@/lib/action-states";
import { cn } from "@/lib/utils";

const inputClassName =
  "mt-1.5 w-full rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3.5 text-[14px] text-zinc-100 outline-none transition-all duration-200 placeholder:text-zinc-600 focus:border-white/[0.15] focus:bg-white/[0.04] focus:shadow-[0_0_0_3px_rgba(255,255,255,0.03)]";

export function LoginForm({
  resetConfirmed = false,
}: {
  resetConfirmed?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    loginAction,
    initialLoginActionState,
  );

  return (
    <div className="space-y-6">
      <div className="animate-slide-up">
        <h2 className="font-display text-xl font-bold tracking-tight text-zinc-50">
          Sign in
        </h2>
        <p className="mt-1.5 text-[13px] text-zinc-500">
          Enter your credentials to continue.
        </p>
      </div>

      {resetConfirmed ? (
        <div className="animate-slide-down rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3 text-[13px] text-emerald-300">
          Your password has been reset. Sign in with the new one.
        </div>
      ) : null}

      {state.message ? (
        <div
          className={cn(
            "animate-slide-down rounded-xl border px-4 py-3 text-[13px]",
            state.status === "error"
              ? "border-rose-500/20 bg-rose-500/[0.06] text-rose-300"
              : "border-sky-500/20 bg-sky-500/[0.06] text-sky-200",
          )}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </div>
      ) : null}

      <Form
        action={formAction}
        className="animate-slide-up space-y-4 [animation-delay:80ms]"
      >
        {state.requiresTwoFactor ? (
          <label className="block">
            <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
              <Shield className="h-4 w-4 text-zinc-400" />
              Authenticator code or recovery code
            </span>
            <input
              autoComplete="one-time-code"
              className={inputClassName}
              inputMode="text"
              name="twoFactorCode"
              placeholder="123456 or XXXX-XXXX"
            />
          </label>
        ) : (
          <>
            <label className="block">
              <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
                <UserRound className="h-4 w-4 text-zinc-400" />
                Email
              </span>
              <input
                autoComplete="email"
                className={inputClassName}
                name="email"
                placeholder="name@company.com"
                type="email"
              />
            </label>

            <label className="block">
              <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
                <LockKeyhole className="h-4 w-4 text-zinc-400" />
                Password
              </span>
              <input
                autoComplete="current-password"
                className={inputClassName}
                name="password"
                placeholder="Your password"
                type="password"
              />
            </label>
          </>
        )}

        <Button
          className="w-full"
          disabled={isPending}
          size="lg"
          type="submit"
          variant="accent"
        >
          {isPending
            ? state.requiresTwoFactor
              ? "Verifying..."
              : "Signing in..."
            : state.requiresTwoFactor
              ? "Verify code"
              : "Sign in"}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </Form>

      <div className="animate-slide-up text-center text-[13px] [animation-delay:160ms]">
        <Link
          className="text-zinc-500 transition-colors hover:text-zinc-300"
          href="/forgot-password"
        >
          Forgot your password?
        </Link>
      </div>
    </div>
  );
}
