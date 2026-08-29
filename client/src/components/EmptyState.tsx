import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  onUpload: () => void;
  filtered?: boolean;
  onClearFilter?: () => void;
}

export function EmptyState({ onUpload, filtered, onClearFilter }: EmptyStateProps) {
  if (filtered) {
    return (
      <div className="flex flex-col items-center py-20 text-center">
        <p className="text-lg font-semibold">Nothing here yet</p>
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
          There's nothing matching this filter in the album.
        </p>
        {onClearFilter && (
          <Button variant="outline" className="mt-5" onClick={onClearFilter}>
            Show everything
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-20 text-center">
      <span className="text-5xl" role="img" aria-label="camera">
        📸
      </span>
      <h2 className="mt-5 text-xl font-semibold">No memories yet</h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        Be the first to upload a photo or video to this album.
      </p>
      <Button size="lg" className="mt-6" onClick={onUpload}>
        <ImagePlus className="h-4 w-4" />
        Add photos &amp; videos
      </Button>
    </div>
  );
}
