"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 15_000;

export function LiveRefresh({ version }: { version: string | null }) {
  const router = useRouter();
  const [secondsAgo, setSecondsAgo] = useState(0);
  const visibleRef = useRef(true);

  const handleVisibilityChange = useCallback(() => {
    const wasHidden = !visibleRef.current;
    visibleRef.current = document.visibilityState === "visible";

    // Refresh immediately when user returns to tab after being away
    if (visibleRef.current && wasHidden) {
      router.refresh();
      setSecondsAgo(0);
    }
  }, [router]);

  useEffect(() => {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [handleVisibilityChange]);

  useEffect(() => {
    const tick = setInterval(() => {
      if (visibleRef.current) {
        setSecondsAgo((prev) => prev + 1);
      }
    }, 1_000);

    const refresh = setInterval(() => {
      if (visibleRef.current) {
        router.refresh();
        setSecondsAgo(0);
      }
    }, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [router]);

  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      <span className="text-[13px] font-medium text-zinc-200">
        {version ? `Proxmox ${version}` : "Cluster"}
      </span>
      <span className="hidden items-center gap-1.5 sm:flex">
        <span className="h-3.5 w-px bg-zinc-800" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400/70">
          Live
        </span>
        <span className="text-[11px] tabular-nums text-zinc-500">
          {secondsAgo < 3 ? "now" : `${secondsAgo}s ago`}
        </span>
      </span>
    </div>
  );
}
