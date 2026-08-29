import { useMutation } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, KeyRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { albumKeys } from "@/hooks/use-album";
import { api, ApiRequestError } from "@/lib/api";

export default function JoinAlbumPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [step, setStep] = useState<"code" | "name">("code");
  const [error, setError] = useState<string | null>(null);
  const pendingCode = useRef("");

  // A shared link can carry the code: /join?code=G7X92P
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("code");
    if (fromUrl) setCode(fromUrl.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12));
  }, []);

  const joinMutation = useMutation({
    mutationFn: (input: { code: string; displayName?: string }) => api.joinAlbum(input),
    onSuccess: (result) => {
      queryClient.setQueryData(albumKeys.album(result.album.id), result);
      void queryClient.invalidateQueries({ queryKey: albumKeys.mine });

      if (result.viewer.needsDisplayName) {
        pendingCode.current = result.album.id;
        setStep("name");
        return;
      }
      navigate(`/album/${result.album.id}`);
    },
    onError: (err) => {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Album not found. Please check your code and try again.",
      );
    },
  });

  const nameMutation = useMutation({
    mutationFn: (name: string) => api.setDisplayName(pendingCode.current, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: albumKeys.album(pendingCode.current) });
      navigate(`/album/${pendingCode.current}`);
    },
    onError: () => navigate(`/album/${pendingCode.current}`),
  });

  if (step === "name") {
    return (
      <div className="container flex min-h-[100dvh] max-w-md flex-col justify-center py-12">
        <div className="animate-fade-in rounded-3xl border border-border bg-card p-8 shadow-lift">
          <h1 className="text-2xl font-bold tracking-tight">What's your name?</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            So everyone knows who added which photos. You can skip this.
          </p>

          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (displayName.trim()) nameMutation.mutate(displayName.trim());
              else navigate(`/album/${pendingCode.current}`);
            }}
          >
            <Input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Vikash"
              maxLength={60}
              autoFocus
              autoComplete="name"
              aria-label="Your name"
            />
            <Button type="submit" size="lg" className="w-full" disabled={nameMutation.isPending}>
              Continue
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => navigate(`/album/${pendingCode.current}`)}
            >
              Skip for now
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-md py-8 sm:py-12">
      <div className="mb-10 flex items-center justify-between">
        <Logo />
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
      </div>

      <div className="rounded-3xl border border-border bg-card p-8 shadow-soft">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <KeyRound className="h-6 w-6" />
        </span>

        <h1 className="mt-5 text-2xl font-bold tracking-tight">Join an album</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter the code the album creator shared with you.
        </p>

        <form
          className="mt-7 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const trimmed = code.trim();
            if (trimmed.length < 4) {
              setError("Please enter the full album code.");
              return;
            }
            joinMutation.mutate({ code: trimmed });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="join-code">Album code</Label>
            <Input
              id="join-code"
              value={code}
              onChange={(event) => {
                setError(null);
                setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12));
              }}
              placeholder="G7X92P"
              className="h-16 text-center font-mono text-2xl font-semibold uppercase tracking-[0.4em]"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              autoFocus
              aria-invalid={Boolean(error)}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={joinMutation.isPending || code.trim().length < 4}
          >
            {joinMutation.isPending ? "Checking..." : "Join Album"}
          </Button>
        </form>
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don't have a code?{" "}
        <Link href="/create" className="font-medium text-primary hover:underline">
          Create your own album
        </Link>
      </p>
    </div>
  );
}
