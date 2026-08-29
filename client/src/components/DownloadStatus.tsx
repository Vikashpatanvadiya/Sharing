import { CheckCircle2, Download, Loader2, X } from "lucide-react";
import type { DownloadJob } from "@shared/types/index";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface DownloadStatusProps {
  job: DownloadJob;
  onDismiss: () => void;
}

/**
 * Non-blocking progress card for a server-side ZIP build. The album stays fully
 * usable while it runs — that's the whole point of doing it out of process.
 */
export function DownloadStatus({ job, onDismiss }: DownloadStatusProps) {
  const isWorking = job.status === "pending" || job.status === "running";
  const percent = job.fileCount ? (job.processedCount / job.fileCount) * 100 : 0;

  if (job.status === "failed" || job.status === "expired") return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-40 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-border bg-card p-4 shadow-lift">
      <div className="flex items-start gap-3">
        {isWorking ? (
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {isWorking ? "Preparing your download…" : "Your download is ready"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isWorking
              ? `${job.processedCount} of ${job.fileCount} files · You can keep using the album`
              : `${job.fileCount} original files · ${job.filename}`}
          </p>

          {isWorking && <Progress value={percent} className="mt-2.5 h-1.5" />}

          {job.status === "ready" && job.downloadUrl && (
            <Button asChild size="sm" className="mt-3 w-full">
              <a href={job.downloadUrl} download={job.filename} onClick={() => setTimeout(onDismiss, 1200)}>
                <Download className="h-4 w-4" />
                Download {job.filename}
              </a>
            </Button>
          )}

          {job.error && job.status === "ready" && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{job.error}</p>
          )}
        </div>

        <Button size="icon-sm" variant="ghost" onClick={onDismiss} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
