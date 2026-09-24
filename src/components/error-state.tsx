"use client";

import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

// Next redacts server errors in production; digest matches the container log.
export function ErrorState({
  backHref,
  backLabel = "Back to dashboard",
  description,
  digest,
  onRetry,
  title,
}: {
  backHref?: string;
  backLabel?: string;
  description: string;
  digest?: string;
  onRetry?: () => void;
  title: string;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-white/5 bg-[#111113] p-8 text-center shadow-sm">
        <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-300">
          <AlertTriangle className="size-5" />
        </div>

        <h1 className="mt-4 text-[15px] font-medium text-white">{title}</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500">{description}</p>

        {digest && (
          <p className="mt-4 rounded-md border border-white/5 bg-black/40 px-3 py-2 font-mono text-[11px] text-zinc-500">
            Reference: {digest}
          </p>
        )}

        <div className="mt-6 flex items-center justify-center gap-2">
          {onRetry && (
            <Button onClick={onRetry} size="sm" type="button">
              <RotateCcw className="mr-1.5 size-3.5" />
              Try again
            </Button>
          )}
          {backHref && (
            <Link href={backHref}>
              <Button size="sm" type="button" variant="outline">
                <ArrowLeft className="mr-1.5 size-3.5" />
                {backLabel}
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
