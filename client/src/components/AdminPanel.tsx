import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  Download,
  HardDrive,
  Images,
  Loader2,
  RefreshCw,
  Trash2,
  Users,
  Video,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import type { AlbumResponse } from "@shared/types/index";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { albumKeys, useAdminDashboard } from "@/hooks/use-album";
import { useCopy } from "@/hooks/use-copy";
import { toast } from "@/hooks/use-toast";
import { api, ApiRequestError } from "@/lib/api";
import { formatBytes, formatDate, formatRelative, pluralize } from "@/lib/format";

interface AdminPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  album: AlbumResponse["album"];
  onDownloadAlbum: () => void;
}

export function AdminPanel({ open, onOpenChange, album, onDownloadAlbum }: AdminPanelProps) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { data: dashboard, isLoading } = useAdminDashboard(album.id, open);
  const { copied, copy } = useCopy();

  const [view, setView] = useState<"overview" | "edit" | "regenerate" | "delete">("overview");
  const [name, setName] = useState(album.name);
  const [description, setDescription] = useState(album.description ?? "");
  const [eventDate, setEventDate] = useState(album.eventDate ?? "");
  const [revokeSessions, setRevokeSessions] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  const closeAndReset = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setView("overview");
      setConfirmName("");
      setRevokeSessions(false);
    }
  };

  const updateMutation = useMutation({
    mutationFn: () =>
      api.updateAlbum(album.id, {
        name: name.trim(),
        description: description.trim() || null,
        eventDate: eventDate || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["album", album.id] });
      toast({ title: "Album updated" });
      setView("overview");
    },
    onError: (error) => showError(error, "Could not update the album"),
  });

  const regenerateMutation = useMutation({
    mutationFn: () => api.regenerateCode(album.id, revokeSessions),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["album", album.id] });
      toast({
        title: "New code generated",
        description: result.revokedSessions
          ? `${pluralize(result.revokedSessions, "person")} will need the new code to get back in.`
          : "The old code no longer works for new people.",
      });
      setView("overview");
      setRevokeSessions(false);
    },
    onError: (error) => showError(error, "Could not regenerate the code"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteAlbum(album.id, confirmName.trim()),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: albumKeys.mine });
      toast({
        title: "Album deleted",
        description:
          result.warning ?? `${pluralize(result.deletedMedia, "file")} removed from storage.`,
        variant: result.warning ? "destructive" : "default",
      });
      navigate("/");
    },
    onError: (error) => showError(error, "Could not delete the album"),
  });

  const stats = dashboard?.album.stats ?? album.stats;

  return (
    <Dialog open={open} onOpenChange={closeAndReset}>
      <DialogContent className="sm:max-w-lg">
        {view === "overview" && (
          <>
            <DialogHeader>
              <DialogTitle>{album.name}</DialogTitle>
              <DialogDescription>
                Created {formatDate(album.createdAt)}
                {album.eventDate ? ` · Event on ${formatDate(album.eventDate)}` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-2">
              <Stat icon={Images} label="Photos" value={stats.photoCount.toLocaleString()} />
              <Stat icon={Video} label="Videos" value={stats.videoCount.toLocaleString()} />
              <Stat icon={Users} label="Contributors" value={stats.contributorCount.toLocaleString()} />
              <Stat icon={HardDrive} label="Storage" value={formatBytes(stats.storageBytes)} />
            </div>

            <div className="rounded-panel border border-border bg-secondary/60 p-4">
              <p className="text-eyebrow font-medium uppercase text-text-tertiary">Album code</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="selectable text-subheading font-bold tracking-[0.28em]">
                  {dashboard?.joinCode ?? "······"}
                </p>
                <div className="flex gap-1">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Copy code"
                    disabled={!dashboard?.joinCode}
                    onClick={async () => {
                      if (!dashboard?.joinCode) return;
                      const ok = await copy(dashboard.joinCode);
                      if (ok) toast({ title: "Code copied" });
                    }}
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Regenerate code"
                    onClick={() => setView("regenerate")}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center gap-2 text-label text-text-tertiary">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading album details…
              </div>
            ) : (
              dashboard && dashboard.contributors.length > 0 && (
                <div>
                  <p className="mb-2 text-eyebrow font-medium uppercase text-text-tertiary">
                    Contributors
                  </p>
                  <ul className="max-h-44 space-y-1 overflow-y-auto scroll-pane pr-1">
                    {dashboard.contributors.map((contributor) => (
                      <li
                        key={contributor.id}
                        className="flex min-h-11 items-center justify-between gap-3 rounded-card px-2 py-1.5 text-label"
                      >
                        <span className="truncate font-medium">{contributor.displayName}</span>
                        <span className="shrink-0 text-caption text-text-tertiary">
                          {pluralize(contributor.mediaCount, "upload")} ·{" "}
                          {formatRelative(contributor.lastSeenAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            )}

            <div className="grid gap-2">
              <p className="text-eyebrow font-medium uppercase text-text-tertiary">Album management</p>
              <Button variant="outline" onClick={() => setView("edit")}>
                Edit album details
              </Button>
              <Button variant="outline" onClick={onDownloadAlbum}>
                <Download className="h-4 w-4" />
                Download album
              </Button>
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setView("delete")}
              >
                <Trash2 className="h-4 w-4" />
                Delete album
              </Button>
            </div>
          </>
        )}

        {view === "edit" && (
          <>
            <DialogHeader>
              <DialogTitle>Edit album</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                updateMutation.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="edit-name">Album name</Label>
                <Input
                  id="edit-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Textarea
                  id="edit-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={500}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-date">Event date</Label>
                <Input
                  id="edit-date"
                  type="date"
                  value={eventDate}
                  onChange={(event) => setEventDate(event.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setView("overview")}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateMutation.isPending || !name.trim()}>
                  Save changes
                </Button>
              </DialogFooter>
            </form>
          </>
        )}

        {view === "regenerate" && (
          <>
            <DialogHeader>
              <DialogTitle>Regenerate album code?</DialogTitle>
              <DialogDescription>
                A new code is generated and the current one stops working for anyone trying to join.
              </DialogDescription>
            </DialogHeader>

            <label className="flex cursor-pointer items-start gap-3 rounded-card border border-border p-4">
              <Checkbox
                checked={revokeSessions}
                onCheckedChange={(checked) => setRevokeSessions(checked === true)}
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium">Also sign out everyone who already joined</span>
                <span className="mt-1 block text-caption text-text-tertiary">
                  They'll need the new code to get back in. Their uploads stay in the album. Leave
                  this off to keep existing members signed in.
                </span>
              </span>
            </label>

            <DialogFooter>
              <Button variant="outline" onClick={() => setView("overview")}>
                Cancel
              </Button>
              <Button onClick={() => regenerateMutation.mutate()} disabled={regenerateMutation.isPending}>
                {regenerateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Regenerate
              </Button>
            </DialogFooter>
          </>
        )}

        {view === "delete" && (
          <>
            <DialogHeader>
              <DialogTitle>Delete {album.name}?</DialogTitle>
              <DialogDescription>This action cannot be undone.</DialogDescription>
            </DialogHeader>

            <div className="rounded-card border border-destructive/30 bg-destructive/5 p-4 text-label">
              <p className="font-medium text-destructive">This will permanently delete:</p>
              <ul className="mt-2 space-y-0.5 text-text-tertiary">
                <li>{pluralize(stats.photoCount, "photo")}</li>
                <li>{pluralize(stats.videoCount, "video")}</li>
                <li>{pluralize(stats.contributorCount, "contributor")}</li>
              </ul>
              <p className="mt-3 text-text-tertiary">
                The media will also be deleted from storage.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-name">
                Type <span className="font-semibold text-foreground">{album.name}</span> to confirm
              </Label>
              <Input
                id="confirm-name"
                value={confirmName}
                onChange={(event) => setConfirmName(event.target.value)}
                autoComplete="off"
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setView("overview")}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={confirmName.trim() !== album.name || deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
              >
                {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Permanently delete album
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Images;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-card border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-caption text-text-tertiary">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1 text-subheading font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function showError(error: unknown, title: string) {
  toast({
    variant: "destructive",
    title,
    description:
      error instanceof ApiRequestError ? error.message : "Please try again in a moment.",
  });
}
