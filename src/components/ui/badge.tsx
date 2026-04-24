import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium",
  {
    variants: {
      variant: {
        neutral: "bg-zinc-800 text-zinc-400",
        success: "bg-emerald-950 text-emerald-400",
        warning: "bg-amber-950 text-amber-400",
        review: "bg-blue-950 text-blue-400",
        destructive: "bg-rose-950 text-rose-400",
        info: "bg-sky-950 text-sky-400",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

type BadgeProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
