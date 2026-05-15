import * as React from "react";

import { cn } from "@/lib/utils";

interface SectionPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: React.ReactNode;
  headerRight?: React.ReactNode;
  noPadding?: boolean;
}

export function SectionPanel({
  title,
  description,
  headerRight,
  noPadding,
  className,
  children,
  ...props
}: SectionPanelProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-white/5 bg-[#111113] shadow-sm text-zinc-100",
        className,
      )}
      {...props}
    >
      {title && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div>
            <h2 className="text-[15px] font-medium text-white">{title}</h2>
            {description && (
              <p className="text-[12px] text-zinc-500 mt-0.5">{description}</p>
            )}
          </div>
          {headerRight}
        </div>
      )}
      <div className={noPadding ? "" : "p-5"}>{children}</div>
    </div>
  );
}
