import Link from "next/link";

import { cn } from "@/lib/utils";

interface PillTabItem {
  label: string;
  count?: number;
  countVariant?: "default" | "alert";
  active?: boolean;
  onClick?: () => void;
  href?: string;
}

interface PillTabsProps {
  items: PillTabItem[];
  className?: string;
}

export function PillTabs({ items, className }: PillTabsProps) {
  return (
    <div
      className={cn(
        "flex items-center rounded-full bg-white/5 border border-white/5 p-1",
        className,
      )}
    >
      {items.map((item) => {
        const inner = (
          <>
            {item.label}
            {item.count != null && (
              <span
                className={cn(
                  "ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]",
                  item.countVariant === "alert"
                    ? "bg-rose-500/20 text-rose-400"
                    : "bg-white/10 text-zinc-300",
                )}
              >
                {item.count}
              </span>
            )}
          </>
        );

        const sharedClassName = cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
          item.active
            ? "bg-white/10 text-white"
            : "text-zinc-400 hover:text-zinc-200",
        );

        if (item.href) {
          return (
            <Link key={item.label} href={item.href} className={sharedClassName}>
              {inner}
            </Link>
          );
        }

        return (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            className={sharedClassName}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
