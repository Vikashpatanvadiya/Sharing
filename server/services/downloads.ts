import archiver from "archiver";
import { and, eq, lt, or } from "drizzle-orm";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type { DownloadJob } from "../../shared/types/index.js";
import { db } from "../db/index.js";
import { downloadJobs, type DownloadJobRow, type Media } from "../db/schema.js";
import { env } from "../env.js";
import { badRequest, notFound } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { sanitizeFilename } from "../lib/media-types.js";
import type { AlbumAccess } from "../middleware/auth.js";
import { getMediaByIds, listAllMediaForAlbum } from "./media.js";
import { streamOriginal } from "./cloudinary.js";

const MAX_FILES_PER_JOB = 5000;

function tmpDir(): string {
  return path.resolve(process.cwd(), env.DOWNLOAD_TMP_DIR);
}

/** Turns an album name into something safe and recognisable as a filename. */
export function albumZipName(albumName: string): string {
  const base =
    albumName
      .trim()
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .replace(/\s+/g, "-")
      .slice(0, 60) || "album";
  return `${base}.zip`;
}

export function toDownloadJob(row: DownloadJobRow): DownloadJob {
  return {
    id: row.id,
    status: row.status as DownloadJob["status"],
    fileCount: row.fileCount,
    processedCount: row.processedCount,
    filename: row.filename,
    downloadUrl: row.status === "ready" ? `/api/downloads/${row.id}/file` : null,
    error: row.error,
    createdAt: new Date(row.createdAt).toISOString(),
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
  };
}

export interface CreateJobInput {
  access: AlbumAccess;
  ownerKey: string;
  mediaIds?: string[];
}

/**
 * Queues a ZIP build. The archive is assembled on the server and streamed to
 * disk, so a 40 GB album is never held in memory — on the server or the client.
 */
export async function createDownloadJob({ access, ownerKey, mediaIds }: CreateJobInput) {
  const items = mediaIds?.length
    ? await getMediaByIds(access.album.id, mediaIds)
    : await listAllMediaForAlbum(access.album.id);

  if (!items.length) {
    throw badRequest("There is nothing to download yet.");
  }
  if (items.length > MAX_FILES_PER_JOB) {
    throw badRequest(
      `That is more than ${MAX_FILES_PER_JOB} files at once. Please select a smaller batch.`,
    );
  }

  const [job] = await db
    .insert(downloadJobs)
    .values({
      albumId: access.album.id,
      requestedBy: access.contributor.id,
      ownerKey,
      status: "pending",
      filename: albumZipName(access.album.name),
      fileCount: items.length,
      mediaIds: items.map((item) => item.id),
      expiresAt: new Date(Date.now() + env.downloadTtlMs),
    })
    .returning();

  // Fire and forget: the client polls for status while it keeps browsing.
  void runJob(job.id, items).catch((error) => {
    logger.error("zip job crashed", { jobId: job.id, error });
  });

  return job;
}

/**
 * ZIP entry names must be unique, so `IMG_001.JPG` uploaded by two people
 * becomes `IMG_001.JPG` and `IMG_001 (2).JPG` — the file contents are untouched.
 */
function uniqueEntryName(used: Set<string>, filename: string): string {
  const safe = sanitizeFilename(filename);
  if (!used.has(safe)) {
    used.add(safe);
    return safe;
  }
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  let counter = 2;
  let candidate = `${stem} (${counter})${ext}`;
  while (used.has(candidate)) {
    counter += 1;
    candidate = `${stem} (${counter})${ext}`;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Appends one entry and resolves when the archiver has consumed it, so the
 * loop stays strictly serial. Races against `error` so a failure can never
 * leave the job hanging forever.
 */
function appendEntry(
  archive: archiver.Archiver,
  stream: Readable,
  data: { name: string; date: Date },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      archive.off("entry", onEntry);
      archive.off("error", onError);
    };
    const onEntry = () => {
      done();
      resolve();
    };
    const onError = (error: unknown) => {
      done();
      reject(error);
    };
    archive.once("entry", onEntry);
    archive.once("error", onError);
    archive.append(stream, data);
  });
}

async function runJob(jobId: string, items: Media[]): Promise<void> {
  await fs.mkdir(tmpDir(), { recursive: true });
  const storagePath = path.join(tmpDir(), `${jobId}.zip`);

  await db
    .update(downloadJobs)
    .set({ status: "running", storagePath })
    .where(eq(downloadJobs.id, jobId));

  const output = createWriteStream(storagePath);
  // level 0 = store. Photos and videos are already compressed; re-deflating
  // them would burn CPU for nothing. Crucially it also guarantees the bytes
  // inside the archive are the original bytes, never re-encoded media.
  const archive = archiver("zip", { zlib: { level: 0 }, store: true });

  const finished = new Promise<void>((resolve, reject) => {
    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);
    archive.on("warning", (warning) => logger.warn("archiver warning", { jobId, warning }));
  });
  // The failure path aborts the archive, which rejects `finished` a second
  // time; swallow that here so it never surfaces as an unhandled rejection.
  finished.catch(() => {});

  archive.pipe(output);

  const used = new Set<string>();
  let processed = 0;
  let failures = 0;

  try {
    for (const item of items) {
      try {
        const { stream } = await streamOriginal(
          item.cloudinaryPublicId,
          item.cloudinaryResourceType,
          { version: item.cloudinaryVersion, secureUrl: item.cloudinarySecureUrl },
        );
        // One file in flight at a time. Appending everything up front would
        // open thousands of simultaneous Cloudinary connections and buffer
        // them all in memory while the archiver worked through the queue.
        await appendEntry(archive, stream, {
          name: uniqueEntryName(used, item.originalFilename),
          date: new Date(item.createdAt),
        });
      } catch (error) {
        failures += 1;
        logger.error("zip entry failed", { jobId, mediaId: item.id, error });
      }
      processed += 1;
      if (processed % 10 === 0 || processed === items.length) {
        await db
          .update(downloadJobs)
          .set({ processedCount: processed })
          .where(eq(downloadJobs.id, jobId));
      }
    }

    await archive.finalize();
    await finished;

    await db
      .update(downloadJobs)
      .set({
        status: "ready",
        processedCount: processed,
        error: failures ? `${failures} file(s) could not be included.` : null,
        expiresAt: new Date(Date.now() + env.downloadTtlMs),
      })
      .where(eq(downloadJobs.id, jobId));

    logger.info("zip job ready", { jobId, files: items.length, failures });
  } catch (error) {
    logger.error("zip job failed", { jobId, error });
    archive.abort();
    await db
      .update(downloadJobs)
      .set({
        status: "failed",
        error: "We could not prepare that download. Please try again.",
      })
      .where(eq(downloadJobs.id, jobId));
    await fs.rm(storagePath, { force: true }).catch(() => {});
  }
}

/** Loads a job, enforcing that it belongs to this album *and* this browser. */
export async function getOwnedJob(
  jobId: string,
  albumId: string,
  ownerKey: string,
): Promise<DownloadJobRow> {
  const [job] = await db
    .select()
    .from(downloadJobs)
    .where(eq(downloadJobs.id, jobId))
    .limit(1);
  if (!job || job.albumId !== albumId || job.ownerKey !== ownerKey) {
    throw notFound("That download is no longer available.");
  }
  if (job.expiresAt && job.expiresAt.getTime() < Date.now() && job.status === "ready") {
    throw notFound("That download has expired. Please prepare it again.");
  }
  return job;
}

export async function jobFilePath(job: DownloadJobRow): Promise<string> {
  if (job.status !== "ready" || !job.storagePath) {
    throw notFound("That download is not ready yet.");
  }
  try {
    await fs.access(job.storagePath);
  } catch {
    throw notFound("That download has expired. Please prepare it again.");
  }
  return job.storagePath;
}

/** Deletes expired archives from disk and their rows from the database. */
export async function cleanupExpiredDownloads(): Promise<void> {
  const now = new Date();
  const stale = await db
    .select()
    .from(downloadJobs)
    .where(
      or(
        lt(downloadJobs.expiresAt, now),
        and(eq(downloadJobs.status, "failed"), lt(downloadJobs.createdAt, new Date(Date.now() - env.downloadTtlMs))),
      ),
    )
    .limit(200);

  for (const job of stale) {
    if (job.storagePath) await fs.rm(job.storagePath, { force: true }).catch(() => {});
    await db.delete(downloadJobs).where(eq(downloadJobs.id, job.id));
  }
  if (stale.length) logger.info("cleaned up expired downloads", { count: stale.length });
}

export function startDownloadCleanupTimer(): NodeJS.Timeout {
  const timer = setInterval(() => {
    cleanupExpiredDownloads().catch((error) =>
      logger.error("download cleanup failed", { error }),
    );
  }, 10 * 60 * 1000);
  timer.unref();
  return timer;
}
