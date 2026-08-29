import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="container flex min-h-[70dvh] max-w-md flex-col items-center justify-center text-center">
      <p className="text-eyebrow font-medium uppercase text-text-tertiary">404</p>
      <h1 className="mt-3 font-display text-section">Page not found</h1>
      <p className="mt-2 text-body text-text-tertiary">
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
