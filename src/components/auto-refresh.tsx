"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({
  intervalMs = 60_000,
  eventsSite,
}: {
  intervalMs?: number;
  eventsSite?: string;
}) {
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let source: EventSource | null = null;
    let tick = 0;
    const sseHealthy = { current: false };

    const refreshSoon = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        // Bust server data caches first or the refresh can render data older than the event.
        fetch("/api/revalidate", { method: "POST" })
          .catch(() => {})
          .finally(() => router.refresh());
      }, 300);
    };

    function startInterval() {
      if (timer != null) return;
      timer = setInterval(() => {
        tick++;
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
