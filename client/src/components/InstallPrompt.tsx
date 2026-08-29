import { Download, Share, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { isIos, isStandalone, onInstallAvailability, promptInstall } from "@/lib/pwa";

const DISMISSED_KEY = "sa_install_dismissed";

/**
 * Offers to install the app — but only once the person has actually used it,
 * and never again after they say no. iOS has no install API, so it gets the
 * one instruction that works there instead.
 */
export function InstallPrompt() {
  const [canInstall, setCanInstall] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (isStandalone()) return;
    try {
      if (localStorage.getItem(DISMISSED_KEY)) return;
    } catch {
      // Private browsing can throw on access; treat it as "not dismissed".
    }
    setDismissed(false);
    setShowIosHint(isIos());
    return onInstallAvailability(setCanInstall);
  }, []);

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* nothing we can do, and nothing that matters */
    }
  };

  if (dismissed || (!canInstall && !showIosHint)) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-panel border border-border bg-card p-3 shadow-lift">
        <img src="/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-card" />
        <div className="min-w-0 flex-1">
          <p className="text-label font-semibold">Add to Home Screen</p>
          <p className="truncate text-caption text-text-tertiary">
            {showIosHint ? (
              <>
                Tap <Share className="inline h-3 w-3" /> then "Add to Home Screen"
              </>
            ) : (
              "Opens full screen, like an app"
            )}
          </p>
        </div>
        {canInstall && (
          <Button
            size="sm"
            onClick={async () => {
              const installed = await promptInstall();
              if (installed) close();
            }}
          >
            <Download className="h-4 w-4" />
            Install
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" onClick={close} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
