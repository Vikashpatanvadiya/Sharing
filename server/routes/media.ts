import { Router } from "express";
import { z } from "zod";
import { forbidden, notFound, unauthorized } from "../lib/errors.js";
import { sanitizeFilename } from "../lib/media-types.js";
import { resolveAlbumAccess, type AlbumAccess } from "../middleware/auth.js";
import { deleteLimiter, downloadLimiter } from "../middleware/rateLimit.js";
import { getVisitorId } from "../middleware/session.js";
import { streamOriginal } from "../services/cloudinary.js";
import {
  canDelete,
  deleteMediaBulk,
  deleteMediaItem,
  getMediaById,
  toMediaItem,
} from "../services/media.js";
import type { Media } from "../db/schema.js";
import type { Request, Response } from "express";

export const mediaRouter = Router();

const idSchema = z.string().uuid();

/**
 * Resolves a media item together with the caller's rights in its album.
 * The album is derived from the media row, never from the request — so a
 * caller cannot point at someone else's photo while quoting an album they can
 * legitimately access.
 */
async function loadMediaWithAccess(
  req: Request,
  res: Response,
  mediaId: string,
): Promise<{ row: Media; access: AlbumAccess }> {
  if (!idSchema.safeParse(mediaId).success) throw notFound("That photo or video does not exist.");
  const row = await getMediaById(mediaId);
  if (!row) throw notFound("That photo or video is no longer in this album.");
  getVisitorId(req, res);
  const access = await resolveAlbumAccess(req, res, row.albumId);
  if (!access) throw unauthorized("You don't have access to this album.");
  return { row, access };
}

/** Content-Disposition that survives spaces, quotes and non-ASCII filenames. */
function contentDisposition(type: "inline" | "attachment", filename: string): string {
  const safe = sanitizeFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/**
 * Streams the stored original through the app.
 *
 * `?download=1` sets an attachment disposition with the original filename;
 * otherwise the file is served inline (used as the video player's fallback
 * source). Range requests are forwarded so seeking in a video still works.
 */
async function serveOriginal(req: Request, res: Response, disposition: "inline" | "attachment") {
  const { row } = await loadMediaWithAccess(req, res, req.params.mediaId);

  const range = req.headers.range;
  const upstream = await streamOriginal(row.cloudinaryPublicId, row.cloudinaryResourceType, {
    version: row.cloudinaryVersion,
    secureUrl: row.cloudinarySecureUrl,
    range: typeof range === "string" ? range : undefined,
  });

  const passthrough = ["content-length", "content-range", "accept-ranges", "etag", "last-modified"];
  for (const header of passthrough) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }
  res.setHeader(
    "Content-Type",
    row.mimeType || upstream.headers.get("content-type") || "application/octet-stream",
  );
  res.setHeader("Content-Disposition", contentDisposition(disposition, row.originalFilename));
  // Album media is private: never let a shared cache hold on to it.
  res.setHeader("Cache-Control", "private, max-age=0, no-store");
  res.status(upstream.status === 206 ? 206 : 200);

  upstream.stream.on("error", () => res.destroy());
  res.on("close", () => upstream.stream.destroy());
  upstream.stream.pipe(res);
}

mediaRouter.get("/:mediaId/original", downloadLimiter, async (req, res, next) => {
  try {
    await serveOriginal(req, res, "inline");
  } catch (error) {
    next(error);
  }
});

mediaRouter.get("/:mediaId/download", downloadLimiter, async (req, res, next) => {
  try {
    await serveOriginal(req, res, "attachment");
  } catch (error) {
    next(error);
  }
});

mediaRouter.get("/:mediaId", async (req, res, next) => {
  try {
    const { row, access } = await loadMediaWithAccess(req, res, req.params.mediaId);
    res.json({ media: toMediaItem(row, access) });
  } catch (error) {
    next(error);
  }
});

mediaRouter.delete("/:mediaId", deleteLimiter, async (req, res, next) => {
  try {
    const { row, access } = await loadMediaWithAccess(req, res, req.params.mediaId);
    if (!canDelete(access, row)) {
      throw forbidden("You can only delete photos and videos that you uploaded.");
    }
    await deleteMediaItem(access, row.id);
    res.json({ deleted: row.id });
  } catch (error) {
    next(error);
  }
});

/**
 * Bulk delete. The album comes from the first item, then every item is checked
 * against that album and against the caller's rights individually — a
 * contributor's selection silently containing someone else's photo deletes only
 * their own, and says so.
 */
mediaRouter.post("/bulk-delete", deleteLimiter, async (req, res, next) => {
  try {
    const { mediaIds } = z
      .object({ mediaIds: z.array(idSchema).min(1).max(500) })
      .parse(req.body);

    const first = await getMediaById(mediaIds[0]);
    if (!first) throw notFound("Those items are no longer in this album.");
    getVisitorId(req, res);
    const access = await resolveAlbumAccess(req, res, first.albumId);
    if (!access) throw unauthorized("You don't have access to this album.");

    const outcome = await deleteMediaBulk(access, mediaIds);
    res.json({
      deleted: outcome.deleted,
      failed: outcome.failed,
      message: outcome.failed.some((f) => f.reason === "forbidden")
        ? "Some items were uploaded by other people and were left untouched."
        : null,
    });
  } catch (error) {
    next(error);
  }
});
