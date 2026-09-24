"use client";

import { useEffect } from "react";

// Inline styles only: globals.css is loaded by the root layout, which is what failed.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] Root layout error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          alignItems: "center",
          background: "#09090b",
          color: "#e4e4e7",
          display: "flex",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          justifyContent: "center",
          margin: 0,
          minHeight: "100vh",
        }}
      >
        <div
          style={{
            background: "#111113",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12,
            maxWidth: 420,
            padding: 32,
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>Tainer failed to start</h1>
          <p style={{ color: "#71717a", fontSize: 13, lineHeight: 1.6, marginTop: 8 }}>
            The application shell could not render. This usually means the server is
            misconfigured or a required service is unreachable. Check the container log.
          </p>
          {error.digest && (
            <p
              style={{
                background: "rgba(0,0,0,0.4)",
                borderRadius: 6,
                color: "#71717a",
                fontFamily: "ui-monospace, monospace",
                fontSize: 11,
                marginTop: 16,
                padding: "8px 12px",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={() => reset()}
            style={{
              background: "#27272a",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              color: "#e4e4e7",
              cursor: "pointer",
              fontSize: 13,
              marginTop: 24,
              padding: "8px 16px",
            }}
            type="button"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
