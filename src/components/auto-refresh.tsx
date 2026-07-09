"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a server-rendered page in sync with live external state.
 *
 * Two modes, composable:
 * - `eventsSite`: subscribe to /api/events for that site and refresh the
 *   moment a guest/node status changes (SSE; the server runs one shared
 *   watcher per site). While the stream is healthy the interval acts only
 *   as a slow safety net.
 * - `intervalMs`: plain periodic refresh — the only mechanism when no
 *   event scope applies (e.g. LLDP pages fed by 60s agent pushes).
 *
 * Both pause while the tab is hidden (saves cycles + spares Tainer/Proxmox
 * background load) and resume on `visibilitychange`.
 */
export function AutoRefresh({
  intervalMs = 60_000,
  eventsSite,
}: {
  intervalMs?: number;
  eventsSite?: string;
}) {
  const router = useRouter();
  // Refresh calls collapse into a trailing-edge debounce so a burst of
  // events (batch operations) doesn't stack re-renders.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let source: EventSource | null = null;
    let tick = 0;
    const sseHealthy = { current: false };

    const refreshSoon = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        // Bust the server-side data caches first — an instant event landing
        // on a cached page (deployments list, dashboard) would otherwise
        // refresh into data older than the change that triggered it.
        fetch("/api/revalidate", { method: "POST" })
          .catch(() => {})
          .finally(() => router.refresh());
      }, 300);
    };

    function startInterval() {
      if (timer != null) return;
      timer = setInterval(() => {
        tick++;
        // With a healthy event stream the interval is only a safety net —
        // skip 3 of 4 ticks so SSE does the work.
        if (sseHealthy.current && tick % 4 !== 0) return;
        router.refresh();
      }, intervalMs);
    }
    function stopInterval() {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    }

    function startEvents() {
      if (!eventsSite || source || typeof EventSource === "undefined") return;
      source = new EventSource(`/api/events?site=${encodeURIComponent(eventsSite)}`);
      source.onopen = () => {
        sseHealthy.current = true;
      };
      source.onmessage = (event) => {
        if (event.data === "changed") refreshSoon();
      };
      source.onerror = () => {
        // Browser auto-reconnects; until it succeeds the interval carries us.
        sseHealthy.current = false;
      };
    }
    function stopEvents() {
      sseHealthy.current = false;
      source?.close();
      source = null;
    }

    function start() {
      startInterval();
      startEvents();
    }
    function stop() {
      stopInterval();
      stopEvents();
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        start();
        // Catch up on anything missed while hidden.
        if (eventsSite) refreshSoon();
      } else {
        stop();
      }
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, eventsSite, router]);

  return null;
}
