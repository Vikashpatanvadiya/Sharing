import { useLocation } from "wouter";

export function SiteFooter() {
  const [location] = useLocation();
  // The album view is a full-bleed gallery; a footer would only get in the way.
  if (location.startsWith("/album/")) return null;

  return (
    <footer className="border-t border-border/60 py-8">
      <div className="container flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
        <p>Private shared albums. Only people with the code can see your memories.</p>
        <p className="text-xs">No accounts. No public feed. No algorithm.</p>
      </div>
    </footer>
  );
}
