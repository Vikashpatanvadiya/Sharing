import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Pill CTAs with inset depth, per the system: the primary fill is the near-black
 * action colour and there is exactly one per screen. Heights start at 44px so
 * every control clears the minimum touch target on a phone.
 */
const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-pill font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 active:scale-[0.97] [&_svg]:size-[18px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "btn-depth bg-primary text-primary-foreground hover:bg-primary/90",
        brand:
          "btn-depth bg-brand-indigo text-white hover:brightness-[1.06]",
        destructive: "btn-depth bg-destructive text-destructive-foreground hover:bg-destructive/92",
        outline:
          "border border-border bg-card text-foreground hover:bg-secondary active:bg-secondary",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "text-foreground hover:bg-secondary active:bg-secondary",
        link: "text-brand-indigo underline-offset-4 hover:underline",
        glass:
          "border border-white/15 bg-white/12 text-white backdrop-blur-md hover:bg-white/20",
      },
      size: {
        default: "h-11 px-5 text-button",
        sm: "h-10 px-4 text-label",
        lg: "h-14 px-8 text-body",
        icon: "h-11 w-11",
        "icon-sm": "h-9 w-9",
        "icon-lg": "h-12 w-12",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
