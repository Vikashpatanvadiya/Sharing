import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import type { MediaItem } from "@shared/types/index";
import { AdminPanel } from "@/components/AdminPanel";
import { AlbumHeader } from "@/components/AlbumHeader";
import { DownloadStatus } from "@/components/DownloadStatus";
import { EmptyState } from "@/components/EmptyState";
import { Gallery, GallerySkeleton } from "@/components/Gallery";
import { Lightbox } from "@/components/Lightbox";
import { SelectionBar } from "@/components/SelectionBar";
import { ShareDialog } from "@/components/ShareDialog";
import { UploadPanel } from "@/components/UploadPanel";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  albumKeys,
  useAlbum,
  useAlbumMedia,
  useMediaMutations,
  type MediaFilter,
} from "@/hooks/use-album";
import { useDownloadJob } from "@/hooks/use-download";
import { toast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { api, ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { pluralize } from "@/lib/format";

const FILTERS: Array<{ value: MediaFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "photos", label: "Photos" },
  { value: "videos", label: "Videos" },
  { value: "mine", label: "Mine" },
];

export default function AlbumPage() {
  const [, params] = useRoute("/album/:albumId");
  const [, navigate] = useLocation();
  const albumId = params?.albumId;
  const queryClient = useQueryClient();

  const albumQuery = useAlbum(albumId);
  const [filter, setFilter] = useState<MediaFilter>("all");
  const mediaQuery = useAlbumMedia(albumId, filter);
  const { deleteOne, deleteMany, prependMedia } = useMediaMutations(albumId ?? "");
  const download = useDownloadJob(albumId);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<MediaItem | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [nameValue, setNameValue] = useState("");

  const upload = useUpload(albumId ?? "", prependMedia);

  const items = useMemo(
    () => mediaQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [mediaQuery.data],
  );

  const selected = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  );

  // Losing access mid-session (code regenerated, album deleted) sends the
  // viewer back to the join screen rather than leaving them on a dead page.
  useEffect(() => {
    const error = albumQuery.error;
    if (!error) return;
    if (error.status === 401 || error.status === 403 || error.status === 404) {
      toast({
        variant: "destructive",
        title: "Album unavailable",
        description: error.message,
      });
      navigate("/join");
    }
  }, [albumQuery.error, navigate]);

  const toggleSelect = useCallback((item: MediaItem) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const confirmDeleteOne = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteOne.mutateAsync(target.id);
      toast({ title: target.resourceType === "video" ? "Video deleted" : "Photo deleted" });
      // Keep the viewer on a sensible neighbour rather than dumping them out.
      setLightboxIndex((current) => {
        if (current === null) return null;
        const remaining = items.length - 1;
        if (remaining <= 0) return null;
        return Math.min(current, remaining - 1);
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not delete",
        description:
          error instanceof ApiRequestError ? error.message : "Please try again in a moment.",
      });
    }
  };

  const confirmBulkDelete = async () => {
    const deletable = selected.filter((item) => item.canDelete).map((item) => item.id);
    setBulkDeleteOpen(false);
    if (!deletable.length) return;
    try {
      const result = await deleteMany.mutateAsync(deletable);
      toast({
        title: `${pluralize(result.deleted.length, "item")} deleted`,
        description: result.message ?? undefined,
      });
      exitSelection();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not delete",
        description:
          error instanceof ApiRequestError ? error.message : "Please try again in a moment.",
      });
    }
  };

  if (albumQuery.isLoading || !albumId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!albumQuery.data) {
    return (
      <div className="container flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center">
        <h1 className="text-2xl font-bold">Album unavailable</h1>
        <p className="mt-2 text-muted-foreground">
          {albumQuery.error?.message ?? "You don't have access to this album."}
        </p>
        <Button className="mt-6" onClick={() => navigate("/join")}>
          Enter an album code
        </Button>
      </div>
    );
  }

  const data = albumQuery.data;
  const needsName = data.viewer.needsDisplayName;

  return (
    <div className="min-h-[100dvh] pb-24">
      <AlbumHeader
        data={data}
        onUpload={() => setUploadOpen(true)}
        onShare={() => setShareOpen(true)}
        onDownloadAlbum={() => void download.start()}
        onOpenAdmin={() => setAdminOpen(true)}
        onToggleSelection={() => {
          setSelectionMode((value) => !value);
          setSelectedIds(new Set());
        }}
      />

      <main className="container py-5">
        {items.length > 0 && (
          <div className="mb-4 flex gap-1.5 overflow-x-auto no-scrollbar">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                className={cn(
                  "shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
                  filter === option.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-accent",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {mediaQuery.isLoading ? (
          <GallerySkeleton />
        ) : items.length === 0 ? (
          <EmptyState
            onUpload={() => setUploadOpen(true)}
            filtered={filter !== "all"}
            onClearFilter={() => setFilter("all")}
          />
        ) : (
          <Gallery
            items={items}
            selectedIds={selectedIds}
            selectionMode={selectionMode}
            hasNextPage={Boolean(mediaQuery.hasNextPage)}
            isFetchingNextPage={mediaQuery.isFetchingNextPage}
            onLoadMore={() => {
              if (mediaQuery.hasNextPage && !mediaQuery.isFetchingNextPage) {
                void mediaQuery.fetchNextPage();
              }
            }}
            onOpen={(item) => setLightboxIndex(items.findIndex((entry) => entry.id === item.id))}
            onToggleSelect={toggleSelect}
          />
        )}
      </main>

      {selectionMode && (
        <SelectionBar
          selected={selected}
          isDeleting={deleteMany.isPending}
          isPreparingDownload={download.isStarting}
          onDownload={() => void download.start(selected.map((item) => item.id))}
          onDelete={() => setBulkDeleteOpen(true)}
          onClear={exitSelection}
          onSelectAll={() => setSelectedIds(new Set(items.map((item) => item.id)))}
        />
      )}

      {lightboxIndex !== null && items[lightboxIndex] && (
        <Lightbox
          items={items}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onRequestDelete={setPendingDelete}
          onNeedMore={() => {
            if (mediaQuery.hasNextPage && !mediaQuery.isFetchingNextPage) {
              void mediaQuery.fetchNextPage();
            }
          }}
        />
      )}

      <UploadPanel open={uploadOpen} onOpenChange={setUploadOpen} upload={upload} />

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        albumName={data.album.name}
        code={data.joinCode ?? ""}
      />

      {data.viewer.role === "admin" && (
        <AdminPanel
          open={adminOpen}
          onOpenChange={setAdminOpen}
          album={data.album}
          onDownloadAlbum={() => {
            setAdminOpen(false);
            void download.start();
          }}
        />
      )}

      {download.job && <DownloadStatus job={download.job} onDismiss={download.dismiss} />}

      {/* Single-item delete confirmation — never one accidental tap away. */}
      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete this {pendingDelete?.resourceType === "video" ? "video" : "photo"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the original{" "}
              {pendingDelete?.resourceType === "video" ? "video" : "photo"} from the album. It cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void confirmDeleteOne();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {pluralize(selected.filter((item) => item.canDelete).length, "item")}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the original files from the album. It cannot be undone.
              {selected.some((item) => !item.canDelete) &&
                " Items uploaded by other people will be left untouched."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void confirmBulkDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Asked once, after joining, so uploads have a name attached. */}
      <AlertDialog open={needsName}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>What's your name?</AlertDialogTitle>
            <AlertDialogDescription>
              So everyone knows who added which photos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={nameValue}
            onChange={(event) => setNameValue(event.target.value)}
            placeholder="Vikash"
            maxLength={60}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={async () => {
                // "Skip" still needs a stored name, otherwise we'd ask again on
                // every load. Guest is an honest default.
                await api.setDisplayName(albumId, "Guest").catch(() => {});
                void queryClient.invalidateQueries({ queryKey: albumKeys.album(albumId) });
              }}
            >
              Skip
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!nameValue.trim()}
              onClick={async (event) => {
                event.preventDefault();
                if (!nameValue.trim()) return;
                await api.setDisplayName(albumId, nameValue.trim()).catch(() => {});
                void queryClient.invalidateQueries({ queryKey: albumKeys.album(albumId) });
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
