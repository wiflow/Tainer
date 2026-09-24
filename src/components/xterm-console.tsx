"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Monitor, RotateCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

type TermTicketResponse = {
  kind: "term";
  ticket: string;
  user: string;
  websocketUrl: string;
};

function utf8ByteLength(str: string): number {
  return new Blob([str]).size;
}

export function XtermConsole({
  deploymentId,
}: {
  deploymentId: string;
}) {
  const termRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connectKey, setConnectKey] = useState(0);

  useEffect(() => {
    const container = termRef.current;
    if (!container) return;

    let disposed = false;
    let ws: WebSocket | undefined;
    let term: import("@xterm/xterm").Terminal | undefined;
    let pingInterval: ReturnType<typeof setInterval> | undefined;

    async function init() {
      try {
        setState("connecting");
        setErrorMessage(null);

        const ticketResponse = await fetch(
          `/api/proxmox/console-ticket?deploymentId=${encodeURIComponent(deploymentId)}`,
          { cache: "no-store" },
        );
        const payload = (await ticketResponse.json()) as
          | ({ error?: string } & Partial<TermTicketResponse>)
          | undefined;

        if (!ticketResponse.ok || !payload || payload.kind !== "term" || !payload.websocketUrl) {
          throw new Error(payload?.error || "Failed to start the terminal session.");
        }

        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
        ]);

        if (disposed) return;

        term = new Terminal({
          cursorBlink: true,
          fontSize: 14,
          fontFamily: "'Cascadia Code', 'Fira Code', 'Menlo', monospace",
          theme: {
            background: "#09090b",
            foreground: "#e4e4e7",
            cursor: "#e4e4e7",
            selectionBackground: "#3f3f46",
          },
          scrollback: 5000,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(container!);
        fitAddon.fit();

        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${location.host}${payload.websocketUrl}`;
        ws = new WebSocket(wsUrl);
        ws.binaryType = "arraybuffer";

        const user = payload.user;
        const ticket = payload.ticket;

        ws.onopen = () => {
          if (disposed) return;
          // Termproxy requires the trailing newline after "user:ticket".
          ws?.send(`${user}:${ticket}\n`);
        };

        let authenticated = false;

        ws.onmessage = (event) => {
          if (disposed || !term) return;

          const raw = typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(event.data);

          if (!authenticated) {
            if (raw === "OK") {
              authenticated = true;
              setState("connected");
              term.focus();

              ws?.send(`1:${term.cols}:${term.rows}:`);

              // Termproxy closes idle sessions after 5 minutes.
              pingInterval = setInterval(() => {
                if (ws?.readyState === WebSocket.OPEN) {
                  ws.send("2");
                }
              }, 30_000);
            }
            return;
          }

          term.write(raw);
        };

        ws.onclose = () => {
          if (disposed) return;
          setState("disconnected");
        };

        ws.onerror = () => {
          if (disposed) return;
          setErrorMessage("WebSocket connection failed.");
          setState("error");
        };

        term.onData((data) => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(`0:${utf8ByteLength(data)}:${data}`);
          }
        });

        term.onResize(({ cols, rows }) => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(`1:${cols}:${rows}:`);
          }
        });

        const resizeObserver = new ResizeObserver(() => {
          fitAddon.fit();
        });
        resizeObserver.observe(container!);

      } catch (error) {
        if (!disposed) {
          setErrorMessage(error instanceof Error ? error.message : "Could not open terminal.");
          setState("error");
        }
      }
    }

    void init();

    return () => {
      disposed = true;
      if (pingInterval) clearInterval(pingInterval);
      ws?.close();
      term?.dispose();
    };
  }, [connectKey, deploymentId]);

  const reconnect = useCallback(() => {
    setConnectKey((key) => key + 1);
  }, []);

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/5 bg-zinc-950">
      {state !== "connected" ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-zinc-950/90 px-6 text-center backdrop-blur-sm">
          {state === "connecting" ? (
            <>
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/10 border-t-zinc-300" />
              <p className="text-[13px] text-zinc-400">Connecting to Proxmox terminal...</p>
            </>
          ) : null}
          {state === "disconnected" ? (
            <>
              <X className="h-5 w-5 text-zinc-500" />
              <p className="text-[13px] text-zinc-400">Terminal session ended.</p>
              <Button onClick={reconnect} size="sm" variant="secondary">
                <RotateCw className="h-3.5 w-3.5" />
                Reconnect
              </Button>
            </>
          ) : null}
          {state === "error" ? (
            <>
              <Monitor className="h-5 w-5 text-red-400" />
              <p className="text-[13px] text-red-400">Could not open the terminal</p>
              {errorMessage ? (
                <p className="max-w-md text-[12px] leading-relaxed text-zinc-500">{errorMessage}</p>
              ) : null}
              <Button onClick={reconnect} size="sm" variant="secondary">
                <RotateCw className="h-3.5 w-3.5" />
                Retry
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      <div ref={termRef} className="h-[520px] w-full bg-[#09090b] p-2" />
    </div>
  );
}
