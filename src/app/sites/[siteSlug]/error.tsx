"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/error-state";

export default function SiteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[site] Unhandled render error:", error);
  }, [error]);

  return (
    <ErrorState
      backHref="/sites"
      backLabel="All sites"
      description="This page could not load data for the site. The Proxmox API may be unreachable, or the stored credentials may no longer be valid — check the site's connection settings."
      digest={error.digest}
      onRetry={reset}
      title="Couldn't load this site"
    />
  );
}
