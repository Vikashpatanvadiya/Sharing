import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="container flex min-h-[70dvh] max-w-md flex-col items-center justify-center text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">404</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-2 text-muted-foreground">
        That link doesn't lead anywhere. Albums are only reachable with their code.
      </p>
      <div className="mt-7 flex flex-col gap-2 sm:flex-row">
        <Button asChild>
          <Link href="/">Go home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/join">Enter an album code</Link>
        </Button>
      </div>
    </div>
  );
}
