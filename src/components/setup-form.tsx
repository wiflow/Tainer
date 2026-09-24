"use client";

import { useActionState, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  KeyRound,
  Link2,
  Lock,
  Mail,
  Server,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { bootstrapWorkspaceAction, validateSiteConnectionAction } from "@/app/site-actions";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import { cn } from "@/lib/utils";

const inputClassName =
  "mt-1.5 w-full rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3.5 text-[14px] text-zinc-100 outline-none transition-all duration-200 placeholder:text-zinc-600 focus:border-white/[0.15] focus:bg-white/[0.04] focus:shadow-[0_0_0_3px_rgba(255,255,255,0.03)]";

export function SetupForm() {
  const [step, setStep] = useState<1 | 2>(1);
  const [redirecting, setRedirecting] = useState(false);

  const [bootstrapState, bootstrapAction, isBootstrapping] = useActionState(
    bootstrapWorkspaceAction,
    initialBasicActionState,
  );

  const [testState, testAction, isTesting] = useActionState(
    validateSiteConnectionAction,
    initialBasicActionState,
  );

  useEffect(() => {
    if (bootstrapState.status === "redirect") {
      setRedirecting(true);
      const target = bootstrapState.message ? `/sites/${bootstrapState.message}` : "/";
      fetch(target, { credentials: "include" })
        .finally(() => { window.location.href = target; });
    }
  }, [bootstrapState.status, bootstrapState.requestId, bootstrapState.message]);

  if (redirecting) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
        <p className="text-[14px] text-zinc-400">Setting up your workspace...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold",
            step === 1
              ? "bg-white/[0.1] text-zinc-100"
              : "bg-white/[0.04] text-zinc-500",
          )}
        >
          1
        </div>
        <div className="h-px flex-1 bg-white/[0.06]" />
        <div
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold",
            step === 2
              ? "bg-white/[0.1] text-zinc-100"
              : "bg-white/[0.04] text-zinc-500",
          )}
        >
          2
        </div>
      </div>

      <Form action={bootstrapAction} className="space-y-6">
        <div className={step === 1 ? "animate-slide-up space-y-6" : "hidden"}>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-zinc-50">
              Create the first administrator
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
              This account becomes the initial admin for the Tainer workspace.
            </p>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
                <UserRound className="h-4 w-4 text-zinc-400" />
                Full name
              </span>
              <input className={inputClassName} name="name" placeholder="Jane Admin" />
            </label>

            <label className="block">
              <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
                <Mail className="h-4 w-4 text-zinc-400" />
                Email
              </span>
              <input className={inputClassName} name="email" placeholder="admin@company.com" type="email" />
            </label>

            <label className="block">
              <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
                <KeyRound className="h-4 w-4 text-zinc-400" />
                Password
              </span>
              <input className={inputClassName} name="password" placeholder="Enter a password" type="password" />
              <span className="mt-1 block text-[12px] text-zinc-400">At least 12 characters</span>
            </label>

            <label className="block">
              <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
                <ShieldCheck className="h-4 w-4 text-zinc-400" />
                Confirm password
              </span>
              <input className={inputClassName} name="confirmPassword" placeholder="Repeat the password" type="password" />
            </label>

            <Button className="w-full" onClick={() => setStep(2)} size="lg" type="button" variant="accent">
              Continue to site setup
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className={step === 2 ? "animate-slide-up space-y-6" : "hidden"}>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-zinc-50">
              Connect your first Proxmox cluster
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
              Provide the login credentials for your Proxmox VE server.
            </p>
          </div>

          {(bootstrapState.status === "error" || testState.message) && (
            <div
              className={cn(
                "animate-slide-down rounded-xl border px-4 py-3 text-[13px]",
                bootstrapState.status === "error"
                  ? "border-rose-500/20 bg-rose-500/[0.06] text-rose-300"
                  : testState.status === "error"
                    ? "border-rose-500/20 bg-rose-500/[0.06] text-rose-300"
                    : "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300",
              )}
              role={bootstrapState.status === "error" || testState.status === "error" ? "alert" : "status"}
            >
              {bootstrapState.status === "error"
                ? bootstrapState.message
                : testState.message}
            </div>
          )}

          <div className="space-y-4">
            <label className="block">
              <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
                <Globe className="h-4 w-4 text-zinc-400" />
                Site name
              </span>
              <input className={inputClassName} name="siteName" placeholder="Production" />
            </label>

            <label className="block">
              <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
                <Link2 className="h-4 w-4 text-zinc-400" />
                Proxmox API URL
              </span>
              <input className={inputClassName} name="apiUrl" placeholder="https://proxmox.example.com:8006" />
            </label>

            <label className="block">
              <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
                <KeyRound className="h-4 w-4 text-zinc-400" />
                Proxmox username
              </span>
              <input className={inputClassName} name="username" placeholder="root@pam" />
            </label>

            <label className="block">
              <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
                <Lock className="h-4 w-4 text-zinc-400" />
                Proxmox password
              </span>
              <input className={inputClassName} name="pvePassword" type="password" />
            </label>

            <label className="block">
              <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
                <Server className="h-4 w-4 text-zinc-400" />
                Default node
              </span>
              <input className={inputClassName} name="defaultNode" placeholder="pve" />
            </label>

            <div className="flex items-center gap-3">
              <input
                className="h-4 w-4 rounded border-white/[0.1] bg-white/[0.02]"
                id="tlsInsecure"
                name="tlsMode"
                type="checkbox"
                value="insecure"
              />
              <label className="text-[13px] text-zinc-400" htmlFor="tlsInsecure">
                Skip TLS certificate validation (self-signed certs)
              </label>
            </div>

            <div className="flex gap-3">
              <Button
                className="flex-1"
                onClick={() => setStep(1)}
                size="lg"
                type="button"
                variant="secondary"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                className="flex-1"
                disabled={isBootstrapping}
                size="lg"
                type="submit"
                variant="accent"
              >
                {isBootstrapping ? "Initializing..." : "Initialize workspace"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </Form>
    </div>
  );
}
