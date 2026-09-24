import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Theme tokens resolve to light defaults here because <html> has no `dark` class.
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c] disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-white/10 text-white hover:bg-white/20 border border-white/5 shadow-sm",
        primary: "bg-white/10 text-white hover:bg-white/20 border border-white/5 shadow-sm",
        accent: "bg-white text-zinc-950 hover:bg-zinc-100 shadow-sm",
        secondary: "bg-white/[0.06] text-zinc-100 hover:bg-white/[0.10] border border-white/[0.06]",
        outline: "border border-white/15 bg-transparent text-zinc-200 hover:bg-white/[0.04] hover:border-white/25",
        ghost: "bg-transparent text-zinc-300 hover:bg-white/[0.05] hover:text-white",
        link: "text-zinc-200 underline-offset-4 hover:underline hover:text-white",
        danger: "bg-rose-600 text-white hover:bg-rose-700",
        destructive: "bg-rose-600 text-white hover:bg-rose-700",
        success: "bg-emerald-600 text-white hover:bg-emerald-700",
        warning: "bg-amber-500 text-white hover:bg-amber-600",
        review: "bg-blue-600 text-white hover:bg-blue-700",
        neutral: "bg-zinc-700 text-white hover:bg-zinc-600",
      },
      size: {
        default: "h-10 px-4 py-2",
        md: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
        "icon-sm": "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
