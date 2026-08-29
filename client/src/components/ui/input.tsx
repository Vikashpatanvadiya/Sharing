import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        // 16px text keeps iOS Safari from zooming the viewport on focus.
        "flex h-12 w-full rounded-card border border-input bg-card px-4 text-body font-regular text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-brand-indigo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
