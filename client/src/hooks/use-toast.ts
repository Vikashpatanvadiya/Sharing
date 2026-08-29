import * as React from "react";
import type { ToastActionElement, ToastProps } from "@/components/ui/toast";

/** Small external store so any module (including plain functions) can toast. */
const TOAST_LIMIT = 3;
const TOAST_REMOVE_DELAY = 6000;

type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
};

let count = 0;
const nextId = () => {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return String(count);
};

interface State {
  toasts: ToasterToast[];
}

const listeners = new Set<(state: State) => void>();
let memoryState: State = { toasts: [] };
const timeouts = new Map<string, ReturnType<typeof setTimeout>>();

function setState(next: State) {
  memoryState = next;
  listeners.forEach((listener) => listener(memoryState));
}

function scheduleRemoval(id: string) {
  if (timeouts.has(id)) return;
  timeouts.set(
    id,
    setTimeout(() => {
      timeouts.delete(id);
      setState({ toasts: memoryState.toasts.filter((t) => t.id !== id) });
    }, TOAST_REMOVE_DELAY),
  );
}

export function toast({
  duration,
  ...props
}: Omit<ToasterToast, "id"> & { duration?: number }) {
  const id = nextId();

  const dismiss = () => {
    setState({
      toasts: memoryState.toasts.map((t) => (t.id === id ? { ...t, open: false } : t)),
    });
    scheduleRemoval(id);
  };

  setState({
    toasts: [
      {
        ...props,
        id,
        open: true,
        duration: duration ?? (props.variant === "destructive" ? 8000 : 4500),
        onOpenChange: (open: boolean) => {
          if (!open) dismiss();
        },
      },
      ...memoryState.toasts,
    ].slice(0, TOAST_LIMIT),
  });

  return { id, dismiss };
}

export function useToast() {
  const [state, setLocalState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    listeners.add(setLocalState);
    return () => {
      listeners.delete(setLocalState);
    };
  }, []);

  return { ...state, toast };
}
