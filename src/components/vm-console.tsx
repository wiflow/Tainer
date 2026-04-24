"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Monitor, RotateCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

type ConsoleTicketResponse = {
  kind: "vnc";
  password: string;
  websocketUrl: string;
};

export function VmConsole({
  deploymentId,
  guestType = "qemu",
}: {
  deploymentId: string;
  guestType?: "lxc" | "qemu";
}) {
  const screenRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<import("@novnc/novnc/lib/rfb.js").default | null>(null);
  const consoleActiveRef = useRef(false);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connectKey, setConnectKey] = useState(0);

  useEffect(() => {
    const target = screenRef.current;
    if (!target) {
      return;
    }

    let disposed = false;
    let rfb: import("@novnc/novnc/lib/rfb.js").default | undefined;

    async function init() {
      try {
        setState("connecting");
        setErrorMessage(null);

        const ticketResponse = await fetch(
          `/api/proxmox/console-ticket?deploymentId=${encodeURIComponent(deploymentId)}`,
          { cache: "no-store" },
        );
        const ticketPayload = (await ticketResponse.json()) as
          | ({ error?: string } & Partial<ConsoleTicketResponse>)
          | undefined;

        if (!ticketResponse.ok || !ticketPayload || ticketPayload.kind !== "vnc" || !ticketPayload.websocketUrl) {
          throw new Error(ticketPayload?.error || "Failed to start the console session.");
        }

        const [{ default: RFB }, currentTarget] = await Promise.all([
          import("@novnc/novnc/lib/rfb.js"),
          Promise.resolve(screenRef.current),
        ]);

        if (disposed || !currentTarget) {
          return;
        }

        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${location.host}${ticketPayload.websocketUrl}`;

        rfb = new RFB(currentTarget, wsUrl, {
          credentials: { password: ticketPayload.password ?? "" },
          wsProtocols: [],
        });
        rfb.scaleViewport = true;
        rfb.resizeSession = true;
        rfb.focusOnClick = true;
        rfbRef.current = rfb;

        rfb.addEventListener("connect", () => {
          if (disposed) {
            return;
          }

          // Match noVNC's internal screen div to the dark theme
          const screen = currentTarget.querySelector(":scope > div") as HTMLElement | null;
          if (screen) {
            screen.style.background = "#09090b";
          }

          setState("connected");
        });

        rfb.addEventListener("credentialsrequired", () => {
          rfb?.sendCredentials({ password: ticketPayload.password ?? "" });
        });

        rfb.addEventListener("disconnect", (event) => {
          if (disposed) {
            return;
          }

          const clean = Boolean(event.detail?.clean);
          setErrorMessage(event.detail?.reason ?? null);
          setState(clean ? "disconnected" : "error");
        });
      } catch (error) {
        if (!disposed) {
          setErrorMessage(error instanceof Error ? error.message : "Could not open the VM console.");
          setState("error");
        }
      }
    }

    void init();

    return () => {
      disposed = true;
      rfb?.disconnect();
      rfbRef.current = null;
    };
  }, [connectKey, deploymentId, guestType]);

  // Direct keyboard forwarding using rfb.sendKey(). Captures keys at the
  // document level, converts DOM key names to X11 keysyms, and sends them
  // through the VNC connection. No dependency on noVNC's key utilities
  // (the dynamic import was failing silently in production).
  useEffect(() => {
    if (state !== "connected") return;

    const container = screenRef.current;
    if (!container) return;

    // X11 keysym lookup — covers all printable ASCII + common special keys
    const specialKeys: Record<string, number> = {
      Enter: 0xff0d, Backspace: 0xff08, Tab: 0xff09, Escape: 0xff1b,
      Delete: 0xffff, Home: 0xff50, End: 0xff57, PageUp: 0xff55,
      PageDown: 0xff56, ArrowLeft: 0xff51, ArrowUp: 0xff52,
      ArrowRight: 0xff53, ArrowDown: 0xff54, Insert: 0xff63,
      F1: 0xffbe, F2: 0xffbf, F3: 0xffc0, F4: 0xffc1, F5: 0xffc2,
      F6: 0xffc3, F7: 0xffc4, F8: 0xffc5, F9: 0xffc6, F10: 0xffc7,
      F11: 0xffc8, F12: 0xffc9,
      ShiftLeft: 0xffe1, ShiftRight: 0xffe2, Shift: 0xffe1,
      ControlLeft: 0xffe3, ControlRight: 0xffe4, Control: 0xffe3,
      AltLeft: 0xffe9, AltRight: 0xffea, Alt: 0xffe9,
      MetaLeft: 0xffe7, MetaRight: 0xffe8, Meta: 0xffe7,
      CapsLock: 0xffe5, NumLock: 0xff7f, ScrollLock: 0xff14,
      " ": 0x0020,
    };

    function keyToKeysym(e: KeyboardEvent): number | null {
      // Check special keys first
      if (e.key in specialKeys) return specialKeys[e.key];
      // Single printable character → Unicode codepoint (maps to X11 keysym
      // for Latin-1 and Basic Latin which covers standard ASCII)
      if (e.key.length === 1) return e.key.charCodeAt(0);
      return null;
    }

    const activateConsole = () => {
      consoleActiveRef.current = true;
    };

    const handleGlobalClick = (e: MouseEvent) => {
      consoleActiveRef.current = container.contains(e.target as Node);
    };

    const forwardKey = (e: KeyboardEvent) => {
      if (!consoleActiveRef.current || !rfbRef.current) return;

      // Don't intercept if the user is typing in a form field
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      const keysym = keyToKeysym(e);
      if (!keysym) return;

      e.preventDefault();
      e.stopPropagation();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rfbRef.current as any).sendKey(keysym, e.code, e.type === "keydown");
    };

    container.addEventListener("mousedown", activateConsole);
    document.addEventListener("mousedown", handleGlobalClick);
    document.addEventListener("keydown", forwardKey, true);
    document.addEventListener("keyup", forwardKey, true);

    // Auto-activate on connect
    consoleActiveRef.current = true;

    return () => {
      container.removeEventListener("mousedown", activateConsole);
      document.removeEventListener("mousedown", handleGlobalClick);
      document.removeEventListener("keydown", forwardKey, true);
      document.removeEventListener("keyup", forwardKey, true);
      consoleActiveRef.current = false;
    };
  }, [state]);

  const reconnect = useCallback(() => {
    setConnectKey((key) => key + 1);
  }, []);

  const focusConsole = useCallback(() => {
    consoleActiveRef.current = true;
    rfbRef.current?.focus();
  }, []);

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/5 bg-zinc-950" onClick={focusConsole}>
      {state !== "connected" ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-zinc-950/90 px-6 text-center backdrop-blur-sm">
          {state === "connecting" ? (
            <>
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/10 border-t-zinc-300" />
              <p className="text-[13px] text-zinc-400">Preparing Proxmox noVNC session...</p>
            </>
          ) : null}
          {state === "disconnected" ? (
            <>
              <X className="h-5 w-5 text-zinc-500" />
              <p className="text-[13px] text-zinc-400">Console session ended.</p>
              <Button onClick={reconnect} size="sm" variant="secondary">
                <RotateCw className="h-3.5 w-3.5" />
                Reconnect
              </Button>
            </>
          ) : null}
          {state === "error" ? (
            <>
              <Monitor className="h-5 w-5 text-red-400" />
              <p className="text-[13px] text-red-400">Could not open the VM console</p>
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

      <div ref={screenRef} className="h-[520px] w-full bg-[#09090b]" />
    </div>
  );
}
