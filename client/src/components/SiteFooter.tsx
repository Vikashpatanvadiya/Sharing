import { useLocation } from "wouter";

export function SiteFooter() {
  const [location] = useLocation();
  // Only the landing page is a "web page"; the rest are app screens where a
  // footer would just be something else to scroll past.
  if (location !== "/") return null;

  return (
    <footer className="border-t border-border py-8">
      <div className="container flex flex-col items-center gap-2 text-center text-label text-text-tertiary">
        <p>Private shared albums. Only people with the code can see your memories.</p>
        <p className="text-caption">No accounts. No public feed. No algorithm.</p>
      </div>
    </footer>
  );
}
