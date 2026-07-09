import "server-only";

import { getClusterStatusFingerprint, withSiteConfig } from "@/lib/proxmox";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

/**
 * Per-site change watcher behind the /api/events SSE stream. One upstream
 * poll loop per site regardless of how many browsers are connected: while a
 * site has subscribers, the cluster's status fingerprint is polled every few
 * seconds and a change notification is fanned out to every subscriber. The
 * loop stops as soon as the last subscriber disconnects, so an idle Tainer
 * costs Proxmox nothing.
 */

const POLL_INTERVAL_MS = 4_000;

type SiteWatcher = {
  subscribers: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
  fingerprint: string | null;
  polling: boolean;
};

const globalForEvents = globalThis as typeof globalThis & {
  __tainerLiveEvents?: Map<string, SiteWatcher>;
};

function getWatchers(): Map<string, SiteWatcher> {
  if (!globalForEvents.__tainerLiveEvents) {
    globalForEvents.__tainerLiveEvents = new Map();
  }
  return globalForEvents.__tainerLiveEvents;
}

async function poll(siteSlug: string, watcher: SiteWatcher) {
  if (watcher.polling) return;
  watcher.polling = true;
  try {
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    const fingerprint = await withSiteConfig(siteConfig, () =>
      getClusterStatusFingerprint(),
    );
    if (watcher.fingerprint !== null && fingerprint !== watcher.fingerprint) {
      for (const notify of watcher.subscribers) {
        try {
          notify();
        } catch {
          // A broken subscriber must not stop the fan-out.
        }
      }
    }
    watcher.fingerprint = fingerprint;
  } catch {
    // Proxmox unreachable — keep the last fingerprint and retry next tick.
  } finally {
    watcher.polling = false;
  }
}

export function subscribeToSiteEvents(
  siteSlug: string,
  onChange: () => void,
): () => void {
  const watchers = getWatchers();
  let watcher = watchers.get(siteSlug);
  if (!watcher) {
    watcher = { subscribers: new Set(), timer: null, fingerprint: null, polling: false };
    watchers.set(siteSlug, watcher);
  }
  watcher.subscribers.add(onChange);

  if (!watcher.timer) {
    const created = watcher;
    created.timer = setInterval(() => {
      void poll(siteSlug, created);
    }, POLL_INTERVAL_MS);
    // Prime the fingerprint immediately so the first real change is caught.
    void poll(siteSlug, created);
  }

  return () => {
    watcher.subscribers.delete(onChange);
    if (watcher.subscribers.size === 0) {
      if (watcher.timer) clearInterval(watcher.timer);
      watcher.timer = null;
      watcher.fingerprint = null;
      getWatchers().delete(siteSlug);
    }
  };
}
