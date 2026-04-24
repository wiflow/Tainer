"use client";

import { useCallback, useState } from "react";
import { Loader2, ShieldCheck, TerminalSquare } from "lucide-react";

import { useTaskToasts } from "@/components/task-toast-provider";
import { VmConsole } from "@/components/vm-console";
import { XtermConsole } from "@/components/xterm-console";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type GuestConsolePanelProps = {
  deploymentId: string;
  guestType: "lxc" | "qemu";
  hasFreshStepUp: boolean;
  hasTwoFactor: boolean;
  rawStatus: string;
};

export function GuestConsolePanel({
  deploymentId,
  guestType,
  hasFreshStepUp,
  hasTwoFactor,
  rawStatus,
}: GuestConsolePanelProps) {
  const { pushToast } = useTaskToasts();
  const [code, setCode] = useState("");
  const [stepUpPending, setStepUpPending] = useState(false);
  const [unlocked, setUnlocked] = useState(hasFreshStepUp);

  const isRunning = rawStatus === "running";

  const unlockConsole = useCallback(async () => {
    setStepUpPending(true);

    try {
      const response = await fetch("/api/guest-access/step-up", {
        body: JSON.stringify({ code }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = (await response.json()) as { error?: string; success?: boolean };

      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      setUnlocked(true);
      setCode("");
      pushToast({
        message: "Your fresh 2FA check is valid for opening a Proxmox console session.",
        title: "Console access unlocked",
        variant: "success",
      });
    } catch (error) {
      pushToast({
        message: error instanceof Error ? error.message : "Could not verify the authenticator code.",
        title: "2FA verification failed",
        variant: "error",
      });
    } finally {
      setStepUpPending(false);
    }
  }, [code, pushToast]);

  return (
    <Card className="rounded-2xl">
      <CardHeader className="border-b border-white/5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TerminalSquare className="h-4 w-4" />
              {guestType === "qemu" ? "VM Console" : "Container Console"}
            </CardTitle>
            <CardDescription className="mt-1">
              Tainer now opens the native Proxmox console path instead of brokering shell access through the guest.
            </CardDescription>
          </div>
          <Badge variant={isRunning ? "success" : "warning"}>
            {isRunning ? "Ready" : "Stopped"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        <p className="text-[12px] leading-relaxed text-zinc-500">
          {isRunning
            ? guestType === "qemu"
              ? "This session uses Proxmox noVNC for direct VM console access."
              : "This session uses Proxmox's native terminal proxy for direct container shell access."
            : guestType === "qemu"
              ? "Start the VM before opening its console."
              : "Start the container before opening its terminal."}
        </p>

        {!isRunning ? null : unlocked ? (
          guestType === "lxc"
            ? <XtermConsole deploymentId={deploymentId} />
            : <VmConsole deploymentId={deploymentId} guestType={guestType} />
        ) : hasTwoFactor ? (
          <div className="space-y-3 rounded-xl border border-white/5 bg-black/40 p-4">
            <div className="flex items-center gap-2 text-zinc-300">
              <ShieldCheck className="h-4 w-4 text-zinc-400" />
              <p className="text-[13px] font-medium">Fresh 2FA check required</p>
            </div>
            <p className="text-[12px] leading-relaxed text-zinc-500">
              Enter your authenticator code or a recovery code before Tainer requests a short-lived Proxmox console ticket for this deployment.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                autoComplete="one-time-code"
                className="w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500"
                inputMode="text"
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456 or XXXX-XXXX"
                type="text"
                value={code}
              />
              <Button
                disabled={stepUpPending || code.trim().length === 0}
                onClick={unlockConsole}
                type="button"
              >
                {stepUpPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                {stepUpPending ? "Verifying..." : "Unlock console"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-[13px] text-amber-200">
            Enable 2FA on your Tainer account before opening in-app console sessions.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
