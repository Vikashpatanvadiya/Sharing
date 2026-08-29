import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Globe, Loader2, Lock, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { MediaItem } from "@shared/types/index";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { api, ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/utils";

interface VisibilitySheetProps {
  albumId: string;
  item: MediaItem | null;
  onOpenChange: (open: boolean) => void;
  onUpdated: (media: MediaItem) => void;
}

/**
 * Chooses who can see one photo.
 *
 * "Everyone in the album" is the default and the common case. Picking specific
 * people hides the photo from everybody else — the server filters it out of
 * their gallery, their downloads and their album ZIP, so this is real access
 * control rather than a UI-only toggle.
 */
export function VisibilitySheet({ albumId, item, onOpenChange, onUpdated }: VisibilitySheetProps) {
  const queryClient = useQueryClient();
  const open = Boolean(item);

  const membersQuery = useQuery({
    queryKey: ["album", albumId, "members"],
    queryFn: () => api.albumMembers(albumId),
    enabled: open,
    staleTime: 30_000,
  });

  const [restricted, setRestricted] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Re-seed from the item each time the sheet opens.
  useEffect(() => {
    if (!item) return;
    setRestricted(item.visibility === "restricted");
    setSelected(new Set(item.visibleTo));
  }, [item?.id, item?.visibility, item?.visibleTo.join(",")]);

  const save = useMutation({
    mutationFn: () => api.setMediaVisibility(item!.id, restricted, [...selected]),
    onSuccess: (result) => {
      onUpdated(result.media);
      void queryClient.invalidateQueries({ queryKey: ["album", albumId] });
      toast({
        title: result.media.visibility === "restricted" ? "Now private" : "Shared with the album",
        description:
          result.media.visibility === "restricted"
            ? `Only you${result.media.visibleTo.length ? ` and ${result.media.visibleTo.length} other${result.media.visibleTo.length === 1 ? "" : "s"}` : ""} can see this.`
            : "Everyone in the album can see this again.",
      });
      onOpenChange(false);
    },
    onError: (error) =>
      toast({
        variant: "destructive",
        title: "Could not update",
        description: error instanceof ApiRequestError ? error.message : "Please try again.",
      }),
  });

  // Everyone except the person editing — they always keep access.
  const members = (membersQuery.data?.members ?? []).filter((member) => !member.isYou);

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setRestricted(true);
    navigator.vibrate?.(8);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Who can see this?</DialogTitle>
          <DialogDescription className="selectable">
            {item?.originalFilename}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              setRestricted(false);
              setSelected(new Set());
            }}
            className={cn(
              "flex min-h-14 items-center gap-3 rounded-card border px-4 py-3 text-left transition-colors press",
              !restricted ? "border-brand-indigo bg-accent" : "border-border bg-card",
            )}
          >
            <Globe className={cn("h-5 w-5 shrink-0", !restricted && "text-brand-indigo")} />
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium">Everyone in the album</span>
              <span className="block text-caption text-muted-foreground">
                Anyone with the album code
              </span>
            </span>
            {!restricted && <Check className="h-5 w-5 shrink-0 text-brand-indigo" />}
          </button>

          <button
            type="button"
            onClick={() => setRestricted(true)}
            className={cn(
              "flex min-h-14 items-center gap-3 rounded-card border px-4 py-3 text-left transition-colors press",
              restricted ? "border-brand-indigo bg-accent" : "border-border bg-card",
            )}
          >
            <Lock className={cn("h-5 w-5 shrink-0", restricted && "text-brand-indigo")} />
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium">Only specific people</span>
              <span className="block text-caption text-muted-foreground">
                Hidden from everyone else in the album
              </span>
            </span>
            {restricted && <Check className="h-5 w-5 shrink-0 text-brand-indigo" />}
          </button>
        </div>

        {restricted && (
          <div className="animate-fade-in">
            <p className="mb-2 flex items-center gap-1.5 text-eyebrow font-medium uppercase text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              Choose people
            </p>

            {membersQuery.isLoading ? (
              <div className="flex items-center gap-2 py-4 text-label text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading members…
              </div>
            ) : members.length === 0 ? (
              <p className="rounded-card bg-secondary px-4 py-3 text-label text-muted-foreground">
                Nobody else has joined this album yet. Share the code first.
              </p>
            ) : (
              <ul className="max-h-[38dvh] overflow-y-auto scroll-pane">
                {members.map((member) => {
                  const isOn = selected.has(member.id);
                  return (
                    <li key={member.id}>
                      <button
                        type="button"
                        onClick={() => toggle(member.id)}
                        className="flex min-h-14 w-full items-center gap-3 rounded-card px-2 py-2 text-left transition-colors hover:bg-secondary"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-secondary text-label font-semibold text-text-secondary">
                          {member.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-body font-medium">
                          {member.displayName}
                          {member.isAdmin && (
                            <span className="ml-1.5 text-caption font-medium text-muted-foreground">
                              creator
                            </span>
                          )}
                        </span>
                        <span
                          className={cn(
                            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
                            isOn ? "border-brand-indigo bg-brand-indigo text-white" : "border-input",
                          )}
                        >
                          {isOn && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="mt-2 text-caption text-muted-foreground">
              The album creator can always see everything.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || (restricted && selected.size === 0)}
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
