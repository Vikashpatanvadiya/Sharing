import { useCallback, useRef } from "react";

interface LongPressOptions {
  onLongPress: () => void;
  onClick?: () => void;
  /** Milliseconds to hold. 400ms matches the feel of native photo pickers. */
  delay?: number;
  /** Movement in px that counts as a scroll and cancels the press. */
  moveTolerance?: number;
}

/**
 * Long-press to start selecting, tap to open — the interaction people already
 * know from their phone's gallery and from WhatsApp.
 *
 * Cancels on scroll so it never fires while someone is flicking through the
 * grid, and fires a short haptic tick when it does, which is most of what makes
 * it feel physical.
 */
export function useLongPress({
  onLongPress,
  onClick,
  delay = 400,
  moveTolerance = 10,
}: LongPressOptions) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const start = useRef<{ x: number; y: number } | null>(null);
  const triggered = useRef(false);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Ignore right-click and secondary buttons.
      if (event.button !== 0 && event.pointerType === "mouse") return;
      triggered.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        triggered.current = true;
        navigator.vibrate?.(12);
        onLongPress();
      }, delay);
    },
    [delay, onLongPress],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!start.current || !timer.current) return;
      const dx = Math.abs(event.clientX - start.current.x);
      const dy = Math.abs(event.clientY - start.current.y);
      if (dx > moveTolerance || dy > moveTolerance) clear();
    },
    [clear, moveTolerance],
  );

  const onPointerUp = useCallback(() => {
    clear();
    // A long press already did its job; don't also treat it as a tap.
    if (!triggered.current) onClick?.();
    triggered.current = false;
    start.current = null;
  }, [clear, onClick]);

  const onPointerLeave = useCallback(() => {
    clear();
    triggered.current = false;
    start.current = null;
  }, [clear]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  };
}
