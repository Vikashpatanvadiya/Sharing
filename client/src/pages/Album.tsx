import { useQueryClient } from "@tanstack/react-query";
import {
  CheckSquare,
  Download,
  ImagePlus,
  Loader2,
  Lock,
  MoreVertical,
  Settings,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import type { MediaItem } from "@shared/types/index";
import { AdminPanel } from "@/components/AdminPanel";
import { AppBar } from "@/components/AppBar";
import { DownloadStatus } from "@/components/DownloadStatus";
import { EmptyState } from "@/components/EmptyState";
import { Gallery, GallerySkeleton } from "@/components/Gallery";
import { Lightbox } from "@/components/Lightbox";
import { ShareDialog } from "@/components/ShareDialog";
import { UploadPanel } from "@/components/UploadPanel";
import { VisibilitySheet } from "@/components/VisibilitySheet";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  albumKeys,
  useAlbum,
  useAlbumMedia,
  useMediaMutations,
  type MediaFilter,
} from "@/hooks/use-album";
import { useBackGuard } from "@/hooks/use-back-guard";
import { useDownloadJob } from "@/hooks/use-download";
import { toast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { api, ApiRequestError } from "@/lib/api";
import { formatBytes, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  const { deleteOne, deleteMany, prependMedia, replaceMedia } = useMediaMutations(albumId ?? "");
  const download = useDownloadJob(albumId);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<MediaItem | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [visibilityFor, setVisibilityFor] = useState<MediaItem | null>(null);
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

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  // Device Back closes whatever is open, in the order a person expects,
  // instead of dropping them out of the album (or out of the app entirely).
  useBackGuard(selectionMode, exitSelection);
  useBackGuard(lightboxIndex !== null, () => setLightboxIndex(null));
  useBackGuard(uploadOpen, () => setUploadOpen(false));
  useBackGuard(shareOpen, () => setShareOpen(false));
  useBackGuard(adminOpen, () => setAdminOpen(false));
  useBackGuard(Boolean(visibilityFor), () => setVisibilityFor(null));

  useEffect(() => {
    const error = albumQuery.error;
    if (!error) return;
    if (error.status === 401 || error.status === 403 || error.status === 404) {
      toast({ variant: "destructive", title: "Album unavailable", description: error.message });
      navigate("/join");
    }
  }, [albumQuery.error, navigate]);

  const toggleSelect = useCallback((item: MediaItem) => {
    navigator.vibrate?.(8);
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }, []);

  const startSelection = useCallback((item: MediaItem) => {
    setSelectionMode(true);
    setSelectedIds(new Set([item.id]));
  }, []);

  const confirmDeleteOne = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteOne.mutateAsync(target.id);
      toast({ title: target.resourceType === "video" ? "Video deleted" : "Photo deleted" });
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
        description: error instanceof ApiRequestError ? error.message : "Please try again.",
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
        description: error instanceof ApiRequestError ? error.message : "Please try again.",
      });
    }
  };

  if (albumQuery.isLoading || !albumId) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!albumQuery.data) {
    return (
      <div className="container flex min-h-[100dvh] max-w-md flex-col items-center justify-center text-center">
        <h1 className="text-section font-display">Album unavailable</h1>
        <p className="mt-2 text-body text-muted-foreground">
          {albumQuery.error?.message ?? "You don't have access to this album."}
        </p>
        <Button className="mt-6" onClick={() => navigate("/join")}>
          Enter an album code
        </Button>
      </div>
    );
  }

  const data = albumQuery.data;
  const { album, viewer } = data;
  const isAdmin = viewer.role === "admin";
  const deletableCount = selected.filter((item) => item.canDelete).length;
  const singleRestrictable = selected.length === 1 && selected[0].canRestrict ? selected[0] : null;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      {selectionMode ? (
        <AppBar
          variant="selection"
          title={selected.length ? `${selected.length} selected` : "Select items"}
          subtitle={
            selected.length > 0 && deletableCount < selected.length
              ? `You can delete ${deletableCount}`
              : undefined
          }
          onBack={exitSelection}
          actions={
            <>
              {singleRestrictable && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Who can see this"
                  onClick={() => setVisibilityFor(singleRestrictable)}
                >
                  <Lock className="h-5 w-5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Download selected"
                disabled={!selected.length || download.isStarting}
                onClick={() => void download.start(selected.map((item) => item.id))}
              >
                {download.isStarting ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Download className="h-5 w-5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete selected"
                disabled={deletableCount === 0 || deleteMany.isPending}
                onClick={() => setBulkDeleteOpen(true)}
                className="text-destructive"
              >
                {deleteMany.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Trash2 className="h-5 w-5" />
                )}
              </Button>
            </>
          }
        />
      ) : (
        <AppBar
          title={album.name}
          subtitle={
            <>
              {pluralize(album.stats.mediaCount, "item")} ·{" "}
              {pluralize(album.stats.contributorCount, "member")}
              {album.stats.storageBytes > 0 && ` · ${formatBytes(album.stats.storageBytes)}`}
            </>
          }
          onBack={() => navigate("/")}
          actions={
            <>
              <Button variant="ghost" size="icon" aria-label="Share album" onClick={() => setShareOpen(true)}>
                <Share2 className="h-5 w-5" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="More options">
                    <MoreVertical className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setSelectionMode(true)}>
                    <CheckSquare className="h-4 w-4" />
                    Select
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void download.start()}>
                    <Download className="h-4 w-4" />
                    Download album
                  </DropdownMenuItem>
                  {isAdmin && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setAdminOpen(true)}>
                        <Settings className="h-4 w-4" />
                        Album settings
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate("/")}>
                    <X className="h-4 w-4" />
                    Close album
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
      )}

      <main className="flex-1 px-2 pb-32 pt-2 sm:px-4">
        {album.description && !selectionMode && (
          <p className="px-1 pb-3 text-label text-muted-foreground">{album.description}</p>
        )}

        {items.length > 0 && !selectionMode && (
          <div className="mb-2 flex gap-2 overflow-x-auto px-1 pb-1 no-scrollbar">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                className={cn(
                  "press shrink-0 rounded-pill border px-4 py-2 text-label font-medium transition-colors",
                  filter === option.value
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-border bg-card text-text-secondary",
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
            onLongPress={startSelection}
          />
        )}
      </main>

      {/* The composer position: the one action this screen exists for. */}
      {!selectionMode && lightboxIndex === null && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          <Button
            size="lg"
            onClick={() => setUploadOpen(true)}
            className="pointer-events-auto w-full max-w-md shadow-lift"
          >
            <ImagePlus className="h-5 w-5" />
            Add photos &amp; videos
          </Button>
        </div>
      )}

      {lightboxIndex !== null && items[lightboxIndex] && (
        <Lightbox
          items={items}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onRequestDelete={setPendingDelete}
          onRequestVisibility={setVisibilityFor}
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
        albumName={album.name}
        code={data.joinCode ?? ""}
        isAdmin={isAdmin}
      />

      <VisibilitySheet
        albumId={albumId}
        item={visibilityFor}
        onOpenChange={(open) => !open && setVisibilityFor(null)}
        onUpdated={(media) => {
          replaceMedia(media);
          setVisibilityFor(null);
        }}
      />

      {isAdmin && (
        <AdminPanel
          open={adminOpen}
          onOpenChange={setAdminOpen}
          album={album}
          onDownloadAlbum={() => {
            setAdminOpen(false);
            void download.start();
          }}
        />
      )}

      {download.job && <DownloadStatus job={download.job} onDismiss={download.dismiss} />}

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete this {pendingDelete?.resourceType === "video" ? "video" : "photo"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the original{" "}
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
            <AlertDialogTitle>Delete {pluralize(deletableCount, "item")}?</AlertDialogTitle>
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

      <AlertDialog open={viewer.needsDisplayName}>
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
