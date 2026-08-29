import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, PartyPopper, Share2 } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "@/components/Logo";
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
      <div className="container flex min-h-[100dvh] max-w-lg flex-col justify-center py-12">
        <div className="animate-fade-in rounded-3xl border border-border bg-card p-8 text-center shadow-lift">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <PartyPopper className="h-7 w-7" />
          </span>

          <h1 className="mt-5 text-2xl font-bold tracking-tight">Album created</h1>
          <p className="mt-1.5 text-muted-foreground">{created.name}</p>

          <div className="mt-7 rounded-2xl border border-dashed border-primary/40 bg-accent/40 px-6 py-7">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Album code
            </p>
            <p className="code-chip mt-2 text-foreground">{created.code}</p>
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

          <p className="mt-6 text-sm text-muted-foreground">
            Share this code with your friends. Anyone with it can view and add photos.
          </p>

          <Button className="mt-6 w-full" size="lg" onClick={() => navigate(`/album/${created.albumId}`)}>
            Open album
          </Button>

          <p className="mt-4 text-xs text-muted-foreground">
            You're the album creator on this device. Keep using this browser to manage the album.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-lg py-8 sm:py-12">
      <div className="mb-8 flex items-center justify-between">
        <Logo />
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
      </div>

      <h1 className="text-3xl font-bold tracking-tight">Create your album</h1>
      <p className="mt-2 text-muted-foreground">
        You'll get a private code to share with everyone you want in it.
      </p>

      <form
        className="mt-8 space-y-5"
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
            Description <span className="font-normal text-muted-foreground">(optional)</span>
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
            Event date <span className="font-normal text-muted-foreground">(optional)</span>
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
            Your name <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="creator-name"
            value={creatorName}
            onChange={(event) => setCreatorName(event.target.value)}
            placeholder="Vikash"
            maxLength={60}
            autoComplete="name"
          />
          <p className="text-xs text-muted-foreground">Shown next to the photos you upload.</p>
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
  );
}
