import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * `Empty` is a vertical-stack primitive for empty / not-found / no-access
 * states. The shadcn-published version uses theme tokens (`text-foreground`,
 * `bg-muted` etc.) that resolve to a light palette without `<html class="dark">`,
 * which Tainer doesn't apply — so this version uses the project's hardcoded
 * dark-palette zinc/white tokens to stay consistent with the rest of the chrome.
 *
 *   <Empty>
 *     <EmptyHeader>
 *       <EmptyTitle>...</EmptyTitle>
 *       <EmptyDescription>...</EmptyDescription>
 *     </EmptyHeader>
 *     <EmptyContent>...action buttons...</EmptyContent>
 *   </Empty>
 */

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-6 rounded-lg border-dashed p-6 text-center text-balance md:p-12",
        className,
      )}
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("flex max-w-sm flex-col items-center gap-2 text-center", className)}
      {...props}
    />
  );
}

const emptyMediaVariants = cva(
  "flex shrink-0 items-center justify-center mb-2 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        // The "icon" variant frames an icon in a soft tile. Translucent
        // white-on-dark instead of the shadcn `bg-muted` token so it
        // matches the rest of Tainer's surfaces.
        icon: "flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-zinc-200 [&_svg:not([class*='size-'])]:size-6",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn("text-lg font-medium tracking-tight text-zinc-100", className)}
      {...props}
    />
  );
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "text-sm/relaxed text-zinc-400 [&>a]:text-zinc-200 [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-white",
        className,
      )}
      {...props}
    />
  );
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-sm text-balance",
        className,
      )}
      {...props}
    />
  );
}

export { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia };
