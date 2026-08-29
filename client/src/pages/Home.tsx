import { ArrowRight, Download, Images, Lock, Share2, Upload } from "lucide-react";
import { Link } from "wouter";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { useMyAlbums } from "@/hooks/use-album";
import { pluralize } from "@/lib/format";

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
  const recentAlbums = data?.albums ?? [];

  return (
    <div className="relative overflow-hidden">
      {/* Soft ambient wash so the page reads premium without competing with photos. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,hsl(var(--primary)/0.18),transparent_70%)]"
      />

      <header className="relative">
        <div className="container flex h-20 items-center justify-between">
          <Logo />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/join">Have a code?</Link>
          </Button>
        </div>
      </header>

      <main className="relative">
        <section className="container pb-16 pt-8 sm:pb-24 sm:pt-16">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
              <Lock className="h-3 w-3" />
              Private by default
            </span>

            <h1 className="mt-6 text-balance text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
              Your memories.
              <br />
              <span className="text-primary">Together.</span>
            </h1>

            <p className="mx-auto mt-5 max-w-lg text-pretty text-lg text-muted-foreground">
              Create one shared album for your trip, festival, wedding or special event. Your
              friends have the photos you don't. Put them all in one place.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href="/create">
                  Create Album
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <Link href="/join">Join Album</Link>
              </Button>
            </div>

            <p className="mt-5 text-sm text-muted-foreground">
              No sign-up. Originals kept exactly as uploaded.
            </p>
          </div>

          {recentAlbums.length > 0 && (
            <div className="mx-auto mt-14 max-w-2xl">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Your albums on this device
              </h2>
              <ul className="grid gap-2">
                {recentAlbums.map(({ album, role }) => (
                  <li key={album.id}>
                    <Link
                      href={`/album/${album.id}`}
                      className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{album.name}</p>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {pluralize(album.stats.photoCount, "photo")} ·{" "}
                          {pluralize(album.stats.videoCount, "video")}
                          {role === "admin" && " · you created this"}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="border-t border-border/60 bg-muted/30 py-16 sm:py-20">
          <div className="container">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              How it works
            </h2>
            <ol className="mx-auto mt-10 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="rounded-2xl border border-border bg-card p-6 shadow-soft"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                      <step.icon className="h-5 w-5" />
                    </span>
                    <span className="text-sm font-semibold text-muted-foreground">
                      Step {index + 1}
                    </span>
                  </div>
                  <h3 className="mt-4 font-semibold">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="container py-16 sm:py-20">
          <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-3">
            <Feature
              title="Originals, untouched"
              body="A 12 MB HEIC stays a 12 MB HEIC. We never compress, convert or replace what you uploaded."
            />
            <Feature
              title="Only your group"
              body="No public browsing, no discovery feed. The code is the door, and you decide who gets it."
            />
            <Feature
              title="Everyone's camera roll"
              body="Each person deletes their own uploads. The album creator can tidy up anything."
            />
          </div>

          <div className="mx-auto mt-14 max-w-xl rounded-3xl border border-border bg-card p-8 text-center shadow-soft">
            <h2 className="text-2xl font-bold tracking-tight">Start your album</h2>
            <p className="mt-2 text-muted-foreground">
              One album. One code. Everyone's photos in one place.
            </p>
            <Button asChild size="lg" className="mt-6 w-full sm:w-auto">
              <Link href="/create">
                Create Album
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
