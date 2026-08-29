import type { CloudinaryUploadResult, MediaItem, UploadTicket } from "@shared/types/index";
import { api, ApiRequestError } from "./api";

export type UploadStatus =
  | "waiting"
  | "preparing"
  | "uploading"
  | "finalizing"
  | "done"
  | "failed"
  | "duplicate"
  | "cancelled";

export interface UploadTask {
  id: string;
  file: File;
  name: string;
  size: number;
  status: UploadStatus;
  /** 0-100 for the Cloudinary transfer itself. */
  progress: number;
  bytesSent: number;
  /** Bytes per second, smoothed. */
  speed: number;
  error: string | null;
  /** Permanent failures (wrong format, over the limit) cannot be retried. */
  permanentFailure: boolean;
  media: MediaItem | null;
  /** Set when the server reports the file is already in the album. */
  duplicateOf: MediaItem | null;
  pendingPublicId: string | null;
  pendingResourceType: string | null;
  attempts: number;
  /** Signed upload ticket, fetched ahead of the transfer itself. */
  ticket: UploadTicket | null;
}

export interface QueueSnapshot {
  tasks: UploadTask[];
  total: number;
  completed: number;
  failed: number;
  active: number;
  waiting: number;
  duplicates: number;
  /** Failures that a retry could plausibly fix. */
  retryable: number;
  /** Overall progress across the whole batch, weighted by file size. */
  overallProgress: number;
  totalBytes: number;
  sentBytes: number;
  speed: number;
  isUploading: boolean;
}

type Listener = (snapshot: QueueSnapshot) => void;

/** Phones and home Wi-Fi do badly with more than a few parallel uploads. */
const DEFAULT_CONCURRENCY = 3;
const TICKET_BATCH_SIZE = 25;

let taskCounter = 0;

/**
 * A cooperative upload queue.
 *
 * Work happens in async callbacks driven by XMLHttpRequest progress events, so
 * the main thread stays free — selecting 200 photos never blocks the UI. One
 * file failing only fails that file; the rest of the queue keeps going, and any
 * failure can be retried individually or in bulk.
 */
export class UploadQueue {
  private tasks = new Map<string, UploadTask>();
  private order: string[] = [];
  private listeners = new Set<Listener>();
  private inFlight = new Map<string, XMLHttpRequest>();
  private running = false;
  private lastSample = { time: Date.now(), bytes: 0 };
  private smoothedSpeed = 0;
  private notifyScheduled = false;

  constructor(
    private albumId: string,
    private onMediaAdded: (media: MediaItem) => void,
    private concurrency = DEFAULT_CONCURRENCY,
  ) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Progress events fire many times per second per file. Coalescing them into
   * one notification per animation frame is what keeps a 100-file upload from
   * turning into thousands of React renders a second.
   */
  private notify(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    const flush = () => {
      this.notifyScheduled = false;
      const snapshot = this.snapshot();
      this.listeners.forEach((listener) => listener(snapshot));
    };
    // requestAnimationFrame stops firing while the tab is in the background —
    // which is exactly when someone is uploading 200 photos and switches apps.
    // Fall back to a timer so the queue keeps reporting progress.
    if (typeof requestAnimationFrame === "function" && !isHidden()) requestAnimationFrame(flush);
    else setTimeout(flush, 120);
  }

  snapshot(): QueueSnapshot {
    const tasks = this.order.map((id) => this.tasks.get(id)!).filter(Boolean);
    let totalBytes = 0;
    let sentBytes = 0;
    let completed = 0;
    let failed = 0;
    let active = 0;
    let waiting = 0;
    let duplicates = 0;
    let retryable = 0;

    for (const task of tasks) {
      if (task.status === "cancelled") continue;
      totalBytes += task.size;
      // A failed upload delivered nothing that survives, so it contributes no
      // progress — otherwise a batch that failed outright shows a full bar.
      if (task.status === "done") sentBytes += task.size;
      else if (task.status !== "failed") sentBytes += task.bytesSent;
      if (task.status === "done") completed += 1;
      else if (task.status === "failed") {
        failed += 1;
        if (!task.permanentFailure) retryable += 1;
      }
      else if (task.status === "duplicate") duplicates += 1;
      else if (task.status === "waiting") waiting += 1;
      else active += 1;
    }

    return {
      tasks,
      total: tasks.filter((t) => t.status !== "cancelled").length,
      completed,
      failed,
      active,
      waiting,
      duplicates,
      retryable,
      totalBytes,
      sentBytes,
      overallProgress: totalBytes > 0 ? Math.min(100, (sentBytes / totalBytes) * 100) : 0,
      speed: this.smoothedSpeed,
      isUploading: active > 0 || waiting > 0,
    };
  }

  add(files: File[]): void {
    for (const file of files) {
      taskCounter += 1;
      const id = `u${Date.now().toString(36)}_${taskCounter}`;
      this.tasks.set(id, {
        id,
        file,
        name: file.name || "upload",
        size: file.size,
        status: "waiting",
        progress: 0,
        bytesSent: 0,
        speed: 0,
        error: null,
        permanentFailure: false,
        media: null,
        duplicateOf: null,
        pendingPublicId: null,
        pendingResourceType: null,
        attempts: 0,
        ticket: null,
      });
      this.order.push(id);
    }
    this.notify();
    void this.drain();
  }

  retry(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || (task.status !== "failed" && task.status !== "cancelled")) return;
    if (task.permanentFailure) return;
    this.update(taskId, {
      status: "waiting",
      error: null,
      progress: 0,
      bytesSent: 0,
      ticket: null,
      permanentFailure: false,
    });
    void this.drain();
  }

  retryFailed(): void {
    for (const task of this.tasks.values()) {
      if (task.status === "failed" && !task.permanentFailure) {
        this.update(task.id, {
          status: "waiting",
          error: null,
          progress: 0,
          bytesSent: 0,
          ticket: null,
        });
      }
    }
    void this.drain();
  }

  cancel(taskId: string): void {
    const xhr = this.inFlight.get(taskId);
    xhr?.abort();
    this.inFlight.delete(taskId);
    const task = this.tasks.get(taskId);
    // A cancelled upload that already reached Cloudinary leaves an unregistered
    // asset behind; tell the server to throw it away rather than orphan it.
    if (task?.pendingPublicId && task.pendingResourceType) {
      void api
        .discardUpload(this.albumId, task.pendingPublicId, task.pendingResourceType)
        .catch(() => {});
    }
    this.update(taskId, { status: "cancelled" });
    void this.drain();
  }

  cancelAll(): void {
    for (const id of [...this.order]) {
      const task = this.tasks.get(id);
      if (task && task.status !== "done") this.cancel(id);
    }
  }

  /** Keeps a duplicate: registers the copy the user already uploaded. */
  async keepDuplicate(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || !task.pendingPublicId || !task.pendingResourceType) return;
    this.update(taskId, { status: "finalizing" });
    try {
      const { media } = await api.registerMedia(this.albumId, {
        publicId: task.pendingPublicId,
        resourceType: task.pendingResourceType,
        originalFilename: task.name,
        mimeType: task.file.type || undefined,
        allowDuplicate: true,
      });
      this.update(taskId, { status: "done", progress: 100, media, duplicateOf: null });
      this.onMediaAdded(media);
    } catch (error) {
      this.update(taskId, { status: "failed", error: messageFor(error) });
    }
  }

  /** Discards a duplicate: removes the just-uploaded copy from storage. */
  async discardDuplicate(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || !task.pendingPublicId || !task.pendingResourceType) return;
    try {
      await api.discardUpload(this.albumId, task.pendingPublicId, task.pendingResourceType);
    } catch {
      // Nothing the user can do about it; the server logs and can retry.
    }
    this.update(taskId, { status: "cancelled", pendingPublicId: null });
  }

  clearFinished(): void {
    for (const id of [...this.order]) {
      const task = this.tasks.get(id);
      if (task && (task.status === "done" || task.status === "cancelled")) {
        this.tasks.delete(id);
        this.order = this.order.filter((existing) => existing !== id);
      }
    }
    this.notify();
  }

  reset(): void {
    this.cancelAll();
    this.tasks.clear();
    this.order = [];
    this.notify();
  }

  private update(taskId: string, changes: Partial<UploadTask>): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.tasks.set(taskId, { ...task, ...changes });
    this.notify();
  }

  private trackSpeed(deltaBytes: number): void {
    const now = Date.now();
    this.lastSample.bytes += deltaBytes;
    const elapsed = now - this.lastSample.time;
    if (elapsed < 700) return;
    const instant = (this.lastSample.bytes / elapsed) * 1000;
    // Exponential smoothing; raw per-chunk rates are far too jumpy to display.
    this.smoothedSpeed = this.smoothedSpeed ? this.smoothedSpeed * 0.7 + instant * 0.3 : instant;
    this.lastSample = { time: now, bytes: 0 };
  }

  /**
   * Fetches signatures in batches, then feeds the transfer slots. Signatures
   * are requested ahead of time so a 100-file batch costs a handful of API
   * calls instead of one per file.
   */
  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (true) {
        const capacity = this.concurrency - this.inFlight.size;
        if (capacity <= 0) break;

        const waiting = this.order
          .map((id) => this.tasks.get(id)!)
          .filter((task) => task && (task.status === "waiting" || task.status === "preparing"));

        if (!waiting.length) break;

        const needTickets = waiting.filter((task) => !task.ticket).slice(0, TICKET_BATCH_SIZE);
        if (needTickets.length) {
          try {
            needTickets.forEach((task) => this.update(task.id, { status: "preparing" }));
            const { tickets, rejected } = await api.uploadTickets(
              this.albumId,
              needTickets.map((task) => ({
                clientId: task.id,
                filename: task.name,
                mimeType: task.file.type || undefined,
                fileSize: task.size,
              })),
            );
            const byId = new Map(tickets.map((ticket) => [ticket.clientId, ticket]));
            // Rejections are per file: an unsupported format among 100 photos
            // fails only that one.
            const rejectedById = new Map((rejected ?? []).map((r) => [r.clientId, r]));
            for (const task of needTickets) {
              const ticket = byId.get(task.id);
              if (ticket) {
                this.update(task.id, { ticket, status: "waiting" });
                continue;
              }
              const rejection = rejectedById.get(task.id);
              this.update(task.id, {
                status: "failed",
                progress: 0,
                bytesSent: 0,
                permanentFailure: Boolean(rejection),
                error: rejection?.message ?? "We could not prepare that upload.",
              });
            }
          } catch (error) {
            // A rejected batch (unsupported format, too large, rate limited)
            // must not poison the queue — fail just these files and move on.
            const message = messageFor(error);
            const permanent =
              error instanceof ApiRequestError &&
              (error.code === "unsupported_media_type" || error.code === "file_too_large");
            needTickets.forEach((task) =>
              this.update(task.id, {
                status: "failed",
                progress: 0,
                bytesSent: 0,
                permanentFailure: permanent,
                error: message,
              }),
            );
            continue;
          }
        }

        const ready = this.order
          .map((id) => this.tasks.get(id)!)
          .filter((task) => task && task.status === "waiting" && task.ticket)
          .slice(0, this.concurrency - this.inFlight.size);

        if (!ready.length) {
          if (!needTickets.length) break;
          continue;
        }

        for (const task of ready) {
          void this.uploadOne(task.id, task.ticket!);
        }

        // Yield so progress events can paint before we consider more work.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      this.running = false;
    }
  }

  private uploadOne(taskId: string, ticket: UploadTicket): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return Promise.resolve();

    this.update(taskId, {
      status: "uploading",
      attempts: task.attempts + 1,
      pendingPublicId: ticket.publicId,
      pendingResourceType: ticket.resourceType,
    });

    return new Promise<void>((resolve) => {
      const form = new FormData();
      // Exactly the fields the server signed — Cloudinary rejects any mismatch.
      form.append("file", task.file);
      form.append("api_key", ticket.apiKey);
      form.append("timestamp", String(ticket.timestamp));
      form.append("signature", ticket.signature);
      form.append("public_id", ticket.publicId);
      form.append("overwrite", "false");
      form.append("invalidate", "false");

      const xhr = new XMLHttpRequest();
      this.inFlight.set(taskId, xhr);
      let lastLoaded = 0;

      xhr.open("POST", ticket.uploadUrl, true);

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        this.trackSpeed(event.loaded - lastLoaded);
        lastLoaded = event.loaded;
        this.update(taskId, {
          // The XHR total includes multipart field overhead, so loaded can run
          // past the file's own size; clamp it or the summary reads > 100%.
          bytesSent: Math.min(event.loaded, task.size),
          progress: Math.min(99, (event.loaded / event.total) * 100),
        });
      };

      xhr.onload = () => {
        this.inFlight.delete(taskId);
        if (xhr.status < 200 || xhr.status >= 300) {
          this.update(taskId, {
            status: "failed",
            progress: 0,
            bytesSent: 0,
            error: cloudinaryError(xhr.responseText) ?? "Upload failed. Tap retry to try again.",
          });
          resolve();
          void this.drain();
          return;
        }

        let result: CloudinaryUploadResult | null = null;
        try {
          result = JSON.parse(xhr.responseText) as CloudinaryUploadResult;
        } catch {
          result = null;
        }

        this.update(taskId, { status: "finalizing", progress: 100, bytesSent: task.size });
        void this.finalize(taskId, ticket, result).finally(() => {
          resolve();
          void this.drain();
        });
      };

      xhr.onerror = () => {
        this.inFlight.delete(taskId);
        this.update(taskId, {
          status: "failed",
          progress: 0,
          bytesSent: 0,
          error: "Network error during upload. Tap retry when you're back online.",
        });
        resolve();
        void this.drain();
      };

      xhr.onabort = () => {
        this.inFlight.delete(taskId);
        resolve();
      };

      xhr.ontimeout = () => {
        this.inFlight.delete(taskId);
        this.update(taskId, { status: "failed", error: "The upload timed out. Tap retry." });
        resolve();
        void this.drain();
      };

      xhr.send(form);
    });
  }

  /** Tells our server about the finished asset so it becomes a gallery item. */
  private async finalize(
    taskId: string,
    ticket: UploadTicket,
    result: CloudinaryUploadResult | null,
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    try {
      const { media } = await api.registerMedia(this.albumId, {
        publicId: result?.public_id ?? ticket.publicId,
        resourceType: (result?.resource_type as string) ?? ticket.resourceType,
        originalFilename: task.name,
        mimeType: task.file.type || undefined,
      });
      this.update(taskId, { status: "done", progress: 100, media, bytesSent: task.size });
      this.onMediaAdded(media);
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "duplicate_media") {
        const details = error.details as { existing?: MediaItem; pendingPublicId?: string };
        this.update(taskId, {
          status: "duplicate",
          duplicateOf: details?.existing ?? null,
          pendingPublicId: details?.pendingPublicId ?? ticket.publicId,
          error: null,
        });
        return;
      }
      this.update(taskId, { status: "failed", error: messageFor(error) });
    }
  }
}

function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function messageFor(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

/**
 * Cloudinary's own error text is for developers ("Invalid Signature abc123.
 * String to sign - ..."). Only the handful of messages a person can actually
 * act on are shown; everything else is logged and reported as a plain failure.
 */
function cloudinaryError(responseText: string): string | null {
  let raw: string | undefined;
  try {
    raw = (JSON.parse(responseText) as { error?: { message?: string } })?.error?.message;
  } catch {
    raw = undefined;
  }
  if (!raw) return null;

  // eslint-disable-next-line no-console
  console.warn("[upload] storage rejected the file:", raw);

  if (/file size too large|too large/i.test(raw)) {
    return "That file is larger than the storage limit for this account.";
  }
  if (/unsupported|invalid image file|invalid video file/i.test(raw)) {
    return "That file format could not be read.";
  }
  if (/rate limit|too many/i.test(raw)) {
    return "Storage is busy right now. Tap retry in a moment.";
  }
  return null;
}
