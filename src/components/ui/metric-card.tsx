import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type MetricCardProps = {
  icon: ReactNode;
  label: string;
  value?: string;
  description?: string;
  subtitle?: string;
  badge?: ReactNode;
  className?: string;
  children?: ReactNode;
};

export function MetricCard({
  icon,
  label,
  value,
  description,
  subtitle,
  badge,
  className,
  children,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-white/5 bg-[#111113] p-5 shadow-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[13px] font-medium text-zinc-400">
          {icon}
          {label}
        </h3>
        {badge != null && (
          <div className="flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">
            {badge}
          </div>
        )}
      </div>
      {children != null ? (
        children
      ) : (
        <div className="mt-2 text-2xl font-semibold tracking-tight text-white">
          {value}
        </div>
      )}
      {description != null && (
        <p className="mt-4 text-[12px] font-medium text-zinc-300">
          {description}
        </p>
      )}
      {subtitle != null && (
        <p className="mt-1 text-[11px] text-zinc-500">{subtitle}</p>
      )}
    </div>
  );
}
