import {
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaItem } from "@shared/types/index";
import { Button } from "@/components/ui/button";
import { downloadUrl } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface LightboxProps {
  items: MediaItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onRequestDelete: (item: MediaItem) => void;
  onNeedMore: () => void;
}

/**
 * Full-screen viewer. Keyboard on desktop, swipe on touch, and the delete
 * action only appears when the server has said this viewer owns the item
 * (`canDelete`) — the check is enforced again on the server for every request.
 */
export function Lightbox({
  items,
  index,
  onIndexChange,
  onClose,
  onRequestDelete,
  onNeedMore,
}: LightboxProps) {
  const item = items[index];
  const [showInfo, setShowInfo] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const goPrev = useCallback(() => {
    onIndexChange(Math.max(0, index - 1));
  }, [index, onIndexChange]);

  const goNext = useCallback(() => {
    if (index >= items.length - 1) {
      onNeedMore();
      return;
    }
    onIndexChange(index + 1);
  }, [index, items.length, onIndexChange, onNeedMore]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft") goPrev();
      else if (event.key === "ArrowRight") goNext();
      else if (event.key.toLowerCase() === "i") setShowInfo((value) => !value);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev, onClose]);

  // Prefetch the neighbours so paging feels instant.
  useEffect(() => {
    for (const neighbour of [items[index - 1], items[index + 1]]) {
      if (neighbour && neighbour.resourceType !== "video") {
        const img = new Image();
        img.src = neighbour.previewUrl;
      }
    }
  }, [index, items]);

  // Stop the page behind the overlay from scrolling.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!item) return null;

  const isVideo = item.resourceType === "video";

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={item.originalFilename}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        touchStart.current = { x: touch.clientX, y: touch.clientY };
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        if (!start) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        touchStart.current = null;
        // Horizontal intent only; a vertical swipe closes the viewer.
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
          if (dx > 0) goPrev();
          else goNext();
        } else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) {
          onClose();
        }
      }}
    >
      <header className="flex items-center justify-between gap-2 px-3 pt-3 text-white sm:px-5 sm:pt-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.originalFilename}</p>
          <p className="truncate text-xs text-white/60">
            {index + 1} of {items.length} · Uploaded by {item.uploaderName}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="glass"
            size="icon-sm"
            onClick={() => setShowInfo((value) => !value)}
            aria-label="Details"
            aria-pressed={showInfo}
          >
            <Info className="h-4 w-4" />
          </Button>
          <Button variant="glass" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 py-3 sm:px-14">
        {index > 0 && (
          <Button
            variant="glass"
            size="icon"
            onClick={goPrev}
            aria-label="Previous"
            className="absolute left-1 top-1/2 z-10 -translate-y-1/2 sm:left-2"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        )}

        {isVideo ? (
          <video
            key={item.id}
            controls
            autoPlay
            playsInline
            preload="metadata"
            poster={item.posterUrl ?? undefined}
            className="max-h-full max-w-full rounded-lg"
          >
            {/* The delivery rendition plays everywhere; the untouched original
                is the fallback and is always what "Download original" returns. */}
            <source src={item.previewUrl} type="video/mp4" />
            <source src={item.originalUrl} type={item.mimeType ?? undefined} />
            Your browser can't play this video. Download the original instead.
          </video>
        ) : (
          <img
            key={item.id}
            src={item.previewUrl}
            alt={item.originalFilename}
            className="max-h-full max-w-full animate-fade-in select-none rounded-lg object-contain"
            draggable={false}
          />
        )}

        {index < items.length - 1 && (
          <Button
            variant="glass"
            size="icon"
            onClick={goNext}
            aria-label="Next"
            className="absolute right-1 top-1/2 z-10 -translate-y-1/2 sm:right-2"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        )}
      </div>

      {showInfo && (
        <div className="mx-3 mb-2 rounded-2xl bg-white/10 p-4 text-sm text-white backdrop-blur-md sm:mx-auto sm:w-full sm:max-w-md">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-white/60">Uploaded by</dt>
            <dd className="truncate">{item.uploaderName}</dd>
            <dt className="text-white/60">File</dt>
            <dd className="truncate">{item.originalFilename}</dd>
            <dt className="text-white/60">Size</dt>
            <dd>{formatBytes(item.fileSize)}</dd>
            {item.width && item.height && (
              <>
                <dt className="text-white/60">Dimensions</dt>
                <dd>
                  {item.width} × {item.height}
                </dd>
              </>
            )}
            <dt className="text-white/60">Added</dt>
            <dd>{formatDateTime(item.createdAt)}</dd>
          </dl>
        </div>
      )}

      <footer
        className={cn(
          "flex items-center justify-center gap-2 px-3 pb-4 pt-2 safe-bottom sm:pb-6",
        )}
      >
        <Button asChild variant="glass" className="min-w-0 flex-1 sm:flex-none">
          <a href={downloadUrl(item.id)} download={item.originalFilename}>
            <Download className="h-4 w-4" />
            <span className="truncate">Download original</span>
          </a>
        </Button>

        {item.canDelete && (
          <Button
            variant="glass"
            className="text-red-300 hover:text-red-200"
            onClick={() => onRequestDelete(item)}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        )}
      </footer>

    </div>
  );
}
