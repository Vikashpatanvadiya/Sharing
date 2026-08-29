import { useEffect, useRef } from "react";

/**
 * Makes the device Back gesture close an overlay instead of leaving the app.
 *
 * When `active` becomes true a history entry is pushed; Back pops it and calls
 * `onBack` rather than navigating away. Closing the overlay any other way
 * (a Cancel button, Escape) removes the entry again, so the history stack never
 * accumulates phantom steps.
 *
 * This is what separates a web page from something that feels like an app on
 * Android and in an installed PWA, where Back is the primary navigation.
 */
export function useBackGuard(active: boolean, onBack: () => void): void {
  const pushedRef = useRef(false);
  const handlerRef = useRef(onBack);
  handlerRef.current = onBack;

  useEffect(() => {
    if (!active) return;

    const marker = { __backGuard: Date.now() };
    window.history.pushState(marker, "");
    pushedRef.current = true;

    const onPopState = () => {
      // The entry is already gone; just run the close handler.
      pushedRef.current = false;
      handlerRef.current();
    };

    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
      // Dismissed without Back: take our entry back off the stack so a later
      // Back press goes where the user expects.
      if (pushedRef.current) {
        pushedRef.current = false;
        window.history.back();
      }
    };
  }, [active]);
}
