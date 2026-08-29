import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  Copy,
  ImagePlus,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { UploadTask } from "@/lib/upload-queue";
import type { UploadController } from "@/hooks/use-upload";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppConfig } from "@/hooks/use-album";
import { formatBytes, formatSpeed } from "@/lib/format";
import { cn } from "@/lib/utils";

interface UploadPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  upload: UploadController;
}

export function UploadPanel({ open, onOpenChange, upload }: UploadPanelProps) {
  const { data: config } = useAppConfig();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { snapshot } = upload;
  const hasQueue = snapshot.tasks.length > 0;

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      upload.addFiles(event.dataTransfer.files);
    },
    [upload],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add photos &amp; videos</DialogTitle>
          <DialogDescription>
            Originals are kept exactly as they are — nothing is compressed or converted.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={config?.acceptAttribute}
          className="sr-only"
          onChange={(event) => {
            upload.addFiles(event.target.files);
            // Reset so picking the same file twice still fires a change event.
            event.target.value = "";
          }}
        />

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={cn(
            "rounded-2xl border-2 border-dashed p-6 text-center transition-colors sm:p-8",
            isDragging ? "border-primary bg-accent/60" : "border-border bg-muted/40",
          )}
        >
          <CloudUpload className="mx-auto h-9 w-9 text-muted-foreground" />
          <p className="mt-3 hidden font-medium sm:block">Drag &amp; drop here</p>
          <p className="mt-1 hidden text-sm text-muted-foreground sm:block">or</p>
          <Button className="mt-3 w-full sm:mt-4 sm:w-auto" onClick={() => inputRef.current?.click()}>
            <ImagePlus className="h-4 w-4" />
            Select photos &amp; videos
          </Button>
          {config && (
            <p className="mt-3 text-xs text-muted-foreground">
              Up to {config.maxImageSizeMb} MB per photo · {config.maxVideoSizeMb} MB per video
            </p>
          )}
        </div>

        {hasQueue && (
          <>
            <UploadSummary upload={upload} />
            <ul className="max-h-[38vh] space-y-1.5 overflow-y-auto pr-1">
              {snapshot.tasks.map((task) => (
                <UploadRow key={task.id} task={task} upload={upload} />
              ))}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function UploadSummary({ upload }: { upload: UploadController }) {
  const { snapshot } = upload;
  const inProgress = snapshot.active + snapshot.waiting;

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">
          {snapshot.isUploading
            ? `Uploading ${Math.min(snapshot.completed + snapshot.active, snapshot.total)} / ${snapshot.total}`
            : `${snapshot.completed} of ${snapshot.total} uploaded`}
        </p>
        {snapshot.speed > 0 && snapshot.isUploading && (
          <p className="text-xs tabular-nums text-muted-foreground">
            {formatSpeed(snapshot.speed)}
          </p>
        )}
      </div>

      <Progress value={snapshot.overallProgress} className="mt-2.5" />

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{snapshot.completed} uploaded</span>
        {inProgress > 0 && <span>{inProgress} remaining</span>}
        {snapshot.duplicates > 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            {snapshot.duplicates} possible duplicate{snapshot.duplicates === 1 ? "" : "s"}
          </span>
        )}
        {snapshot.failed > 0 && <span className="text-destructive">{snapshot.failed} failed</span>}
        <span className="ml-auto tabular-nums">
          {formatBytes(snapshot.sentBytes)} / {formatBytes(snapshot.totalBytes)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {snapshot.retryable > 0 && (
          <Button size="sm" variant="outline" onClick={upload.retryFailed}>
            <RotateCcw className="h-4 w-4" />
            Retry failed
          </Button>
        )}
        {snapshot.isUploading ? (
          <Button size="sm" variant="ghost" onClick={upload.cancelAll}>
            Cancel all
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={upload.clearFinished}>
            Clear list
          </Button>
        )}
      </div>
    </div>
  );
}

function UploadRow({ task, upload }: { task: UploadTask; upload: UploadController }) {
  return (
    <li className="rounded-xl border border-border/70 bg-card px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <StatusIcon task={task} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{task.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            <StatusLabel task={task} />
          </p>
        </div>

        {task.status === "failed" && !task.permanentFailure && (
          <Button size="icon-sm" variant="ghost" onClick={() => upload.retry(task.id)} aria-label="Retry">
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
        {(task.status === "uploading" || task.status === "waiting" || task.status === "preparing") && (
          <Button size="icon-sm" variant="ghost" onClick={() => upload.cancel(task.id)} aria-label="Cancel">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {(task.status === "uploading" || task.status === "finalizing") && (
        <Progress
          value={task.status === "finalizing" ? 100 : task.progress}
          className="mt-2 h-1.5"
        />
      )}

      {task.status === "duplicate" && (
        <div className="mt-2.5 rounded-lg bg-amber-500/10 p-2.5">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            This photo appears to already exist in this album
            {task.duplicateOf ? ` as ${task.duplicateOf.originalFilename}` : ""}.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void upload.keepDuplicate(task.id)}>
              Upload anyway
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void upload.discardDuplicate(task.id)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function StatusIcon({ task }: { task: UploadTask }) {
  if (task.status === "done") {
    return <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />;
  }
  if (task.status === "failed") {
    return <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />;
  }
  if (task.status === "duplicate") {
    return <Copy className="h-5 w-5 shrink-0 text-amber-500" />;
  }
  if (task.status === "cancelled") {
    return <X className="h-5 w-5 shrink-0 text-muted-foreground" />;
  }
  if (task.status === "uploading" || task.status === "finalizing" || task.status === "preparing") {
    return <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />;
  }
  return <div className="h-5 w-5 shrink-0 rounded-full border-2 border-muted" />;
}

function StatusLabel({ task }: { task: UploadTask }) {
  switch (task.status) {
    case "waiting":
      return <>Waiting… · {formatBytes(task.size)}</>;
    case "preparing":
      return <>Preparing…</>;
    case "uploading":
      return (
        <>
          {Math.round(task.progress)}% · {formatBytes(task.bytesSent)} of {formatBytes(task.size)}
        </>
      );
    case "finalizing":
      return <>Finishing up…</>;
    case "done":
      return <>Uploaded · {formatBytes(task.size)}</>;
    case "duplicate":
      return <>Needs your decision</>;
    case "cancelled":
      return <>Cancelled</>;
    case "failed":
      return <span className="text-destructive">{task.error ?? "Upload failed"}</span>;
    default:
      return null;
  }
}
