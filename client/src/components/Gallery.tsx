import { useEffect, useRef } from "react";
import type { MediaItem } from "@shared/types/index";
import { MediaTile } from "./MediaTile";
import { Skeleton } from "./ui/skeleton";

interface GalleryProps {
  items: MediaItem[];
  selectedIds: Set<string>;
  selectionMode: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onOpen: (item: MediaItem) => void;
  onToggleSelect: (item: MediaItem) => void;
  onLongPress: (item: MediaItem) => void;
}

/**
 * Responsive photo grid with infinite scroll.
 *
 * Pages are fetched by a sentinel that sits a full viewport below the fold, so
 * the next batch is already arriving before the user reaches the bottom.
 */
export function Gallery({
  items,
  selectedIds,
  selectionMode,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onOpen,
  onToggleSelect,
  onLongPress,
}: GalleryProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreRef.current();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, items.length]);

  return (
    <>
      <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-2 lg:grid-cols-5 xl:grid-cols-6">
        {items.map((item) => (
          <MediaTile
            key={item.id}
            item={item}
            selected={selectedIds.has(item.id)}
            selectionMode={selectionMode}
            onOpen={onOpen}
            onToggleSelect={onToggleSelect}
            onLongPress={onLongPress}
          />
        ))}

        {isFetchingNextPage &&
          Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={`loading-${index}`} className="aspect-square w-full" />
          ))}
      </div>

      <div ref={sentinelRef} className="h-4" aria-hidden />

      {!hasNextPage && items.length > 24 && (
        <p className="py-8 text-center text-caption text-muted-foreground">
          That's everything — {items.length.toLocaleString()} memories.
        </p>
      )}
    </>
  );
}

export function GallerySkeleton() {
  return (
    <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-2 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: 18 }).map((_, index) => (
        <Skeleton key={index} className="aspect-square w-full" />
      ))}
    </div>
  );
}
