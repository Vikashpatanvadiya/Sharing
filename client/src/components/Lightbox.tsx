import {
  ChevronLeft,
  ChevronRight,
  Download,
  Globe,
  Info,
  Lock,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaItem } from "@shared/types/index";
import { Button } from "@/components/ui/button";
import { downloadUrl } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";

interface LightboxProps {
  items: MediaItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onRequestDelete: (item: MediaItem) => void;
  onRequestVisibility: (item: MediaItem) => void;
  onNeedMore: () => void;
}

/**
 * Full-screen viewer. Swipe left/right to page and down to dismiss, the way a
 * phone gallery behaves; arrow keys and Escape on a desktop.
 *
 * Delete and the audience control only appear when the server has said this
 * viewer owns the item — and both are re-checked server-side on every request.
 */
export function Lightbox({
  items,
  index,
  onIndexChange,
  onClose,
  onRequestDelete,
  onRequestVisibility,
  onNeedMore,
}: LightboxProps) {
  const item = items[index];
  const [showInfo, setShowInfo] = useState(false);
  const [drag, setDrag] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const goPrev = useCallback(() => {
    if (index > 0) onIndexChange(index - 1);
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
      style={{
        transform: drag ? `translateY(${drag}px)` : undefined,
        opacity: drag ? Math.max(0.25, 1 - drag / 400) : 1,
        transition: drag ? "none" : "transform 0.2s ease-out, opacity 0.2s ease-out",
      }}
      onTouchStart={(event) => {
        if (event.touches.length !== 1) return;
        const touch = event.touches[0];
        touchStart.current = { x: touch.clientX, y: touch.clientY };
      }}
      onTouchMove={(event) => {
        const start = touchStart.current;
        if (!start || isVideo) return;
        const touch = event.touches[0];
        const dy = touch.clientY - start.y;
        const dx = touch.clientX - start.x;
        // Follow the finger downwards; horizontal intent is handled on release.
        if (dy > 0 && Math.abs(dy) > Math.abs(dx)) setDrag(dy);
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;

        if (drag > 110) {
          onClose();
          return;
        }
        setDrag(0);

        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
          if (dx > 0) goPrev();
          else goNext();
        }
      }}
    >
      <header className="flex items-center gap-2 px-2 pt-[max(10px,env(safe-area-inset-top))] text-white">
        <Button variant="glass" size="icon" onClick={onClose} aria-label="Back" className="shrink-0">
          <X className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-label font-medium">{item.originalFilename}</p>
          <p className="truncate text-caption text-white/60">
            {index + 1} of {items.length} · {item.uploaderName}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {item.canRestrict && (
            <Button
              variant="glass"
              size="icon"
              onClick={() => onRequestVisibility(item)}
              aria-label="Who can see this"
            >
              {item.visibility === "restricted" ? (
                <Lock className="h-5 w-5" />
              ) : (
                <Globe className="h-5 w-5" />
              )}
            </Button>
          )}
          <Button
            variant="glass"
            size="icon"
            onClick={() => setShowInfo((value) => !value)}
            aria-label="Details"
            aria-pressed={showInfo}
          >
            <Info className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-1 py-3 sm:px-14">
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
            className="max-h-full max-w-full rounded-card"
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
            className="max-h-full max-w-full animate-fade-in select-none rounded-card object-contain"
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
        <div className="mx-3 mb-2 animate-fade-in rounded-panel bg-white/10 p-4 text-label text-white backdrop-blur-md sm:mx-auto sm:w-full sm:max-w-md">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-white/60">Uploaded by</dt>
            <dd className="truncate">{item.uploaderName}</dd>
            <dt className="text-white/60">File</dt>
            <dd className="selectable truncate">{item.originalFilename}</dd>
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
            <dt className="text-white/60">Visible to</dt>
            <dd>
              {item.visibility === "restricted"
                ? `${item.visibleTo.length || "no"} chosen ${item.visibleTo.length === 1 ? "person" : "people"}`
                : "Everyone in the album"}
            </dd>
          </dl>
        </div>
      )}

      <footer className="flex items-center justify-center gap-2 px-3 pb-[max(14px,env(safe-area-inset-bottom))] pt-2">
        <Button asChild variant="glass" size="lg" className="min-w-0 flex-1 sm:flex-none">
          <a href={downloadUrl(item.id)} download={item.originalFilename}>
            <Download className="h-5 w-5" />
            <span className="truncate">Download original</span>
          </a>
        </Button>

        {item.canDelete && (
          <Button
            variant="glass"
            size="lg"
            className="shrink-0 text-red-300"
            onClick={() => onRequestDelete(item)}
            aria-label="Delete"
          >
            <Trash2 className="h-5 w-5" />
          </Button>
        )}
      </footer>
    </div>
  );
}
