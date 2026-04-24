"use client";

import { Download, KeyRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type DeploymentLocalSshCardProps = {
  downloadHref: string | null;
  fileName: string | null;
  fingerprint: string;
  host: string | null;
  loginUser: string;
  mode: "generated" | "uploaded";
};

export function DeploymentLocalSshCard({
  downloadHref,
  fileName,
  fingerprint,
  host,
  loginUser,
  mode,
}: DeploymentLocalSshCardProps) {
  const sshCommand = host
    ? `ssh -i <downloaded-key-path> ${loginUser}@${host}`
    : null;

  return (
    <Card className="rounded-2xl">
      <CardHeader className="border-b border-white/5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              Local SSH
            </CardTitle>
            <CardDescription className="mt-1">
              Optional SSH material provisioned when this guest was created.
            </CardDescription>
          </div>
          <Badge variant={mode === "generated" ? "info" : "neutral"}>
            {mode === "generated" ? "Generated" : "Public key uploaded"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/5 bg-black/40 p-4">
            <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">Login user</p>
            <p className="mt-2 text-[14px] font-medium text-zinc-100">{loginUser}</p>
          </div>
          <div className="rounded-xl border border-white/5 bg-black/40 p-4">
            <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">Fingerprint</p>
            <p className="mt-2 break-all font-mono text-[12px] text-zinc-300">{fingerprint}</p>
          </div>
        </div>

        {sshCommand ? (
          <div className="rounded-xl border border-white/5 bg-black/40 p-4">
            <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">SSH command</p>
            <code className="mt-2 block break-all text-[12px] text-zinc-200">{sshCommand}</code>
          </div>
        ) : (
          <p className="text-[12px] leading-relaxed text-zinc-500">
            Tainer will show the SSH command once the guest has a reachable IP address.
          </p>
        )}

        {mode === "generated" ? (
          downloadHref ? (
            <a
              className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}
              download={fileName ?? undefined}
              href={downloadHref}
            >
              <Download className="h-3.5 w-3.5" />
              Download private key
            </a>
          ) : (
            <p className="text-[12px] text-zinc-500">
              The generated private key is no longer available for download.
            </p>
          )
        ) : (
          <p className="text-[12px] text-zinc-500">
            Tainer only stored the public key fingerprint for this deployment, not the private key.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
