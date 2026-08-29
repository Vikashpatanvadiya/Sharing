import { Download, Loader2, Trash2, X } from "lucide-react";
import type { MediaItem } from "@shared/types/index";
import { Button } from "@/components/ui/button";
import { pluralize } from "@/lib/format";

interface SelectionBarProps {
  selected: MediaItem[];
  isDeleting: boolean;
  isPreparingDownload: boolean;
  onDownload: () => void;
  onDelete: () => void;
  onClear: () => void;
  onSelectAll: () => void;
}

/**
 * Floating action bar for selection mode. Deletable count is computed from the
 * server-provided `canDelete` flag, so a contributor is told up front that
 * someone else's photos in their selection will be left alone.
 */
export function SelectionBar({
  selected,
  isDeleting,
  isPreparingDownload,
  onDownload,
  onDelete,
  onClear,
  onSelectAll,
}: SelectionBarProps) {
  const deletableCount = selected.filter((item) => item.canDelete).length;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-xl safe-bottom">
      <div className="container flex items-center gap-2 py-3">
        <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Exit selection">
          <X className="h-4 w-4" />
        </Button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {selected.length ? pluralize(selected.length, "item") + " selected" : "Select items"}
          </p>
          {selected.length > 0 && deletableCount < selected.length && (
            <p className="truncate text-xs text-muted-foreground">
              You can delete {deletableCount} of these
            </p>
          )}
        </div>

        {selected.length === 0 ? (
          <Button size="sm" variant="outline" onClick={onSelectAll}>
            Select all
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={onDownload} disabled={isPreparingDownload}>
              {isPreparingDownload ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">Download</span>
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={onDelete}
              disabled={isDeleting || deletableCount === 0}
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">Delete</span>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
