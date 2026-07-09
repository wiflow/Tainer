"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Soft periodic auto-refresh for pages showing live external state. Drop it
 * into a server-component page and the router re-fetches on the given
 * interval, so state changes that happen outside the app (or lag behind an
 * action, like Proxmox status propagation) surface without a manual reload.
 *
 * Pick an interval matched to how fast the source of truth actually changes —
 * e.g. 15s for Proxmox guest status, 60s for LLDP snapshots that agents only
 * push once a minute.
 *
 * Pauses while the tab is hidden (saves cycles + spares Tainer/Proxmox
 * background load when an operator leaves the page open). Resumes on
 * `visibilitychange`.
 */
export function AutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
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
