import { Check, Play } from "lucide-react";
import { memo, useState } from "react";
import type { MediaItem } from "@shared/types/index";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MediaTileProps {
  item: MediaItem;
  selected: boolean;
  selectionMode: boolean;
  onOpen: (item: MediaItem) => void;
  onToggleSelect: (item: MediaItem) => void;
}

/**
 * One gallery cell. Memoised because a large album re-renders the grid on every
 * selection change, and the thumbnails must not thrash.
 */
export const MediaTile = memo(function MediaTile({
  item,
  selected,
  selectionMode,
  onOpen,
  onToggleSelect,
}: MediaTileProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const isVideo = item.resourceType === "video";
  const duration = formatDuration(item.duration);

  return (
    <button
      type="button"
      onClick={() => (selectionMode ? onToggleSelect(item) : onOpen(item))}
      className={cn(
        "group relative aspect-square w-full overflow-hidden rounded-lg bg-muted transition-transform sm:rounded-xl",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
      aria-label={
        selectionMode
          ? `${selected ? "Deselect" : "Select"} ${item.originalFilename}`
          : `Open ${item.originalFilename}`
      }
    >
      {!loaded && !failed && <div className="absolute inset-0 skeleton-shimmer" />}

      {failed ? (
        <div className="flex h-full w-full items-center justify-center bg-muted px-2 text-center text-[11px] text-muted-foreground">
          Preview unavailable
        </div>
      ) : (
        <img
          src={item.thumbnailUrl}
          alt={item.originalFilename}
          // Native lazy loading plus async decode keeps scrolling smooth even
          // when hundreds of tiles enter the viewport at once.
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            "h-full w-full object-cover transition-all duration-300 group-hover:scale-[1.03]",
            loaded ? "opacity-100" : "opacity-0",
            selected && "scale-[0.94] rounded-lg",
          )}
        />
      )}

      {isVideo && !selectionMode && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm">
            <Play className="h-5 w-5 fill-white text-white" />
          </span>
        </span>
      )}

      {isVideo && duration && (
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
          {duration}
        </span>
      )}

      {selectionMode && (
        <span
          className={cn(
            "pointer-events-none absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-white/80 bg-black/25 backdrop-blur-sm",
          )}
        >
          {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>
      )}
    </button>
  );
});
