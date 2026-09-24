"use client";

import * as React from "react";
import { Tooltip } from "radix-ui";

import { cn } from "@/lib/utils";

export type InfoTipProps = {
  label: string;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
};

export function InfoTip({ label, children, side = "top", className }: InfoTipProps) {
  const [open, setOpen] = React.useState(false);
  const pinnedRef = React.useRef(false);

  const unpin = React.useCallback(() => {
    pinnedRef.current = false;
    setOpen(false);
  }, []);

  return (
    <Tooltip.Provider delayDuration={120} skipDelayDuration={200}>
      <Tooltip.Root
        open={open}
        onOpenChange={(next) => {
          // Radix closes on pointer-down, which would undo a tap that pinned the tip open.
          if (pinnedRef.current && !next) return;
          setOpen(next);
        }}
      >
        <Tooltip.Trigger asChild>
          <button
            aria-label={`About ${label}`}
            className={cn(
              "inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full",
              "border border-white/15 text-[9.5px] font-semibold leading-none text-zinc-500",
              "transition-colors duration-150 hover:border-white/30 hover:text-zinc-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60",
              "data-[state=delayed-open]:border-white/30 data-[state=delayed-open]:text-zinc-200",
              "data-[state=instant-open]:border-white/30 data-[state=instant-open]:text-zinc-200",
              className,
            )}
            onBlur={unpin}
            onClick={() => {
              pinnedRef.current = !pinnedRef.current;
              setOpen(pinnedRef.current);
            }}
            type="button"
          >
            <span aria-hidden="true">i</span>
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className={cn(
              "z-50 max-w-[268px] rounded-lg border border-white/10 bg-zinc-800/95 px-3 py-2",
              "text-[12px] leading-[1.55] text-zinc-300 shadow-[0_12px_32px_rgba(0,0,0,0.55)]",
              "backdrop-blur-xl",
              "animate-in fade-in-0 zoom-in-95 duration-150",
              "data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1",
              "data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
            )}
            collisionPadding={12}
            onEscapeKeyDown={unpin}
            onPointerDownOutside={unpin}
            side={side}
            sideOffset={6}
          >
            {children}
            <Tooltip.Arrow className="fill-zinc-800" height={5} width={11} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

export function InfoLabel({
  children,
  className,
  htmlFor,
  tip,
  tipSide,
}: {
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
  tip: React.ReactNode;
  tipSide?: InfoTipProps["side"];
}) {
  const label = typeof children === "string" ? children : "this setting";

  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      <label className="text-[11px] font-medium text-zinc-400" htmlFor={htmlFor}>
        {children}
      </label>
      <InfoTip label={label} side={tipSide}>
        {tip}
      </InfoTip>
    </span>
  );
}
