import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AppBarProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  actions?: ReactNode;
  /** Selection mode recolours the whole bar, the way a native gallery does. */
  variant?: "default" | "selection";
  className?: string;
}

/**
 * The fixed top bar every screen hangs from: back arrow on the left, title and
 * a quiet subtitle in the middle, actions on the right.
 */
export function AppBar({
  title,
  subtitle,
  onBack,
  actions,
  variant = "default",
  className,
}: AppBarProps) {
  return (
    <header
      className={cn(
        "app-bar",
        variant === "selection" && "bg-accent/90 supports-[backdrop-filter]:bg-accent/80",
        className,
      )}
    >
      <div className="flex h-14 items-center gap-1 px-1 sm:px-2">
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            aria-label="Back"
            className="shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}

        <div className={cn("min-w-0 flex-1", !onBack && "pl-3")}>
          <div className="truncate text-body font-semibold leading-tight">{title}</div>
          {subtitle && (
            <div className="truncate text-caption text-muted-foreground">{subtitle}</div>
          )}
        </div>

        {actions && <div className="flex shrink-0 items-center gap-0.5 pr-1">{actions}</div>}
      </div>
    </header>
  );
}
