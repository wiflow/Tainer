"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/error-state";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] Unhandled render error:", error);
  }, [error]);

  return (
    <ErrorState
      backHref="/"
      description="This page failed to render. Retrying often clears it — if it doesn't, the reference below appears alongside the full error in the server log."
      digest={error.digest}
      onRetry={reset}
      title="Something went wrong on this page"
    />
  );
}
