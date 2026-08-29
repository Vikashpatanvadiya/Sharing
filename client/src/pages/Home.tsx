import { ArrowRight, ChevronRight, Download, Images, Lock, Share2, Upload } from "lucide-react";
import { Link } from "wouter";
import { InstallPrompt } from "@/components/InstallPrompt";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { useMyAlbums } from "@/hooks/use-album";
import { formatRelative, pluralize } from "@/lib/format";

const STEPS = [
  {
    icon: Images,
    title: "Create an album",
    body: "Name it after the trip, the wedding, the weekend. Takes about ten seconds.",
  },
  {
    icon: Share2,
    title: "Share the code",
    body: "Six characters. Drop it in the group chat and you're done.",
  },
  {
    icon: Upload,
    title: "Everyone uploads",
    body: "No accounts, no app to install. Photos and videos go up at full quality.",
  },
  {
    icon: Download,
    title: "Everyone downloads",
    body: "Grab a single photo or the whole album as a ZIP of the original files.",
  },
];

export default function HomePage() {
  const { data } = useMyAlbums();
  const albums = data?.albums ?? [];

  return (
    <div className="relative min-h-[100dvh]">
      <div className="hero-wash absolute inset-x-0 top-0 h-[460px]" aria-hidden />

      <header className="relative safe-top">
        <div className="container flex h-16 items-center justify-between">
          <Logo />
          <Button asChild variant="ghost" size="sm">
            <Link href="/join">Have a code?</Link>
          </Button>
        </div>
      </header>

      <main className="relative">
        <section className="container pb-10 pt-6 text-center sm:pb-16 sm:pt-12">
          <span className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-card/70 px-3 py-1.5 text-eyebrow font-medium uppercase text-text-tertiary backdrop-blur">
            <Lock className="h-3 w-3" />
            Private by default
          </span>

          <h1 className="display-heading mt-5 text-display text-text-primary">
            Your memories.
            <br />
            Together.
          </h1>

          <p className="mx-auto mt-4 max-w-md text-pretty text-body text-text-secondary">
            One shared album for your trip, festival or wedding. Your friends have the photos you
            don't — put them all in one place.
          </p>

          <div className="mx-auto mt-8 flex w-full max-w-md flex-col gap-3 sm:max-w-xl sm:flex-row sm:justify-center">
            <Button asChild size="lg" className="w-full sm:w-auto sm:min-w-[13rem]">
              <Link href="/create">
                Create Album
                <ArrowRight className="h-[18px] w-[18px]" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto sm:min-w-[13rem]">
              <Link href="/join">Join Album</Link>
            </Button>
          </div>

          <p className="mt-4 text-caption text-text-tertiary">
            No sign-up. Originals kept exactly as uploaded.
          </p>
        </section>

        {/* The albums you already have, in the position a chat list occupies. */}
        {albums.length > 0 && (
          <section className="container pb-8">
            <h2 className="mb-2 px-1 text-eyebrow font-medium uppercase text-text-tertiary">
              Your albums
            </h2>
            <ul className="overflow-hidden rounded-panel border border-border bg-card">
              {albums.map(({ album, role }, position) => (
                <li key={album.id} className={position > 0 ? "border-t border-border" : undefined}>
                  <Link
                    href={`/album/${album.id}`}
                    className="press flex min-h-[68px] items-center gap-3 px-4 py-3 transition-colors active:bg-secondary"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-card bg-accent text-subheading font-semibold text-accent-foreground">
                      {album.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium">{album.name}</span>
                      <span className="block truncate text-caption text-text-tertiary">
                        {pluralize(album.stats.photoCount, "photo")} ·{" "}
                        {pluralize(album.stats.videoCount, "video")}
                        {role === "admin" && " · you created this"}
                      </span>
                    </span>
                    <span className="shrink-0 text-caption text-text-tertiary">
                      {formatRelative(album.createdAt)}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-text-tertiary" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="border-t border-border bg-secondary/50 py-12 sm:py-16">
          <div className="container">
            <h2 className="text-center font-display text-section text-text-primary">
              How it works
            </h2>
            <ol className="mx-auto mt-8 grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, position) => (
                <li key={step.title} className="rounded-panel border border-border bg-card p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-card bg-accent text-accent-foreground">
                      <step.icon className="h-5 w-5" />
                    </span>
                    <span className="text-eyebrow font-medium uppercase text-text-tertiary">
                      Step {position + 1}
                    </span>
                  </div>
                  <h3 className="mt-3.5 text-body font-semibold">{step.title}</h3>
                  <p className="mt-1.5 text-label leading-relaxed text-text-tertiary">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="container py-12 sm:py-16">
          <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-3">
            <Feature
              title="Originals, untouched"
              body="A 12 MB HEIC stays a 12 MB HEIC. Nothing is compressed, converted or replaced."
            />
            <Feature
              title="Only your group"
              body="No public browsing, no discovery feed. The code is the door, and you decide who gets it."
            />
            <Feature
              title="Private when you want"
              body="Keep a photo to yourself, or share it with just a few people in the album."
            />
          </div>

          <div className="mx-auto mt-12 max-w-xl rounded-panel border border-border bg-card p-7 text-center">
            <h2 className="font-display text-section">Start your album</h2>
            <p className="mt-2 text-body text-text-tertiary">
              One album. One code. Everyone's photos in one place.
            </p>
            <Button asChild size="lg" className="mt-5 w-full sm:w-auto">
              <Link href="/create">
                Create Album
                <ArrowRight className="h-[18px] w-[18px]" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <InstallPrompt />
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="text-body font-semibold">{title}</h3>
      <p className="mt-1.5 text-label leading-relaxed text-text-tertiary">{body}</p>
    </div>
  );
}
