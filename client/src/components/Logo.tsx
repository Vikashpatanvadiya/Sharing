import { Link } from "wouter";
import { cn } from "@/lib/utils";

/**
 * The Memento mark.
 *
 * The artwork is served from /brand/. If the file is missing the component
 * falls back to a plain violet tile with the wordmark, so a fresh checkout or
 * a failed asset never leaves a broken image in the header.
 */
export function Logo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <Link
      href="/"
      className={cn("inline-flex items-center gap-2.5 font-semibold tracking-[-0.3px]", className)}
      aria-label="Memento — home"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-card bg-brand-purple">
        <img
          src="/brand/mark.svg"
          alt=""
          className="h-[68%] w-[68%] object-contain"
          onError={(event) => {
            // No artwork yet: leave the violet tile as the mark.
            event.currentTarget.style.display = "none";
          }}
        />
      </span>
      {showWordmark && <span className="text-body">Memento</span>}
    </Link>
  );
}
