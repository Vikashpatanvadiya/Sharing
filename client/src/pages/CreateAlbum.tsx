import { useMutation } from "@tanstack/react-query";
import { Check, Copy, PartyPopper, Share2 } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { AppBar } from "@/components/AppBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useCopy } from "@/hooks/use-copy";
import { api, ApiRequestError } from "@/lib/api";
import { shareAlbum } from "@/lib/share";

export default function CreateAlbumPage() {
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [created, setCreated] = useState<{ albumId: string; name: string; code: string } | null>(
    null,
  );
  const { copied, copy } = useCopy();

  const createMutation = useMutation({
    mutationFn: () =>
      api.createAlbum({
        name: name.trim(),
        description: description.trim() || null,
        eventDate: eventDate || null,
        creatorName: creatorName.trim() || null,
      }),
    onSuccess: (result) => {
      setCreated({ albumId: result.album.id, name: result.album.name, code: result.joinCode });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Could not create album",
        description:
          error instanceof ApiRequestError ? error.message : "Please try again in a moment.",
      });
    },
  });

  if (created) {
    return (
      <div className="container flex min-h-[100dvh] max-w-lg flex-col justify-center py-10">
        <div className="animate-fade-in rounded-panel border border-border bg-card p-7 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-panel bg-accent text-accent-foreground">
            <PartyPopper className="h-7 w-7" />
          </span>

          <h1 className="mt-5 font-display text-section">Album created</h1>
          <p className="mt-1.5 text-body text-text-tertiary">{created.name}</p>

          <div className="mt-6 rounded-panel border border-dashed border-brand-indigo/40 bg-accent px-6 py-7">
            <p className="text-eyebrow font-medium uppercase text-text-tertiary">Album code</p>
            <p className="code-chip selectable mt-2 text-text-primary">{created.code}</p>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              onClick={async () => {
                const ok = await copy(created.code);
                if (ok) toast({ title: "Code copied" });
              }}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy code"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void shareAlbum(created.name, created.code)}
            >
              <Share2 className="h-4 w-4" />
              Share
            </Button>
          </div>

          <p className="mt-6 text-label text-text-tertiary">
            Share this code with your friends. Anyone with it can view and add photos.
          </p>

          <Button className="mt-6 w-full" size="lg" onClick={() => navigate(`/album/${created.albumId}`)}>
            Open album
          </Button>

          <p className="mt-4 text-caption text-text-tertiary">
            You're the album creator on this device. Keep using this browser to manage the album.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh]">
      <AppBar title="New album" onBack={() => navigate("/")} />

      <div className="container max-w-lg pb-12 pt-6">
        <h1 className="font-display text-section">Create your album</h1>
        <p className="mt-2 text-body text-text-tertiary">
          You'll get a private code to share with everyone you want in it.
        </p>

        <form
          className="mt-7 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            createMutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="album-name">Album name</Label>
            <Input
              id="album-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Goa Trip 2026"
              maxLength={120}
              required
              autoFocus
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="album-description">
              Description <span className="font-regular text-text-tertiary">(optional)</span>
            </Label>
            <Textarea
              id="album-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Our Goa trip memories"
              maxLength={500}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="album-date">
              Event date <span className="font-regular text-text-tertiary">(optional)</span>
            </Label>
            <Input
              id="album-date"
              type="date"
              value={eventDate}
              onChange={(event) => setEventDate(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="creator-name">
              Your name <span className="font-regular text-text-tertiary">(optional)</span>
            </Label>
            <Input
              id="creator-name"
              value={creatorName}
              onChange={(event) => setCreatorName(event.target.value)}
              placeholder="Vikash"
              maxLength={60}
              autoComplete="name"
            />
            <p className="text-caption text-text-tertiary">Shown next to the photos you upload.</p>
          </div>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={createMutation.isPending || !name.trim()}
            >
              {createMutation.isPending ? "Creating..." : "Create Album"}
            </Button>
          </form>
      </div>
    </div>
  );
}
