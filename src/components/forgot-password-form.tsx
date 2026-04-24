"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Mail, Send } from "lucide-react";

import { requestPasswordResetAction } from "@/app/auth-actions";
import { Button } from "@/components/ui/button";
import { initialBasicActionState } from "@/lib/action-states";
import { cn } from "@/lib/utils";

const inputClassName =
  "mt-1.5 w-full rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3.5 text-[14px] text-zinc-100 outline-none transition-all duration-200 placeholder:text-zinc-600 focus:border-white/[0.15] focus:bg-white/[0.04] focus:shadow-[0_0_0_3px_rgba(255,255,255,0.03)]";

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(
    requestPasswordResetAction,
    initialBasicActionState,
  );

  return (
    <div className="space-y-6">
      <div className="animate-slide-up">
        <h2 className="font-display text-xl font-bold tracking-tight text-zinc-50">
          Forgot password?
        </h2>
        <p className="mt-1.5 text-[13px] text-zinc-500">
          Enter your email and we&apos;ll send reset instructions.
        </p>
      </div>

      {state.message ? (
        <div
          className={cn(
            "animate-slide-down rounded-xl border px-4 py-3 text-[13px]",
            state.status === "error"
              ? "border-rose-500/20 bg-rose-500/[0.06] text-rose-300"
              : "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300",
          )}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </div>
      ) : null}

      <form
        action={formAction}
        className="animate-slide-up space-y-4 [animation-delay:80ms]"
      >
        <label className="block">
          <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
            <Mail className="h-4 w-4 text-zinc-400" />
            Account email
          </span>
          <input className={inputClassName} name="email" placeholder="name@company.com" type="email" />
        </label>

        <Button className="w-full" disabled={isPending} size="lg" type="submit" variant="accent">
          <Send className="h-4 w-4" />
          {isPending ? "Requesting..." : "Send reset instructions"}
        </Button>
      </form>

      <p className="animate-slide-up text-[13px] text-zinc-400 [animation-delay:160ms]">
        Remembered your password?{" "}
        <Link className="text-zinc-400 transition-colors hover:text-zinc-200" href="/login">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
