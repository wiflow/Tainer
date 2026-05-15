"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Soft 60-second auto-refresh for LLDP pages. Aligned with the agent's
 * `OnUnitActiveSec=60s` push cadence — refreshing faster than that would
 * spend cycles re-fetching identical data because the source-of-truth
 * snapshots only change once per minute.
 *
 * Pauses while the tab is hidden (saves cycles + spares Tainer/Proxmox
 * background load when an operator leaves the page open). Resumes on
 * `visibilitychange`.
 */
export function NetworkAutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    function start() {
      if (timer != null) return;
      timer = setInterval(() => {
        router.refresh();
      }, intervalMs);
    }
    function stop() {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    }
    function onVisibility() {
      if (document.visibilityState === "visible") start();
      else stop();
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, router]);

  return null;
}
