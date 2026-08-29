import { Check, Lock, Play } from "lucide-react";
import { memo, useState } from "react";
import type { MediaItem } from "@shared/types/index";
import { useLongPress } from "@/hooks/use-long-press";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MediaTileProps {
  item: MediaItem;
  selected: boolean;
  selectionMode: boolean;
  onOpen: (item: MediaItem) => void;
  onToggleSelect: (item: MediaItem) => void;
  onLongPress: (item: MediaItem) => void;
}

/**
 * One gallery cell. Tap opens, long-press starts selecting — the gesture people
 * already use in their phone's gallery. Memoised because a large album
 * re-renders the whole grid whenever the selection changes.
 */
export const MediaTile = memo(function MediaTile({
  item,
  selected,
  selectionMode,
  onOpen,
  onToggleSelect,
  onLongPress,
}: MediaTileProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const isVideo = item.resourceType === "video";
  const duration = formatDuration(item.duration);

  const press = useLongPress({
    onLongPress: () => onLongPress(item),
    onClick: () => (selectionMode ? onToggleSelect(item) : onOpen(item)),
  });

  return (
    <button
      type="button"
      {...press}
      className={cn(
        "group relative aspect-square w-full overflow-hidden rounded-md bg-secondary transition-transform sm:rounded-card",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
      aria-label={
        selectionMode
          ? `${selected ? "Deselect" : "Select"} ${item.originalFilename}`
          : `Open ${item.originalFilename}`
      }
      aria-pressed={selectionMode ? selected : undefined}
    >
      {!loaded && !failed && <div className="absolute inset-0 skeleton-shimmer" />}

      {failed ? (
        <div className="flex h-full w-full items-center justify-center bg-secondary px-2 text-center text-caption text-muted-foreground">
          Preview unavailable
        </div>
      ) : (
        <img
          src={item.thumbnailUrl}
          alt={item.originalFilename}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            "h-full w-full object-cover transition-all duration-300",
            loaded ? "opacity-100" : "opacity-0",
            selected ? "scale-[0.88] rounded-card" : "group-active:scale-[1.02]",
          )}
        />
      )}

      {isVideo && !selectionMode && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-pill bg-black/40 backdrop-blur-sm">
            <Play className="h-5 w-5 fill-white text-white" />
          </span>
        </span>
      )}

      {isVideo && duration && (
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-caption font-medium text-white tabular-nums">
          {duration}
        </span>
      )}

      {/* Restricted items carry a lock so their owner can see at a glance
          which photos are not visible to the whole album. */}
      {item.visibility === "restricted" && !selectionMode && (
        <span
          className="pointer-events-none absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-pill bg-black/50 backdrop-blur-sm"
          title="Only visible to some people"
        >
          <Lock className="h-3 w-3 text-white" />
        </span>
      )}

      {selectionMode && (
        <>
          <span
            className={cn(
              "pointer-events-none absolute inset-0 transition-colors",
              selected ? "bg-brand-indigo/20" : "bg-transparent",
            )}
          />
          <span
            className={cn(
              "pointer-events-none absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-pill border-2 transition-colors",
              selected
                ? "border-brand-indigo bg-brand-indigo text-white"
                : "border-white/85 bg-black/25 backdrop-blur-sm",
            )}
          >
            {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
          </span>
        </>
      )}
    </button>
  );
});
