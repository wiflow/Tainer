"use client";

import { useEffect, useRef } from "react";
import { trackSiteVisit } from "./site-tracker-action";

export function SiteTracker({ siteSlug }: { siteSlug: string }) {
  const tracked = useRef(false);

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    trackSiteVisit(siteSlug).catch(() => {});
  }, [siteSlug]);

  return null;
}
