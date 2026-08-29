import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaItem } from "@shared/types/index";
import { UploadQueue, type QueueSnapshot } from "@/lib/upload-queue";

const EMPTY: QueueSnapshot = {
  tasks: [],
  total: 0,
  completed: 0,
  failed: 0,
  active: 0,
  waiting: 0,
  duplicates: 0,
  retryable: 0,
  overallProgress: 0,
  totalBytes: 0,
  sentBytes: 0,
  speed: 0,
  isUploading: false,
};

/**
 * Binds an UploadQueue to React. The queue itself lives outside React state so
 * progress events never trigger a re-render storm; the component only ever sees
 * one coalesced snapshot per frame.
 */
export function useUpload(albumId: string, onMediaAdded: (media: MediaItem) => void) {
  const [snapshot, setSnapshot] = useState<QueueSnapshot>(EMPTY);
  const callbackRef = useRef(onMediaAdded);
  callbackRef.current = onMediaAdded;

  const queue = useMemo(
    () => new UploadQueue(albumId, (media) => callbackRef.current(media)),
    [albumId],
  );

  useEffect(() => queue.subscribe(setSnapshot), [queue]);

  useEffect(() => () => queue.cancelAll(), [queue]);

  // Closing the tab mid-upload loses the remaining files; warn first.
  useEffect(() => {
    if (!snapshot.isUploading) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [snapshot.isUploading]);

  const addFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files) return;
      const list = Array.from(files).filter((file) => file.size > 0);
      if (list.length) queue.add(list);
    },
    [queue],
  );

  return {
    snapshot,
    addFiles,
    retry: useCallback((id: string) => queue.retry(id), [queue]),
    retryFailed: useCallback(() => queue.retryFailed(), [queue]),
    cancel: useCallback((id: string) => queue.cancel(id), [queue]),
    cancelAll: useCallback(() => queue.cancelAll(), [queue]),
    keepDuplicate: useCallback((id: string) => queue.keepDuplicate(id), [queue]),
    discardDuplicate: useCallback((id: string) => queue.discardDuplicate(id), [queue]),
    clearFinished: useCallback(() => queue.clearFinished(), [queue]),
    reset: useCallback(() => queue.reset(), [queue]),
  };
}

export type UploadController = ReturnType<typeof useUpload>;
