/**
 * Service-worker registration and the install prompt.
 *
 * The worker is only registered in production: in development it would sit
 * between Vite and the browser and serve stale modules.
 */

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<(available: boolean) => void>();

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari predates the display-mode media query.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export function onInstallAvailability(listener: (available: boolean) => void): () => void {
  installListeners.add(listener);
  listener(deferredPrompt !== null);
  return () => installListeners.delete(listener);
}

function notify() {
  installListeners.forEach((listener) => listener(deferredPrompt !== null));
}

/** Shows the browser's own install sheet. Returns true if the app was added. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const event = deferredPrompt;
  deferredPrompt = null;
  notify();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}

export function registerPwa(onUpdateReady: () => void): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Keep the event so the app can offer installation at a sensible moment
    // rather than letting the browser interrupt with its own bar.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });

  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // A new worker is waiting and an old one is in control: there is a
            // newer version of the app available.
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              onUpdateReady();
            }
          });
        });
      })
      .catch(() => {
        // An unavailable worker must never break the app itself.
      });
  });
}

export function applyUpdate(): void {
  void navigator.serviceWorker?.getRegistration().then((registration) => {
    registration?.waiting?.postMessage("SKIP_WAITING");
    // The new worker takes control on the next load.
    window.location.reload();
  });
}
