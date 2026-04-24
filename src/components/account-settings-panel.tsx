"use client";

import { useActionState, useEffect, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  Mail,
  RefreshCcw,
  Scan,
  ShieldCheck,
  ShieldOff,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";

import type { ManagedUserSummary } from "@/lib/auth";
import {
  changePasswordAction,
  confirmTwoFactorSetupAction,
  disableTwoFactorAction,
  requestPasswordResetFromAccountAction,
  startTwoFactorSetupAction,
  updateProfileAction,
} from "@/app/auth-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { SectionPanel } from "@/components/ui/section-panel";
import { Form } from "@/components/ui/form";
import {
  initialBasicActionState,
  initialTwoFactorSetupActionState,
} from "@/lib/action-states";

const inputClassName =
  "mt-1.5 w-full rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 text-[13px] text-zinc-200 outline-none transition-all duration-200 placeholder:text-zinc-600 focus:border-white/[0.15] focus:bg-white/[0.04] focus:shadow-[0_0_0_3px_rgba(255,255,255,0.03)]";

function useRefreshOnSuccess(status: string) {
  const router = useRouter();

  useEffect(() => {
    if (status === "success") {
      router.refresh();
    }
  }, [router, status]);
}

function CopyRecoveryCodesButton({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[12px] font-medium text-emerald-300 transition-all duration-200 hover:bg-emerald-500/15"
      onClick={() => {
        navigator.clipboard.writeText(codes.join("\n"));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      type="button"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? "Copied!" : "Copy all"}
    </button>
  );
}

export function AccountSettingsPanel({
  account,
  passwordResetDebugPath,
  smtpConfigured,
}: {
  account: {
    createdAt: string;
    email: string;
    hasTwoFactor: boolean;
    name: string;
    role: string;
    twoFactorUpdatedAt: string | null;
  };
  passwordResetDebugPath?: string;
  smtpConfigured: boolean;
  users?: ManagedUserSummary[];
}) {
  const [profileState, profileAction, profilePending] = useActionState(
    updateProfileAction,
    initialBasicActionState,
  );
  const [passwordState, passwordAction, passwordPending] = useActionState(
    changePasswordAction,
    initialBasicActionState,
  );
  const [startTwoFactorState, startTwoFactorAction, startTwoFactorPending] = useActionState(
    startTwoFactorSetupAction,
    initialTwoFactorSetupActionState,
  );
  const [confirmTwoFactorState, confirmTwoFactorAction, confirmTwoFactorPending] =
    useActionState(confirmTwoFactorSetupAction, initialTwoFactorSetupActionState);
  const [disableTwoFactorState, disableTwoFactorActionForm, disableTwoFactorPending] =
    useActionState(disableTwoFactorAction, initialBasicActionState);
  const [resetState, resetAction, resetPending] = useActionState(
    requestPasswordResetFromAccountAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(profileState, {
    errorTitle: "Profile update failed",
    successTitle: "Profile updated",
  });
  useActionFlashFeedback(passwordState, {
    errorTitle: "Password update failed",
    successTitle: "Password updated",
  });
  useActionFlashFeedback(startTwoFactorState, {
    errorTitle: "2FA setup failed",
    successTitle: "2FA setup started",
  });
  useActionFlashFeedback(confirmTwoFactorState, {
    errorTitle: "2FA confirmation failed",
    successTitle: "2FA enabled",
  });
  useActionFlashFeedback(disableTwoFactorState, {
    errorTitle: "2FA disable failed",
    successTitle: "2FA disabled",
  });
  useActionFlashFeedback(resetState, {
    errorTitle: "Password reset failed",
    successTitle: "Password reset requested",
  });

  useRefreshOnSuccess(profileState.status);
  useRefreshOnSuccess(disableTwoFactorState.status);

  const effectiveHasTwoFactor = account.hasTwoFactor || confirmTwoFactorState.recoveryCodes.length > 0;
  const activeTwoFactorSetup =
    startTwoFactorState.qrCodeDataUrl && confirmTwoFactorState.recoveryCodes.length === 0
      ? startTwoFactorState
      : null;

  return (
    <div className="space-y-4">
      {/* ── Account info strip ── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Account", value: account.name },
          { label: "Role", value: account.role },
          { label: "Email", value: account.email },
          {
            label: "2FA",
            value: effectiveHasTwoFactor ? "Enabled" : "Optional",
            accent: effectiveHasTwoFactor,
          },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-white/5 bg-[#111113] px-4 py-4"
          >
            <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
              {item.label}
            </p>
            <div className="mt-3 flex items-center gap-2">
              {"accent" in item && item.accent ? (
                <span className="flex h-2 w-2 items-center justify-center rounded-full bg-emerald-400" />
              ) : null}
              <p className="text-[15px] font-medium text-zinc-100">{item.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Profile & Password ── */}
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <SectionPanel title="Profile" description="Update the name shown in the Tainer workspace sidebar and account views.">
            <Form action={profileAction} className="space-y-4">
              <label className="block">
                <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
                  <UserRound className="h-4 w-4 text-zinc-500" />
                  Display name
                </span>
                <input className={inputClassName} defaultValue={account.name} name="name" />
              </label>

              <div className="rounded-xl border border-white/5 bg-[#111113] px-4 py-3 text-[12px] text-zinc-500">
                Created {new Date(account.createdAt).toLocaleString()}
              </div>

              <Button disabled={profilePending} type="submit" variant="secondary">
                {profilePending ? "Saving..." : "Save profile"}
              </Button>
            </Form>
        </SectionPanel>

        <SectionPanel title="Password" description="Change your password and invalidate all other active sessions.">
            <Form action={passwordAction} className="space-y-4">
              <label className="block">
                <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
                  <KeyRound className="h-4 w-4 text-zinc-500" />
                  Current password
                </span>
                <input className={inputClassName} name="currentPassword" type="password" />
              </label>

              <label className="block">
                <span className="text-[13px] font-medium text-zinc-300">New password</span>
                <input className={inputClassName} name="nextPassword" type="password" />
              </label>

              <label className="block">
                <span className="text-[13px] font-medium text-zinc-300">Confirm new password</span>
                <input className={inputClassName} name="confirmPassword" type="password" />
              </label>

              <Button disabled={passwordPending} type="submit" variant="secondary">
                {passwordPending ? "Updating..." : "Update password"}
              </Button>
            </Form>
        </SectionPanel>
      </div>

      {/* ── Two-factor authentication ── */}
      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <SectionPanel title="Two-factor authentication" description="Add authenticator-app based TOTP for stronger sign-in protection.">
          <div className="space-y-5">
            {/* ── Status indicator ── */}
            <div className="flex items-center gap-4 rounded-xl border border-white/5 bg-[#111113] px-4 py-4">
              <div
                className={
                  effectiveHasTwoFactor
                    ? "flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10"
                    : "flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-zinc-800"
                }
              >
                <ShieldCheck
                  className={
                    effectiveHasTwoFactor
                      ? "h-4.5 w-4.5 text-emerald-400"
                      : "h-4.5 w-4.5 text-zinc-500"
                  }
                />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-zinc-200">
                  {effectiveHasTwoFactor ? "2FA is enabled" : "2FA is not enabled"}
                </p>
                <p className="mt-0.5 text-[12px] text-zinc-500">
                  {effectiveHasTwoFactor && account.twoFactorUpdatedAt
                    ? `Last updated ${new Date(account.twoFactorUpdatedAt).toLocaleString()}`
                    : "You can enable 2FA at any time from this page."}
                </p>
              </div>
            </div>

            {!account.hasTwoFactor ? (
              <>
                <Form action={startTwoFactorAction}>
                  <Button
                    disabled={startTwoFactorPending}
                    type="submit"
                    variant="accent"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {startTwoFactorPending ? "Preparing..." : "Start 2FA setup"}
                  </Button>
                </Form>

                {/* ── Step-by-step setup flow ── */}
                {activeTwoFactorSetup ? (
                  <div className="space-y-5 rounded-2xl border border-white/[0.06] bg-white/[0.015] p-5">
                    {/* Step 1: Scan */}
                    <div className="flex items-start gap-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-600 bg-zinc-800 text-[11px] font-bold text-zinc-300">
                        1
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-zinc-200">
                          Scan with your authenticator app
                        </p>
                        <p className="mt-1 text-[12px] text-zinc-500">
                          Use Google Authenticator, Authy, or any TOTP-compatible app.
                        </p>
                      </div>
                    </div>

                    <div className="ml-9 grid gap-5 lg:grid-cols-[200px_1fr]">
                      <div className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white p-3 shadow-lg shadow-black/20">
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                          <div className="rounded-lg bg-black/60 px-2 py-1 text-[10px] font-medium text-white backdrop-blur">
                            <Scan className="mr-1 inline h-3 w-3" />
                            Scan me
                          </div>
                        </div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          alt="Authenticator QR code"
                          className="mx-auto h-auto w-full"
                          src={activeTwoFactorSetup.qrCodeDataUrl}
                        />
                      </div>

                      <div className="space-y-3">
                        <div>
                          <p className="text-[12px] font-medium text-zinc-400">
                            Manual entry key
                          </p>
                          <p className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 font-mono text-[13px] tracking-wider text-zinc-300">
                            {activeTwoFactorSetup.manualEntryKey}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Step 2: Verify */}
                    <div className="flex items-start gap-3 border-t border-white/[0.06] pt-5">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-600 bg-zinc-800 text-[11px] font-bold text-zinc-300">
                        2
                      </div>
                      <div className="min-w-0 flex-1 space-y-3">
                        <p className="text-[13px] font-semibold text-zinc-200">
                          Verify with a 6-digit code
                        </p>
                        <Form action={confirmTwoFactorAction} className="flex items-end gap-3">
                          <label className="block flex-1">
                            <span className="text-[12px] text-zinc-500">
                              Enter the code from your app
                            </span>
                            <input
                              className={inputClassName}
                              inputMode="numeric"
                              name="code"
                              placeholder="123456"
                            />
                          </label>
                          <Button
                            className="shrink-0"
                            disabled={confirmTwoFactorPending}
                            type="submit"
                            variant="accent"
                          >
                            {confirmTwoFactorPending ? "Verifying..." : "Enable 2FA"}
                          </Button>
                        </Form>
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* ── Recovery codes ── */}
                {confirmTwoFactorState.recoveryCodes.length > 0 ? (
                  <div className="animate-slide-up rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.04] p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20">
                            <Check className="h-3 w-3 text-emerald-400" />
                          </div>
                          <p className="text-[13px] font-semibold text-emerald-200">
                            Recovery codes
                          </p>
                        </div>
                        <p className="mt-2 text-[12px] leading-relaxed text-emerald-300/60">
                          Save these now. Each code can be used once if you lose access
                          to your authenticator app.
                        </p>
                      </div>
                      <CopyRecoveryCodesButton codes={confirmTwoFactorState.recoveryCodes} />
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {confirmTwoFactorState.recoveryCodes.map((code) => (
                        <div
                          key={code}
                          className="rounded-lg border border-emerald-500/10 bg-zinc-950/60 px-3 py-2.5 text-center font-mono text-[13px] font-medium tracking-wider text-emerald-100"
                        >
                          {code}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <Form action={disableTwoFactorActionForm} className="space-y-4">
                <label className="block">
                  <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-300">
                    <ShieldOff className="h-4 w-4 text-zinc-500" />
                    Current password to disable 2FA
                  </span>
                  <input className={inputClassName} name="currentPassword" type="password" />
                </label>

                <Button disabled={disableTwoFactorPending} type="submit" variant="danger">
                  {disableTwoFactorPending ? "Disabling..." : "Disable 2FA"}
                </Button>
              </Form>
            )}
          </div>
        </SectionPanel>

        <SectionPanel title="Password reset delivery" description="Generate a fresh password reset link for your own account.">
            <div className="space-y-4">
              <div className="rounded-xl border border-white/5 bg-[#111113] px-4 py-4">
                <p className="flex items-center gap-2 text-[13px] font-medium text-zinc-200">
                  <Mail className="h-4 w-4 text-zinc-500" />
                  Delivery method
                </p>
                <p className="mt-2 text-[13px] text-zinc-400">
                  {smtpConfigured
                    ? "SMTP is configured, so reset links can be emailed directly."
                    : "SMTP is not configured yet. Reset links are still generated and written to the local server debug file."}
                </p>
                {!smtpConfigured && passwordResetDebugPath ? (
                  <p className="mt-3 rounded-xl border border-white/5 bg-black/40 px-3 py-3 font-mono text-[12px] text-zinc-400">
                    {passwordResetDebugPath}
                  </p>
                ) : null}
              </div>

              <Form action={resetAction}>
                <Button disabled={resetPending} type="submit" variant="secondary">
                  <RefreshCcw className="h-4 w-4" />
                  {resetPending ? "Generating..." : "Generate reset link"}
                </Button>
              </Form>
            </div>
        </SectionPanel>
      </div>
    </div>
  );
}
