import { useCallback, useEffect, useRef, useState } from "react";
import type { DownloadJob } from "@shared/types/index";
import { api, ApiRequestError } from "@/lib/api";
import { toast } from "./use-toast";

/**
 * Kicks off a server-side ZIP build and polls until it is ready. Nothing is
 * held in browser memory — the archive is streamed straight from the server
 * when the user clicks through, so album size is not a constraint here.
 */
export function useDownloadJob(albumId: string | undefined) {
  const [job, setJob] = useState<DownloadJob | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout>>();

  const stopPolling = useCallback(() => {
    clearTimeout(pollRef.current);
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const poll = useCallback(
    (jobId: string) => {
      pollRef.current = setTimeout(async () => {
        try {
          const { job: updated } = await api.downloadStatus(jobId);
          setJob(updated);
          if (updated.status === "pending" || updated.status === "running") {
            poll(jobId);
          } else if (updated.status === "failed") {
            toast({
              variant: "destructive",
              title: "Download failed",
              description: updated.error ?? "We could not prepare that download.",
            });
          }
        } catch (error) {
          setJob(null);
          toast({
            variant: "destructive",
            title: "Download failed",
            description:
              error instanceof ApiRequestError ? error.message : "We could not prepare that download.",
          });
        }
      }, 1500);
    },
    [],
  );

  const start = useCallback(
    async (mediaIds?: string[]) => {
      if (!albumId) return;
      setIsStarting(true);
      stopPolling();
      try {
        const { job: created } = await api.createDownload(albumId, mediaIds);
        setJob(created);
        poll(created.id);
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Download failed",
          description:
            error instanceof ApiRequestError ? error.message : "We could not start that download.",
        });
      } finally {
        setIsStarting(false);
      }
    },
    [albumId, poll, stopPolling],
  );

  const dismiss = useCallback(() => {
    stopPolling();
    setJob(null);
  }, [stopPolling]);

  return { job, isStarting, start, dismiss };
}
