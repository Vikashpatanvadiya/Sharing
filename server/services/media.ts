import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { MediaItem, MediaPage, ResourceType } from "../../shared/types/index.js";
import { db } from "../db/index.js";
import { media, orphanedAssets, type Media } from "../db/schema.js";
import { env } from "../env.js";
import { conflict, forbidden, notFound, payloadTooLarge, upstreamFailure } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { findFormat, sanitizeFilename } from "../lib/media-types.js";
import type { AlbumAccess } from "../middleware/auth.js";
import {
  destroyResource,
  fetchResource,
  isPublicIdInAlbum,
  posterUrl,
  previewUrl,
  thumbnailUrl,
} from "./cloudinary.js";

const PAGE_SIZE = 60;
const MAX_PAGE_SIZE = 120;

/**
 * A viewer may delete a media item when they uploaded it, or when they are the
 * album admin. This is the only place that rule is expressed, and it always
 * runs against the session-derived identity — never a client-supplied id.
 */
export function canDelete(access: AlbumAccess, item: { contributorId: string | null }): boolean {
  if (access.role === "admin") return true;
  return item.contributorId !== null && item.contributorId === access.contributor.id;
}

export function toMediaItem(row: Media, access: AlbumAccess): MediaItem {
  const resourceType = row.cloudinaryResourceType as ResourceType;
  return {
    id: row.id,
    albumId: row.albumId,
    contributorId: row.contributorId,
    uploaderName: row.uploaderName,
    canDelete: canDelete(access, row),

    resourceType,
    originalFilename: row.originalFilename,
    format: row.format,
    mimeType: row.mimeType,
    fileSize: Number(row.fileSize),

    width: row.width,
    height: row.height,
    duration: row.duration,

    thumbnailUrl: thumbnailUrl(row.cloudinaryPublicId, resourceType),
    previewUrl: previewUrl(row.cloudinaryPublicId, resourceType),
    // Originals are only ever reachable through an authorized app endpoint.
    originalUrl: `/api/media/${row.id}/original`,
    posterUrl: posterUrl(row.cloudinaryPublicId, resourceType),

    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/**
 * Keyset ("seek") pagination on (created_at, id). Unlike OFFSET this stays fast
 * at page 200 of a 10,000-photo album and never skips or repeats an item when
 * someone uploads while you are scrolling.
 */
function decodeCursor(cursor?: string): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [ts, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    const createdAt = new Date(Number(ts));
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function encodeCursor(row: Media): string {
  return Buffer.from(`${new Date(row.createdAt).getTime()}|${row.id}`, "utf8").toString("base64url");
}

export interface ListMediaOptions {
  cursor?: string;
  limit?: number;
  filter?: "all" | "photos" | "videos" | "mine";
}

export async function listMedia(
  access: AlbumAccess,
  options: ListMediaOptions = {},
): Promise<MediaPage> {
  const limit = Math.min(Math.max(options.limit ?? PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const cursor = decodeCursor(options.cursor);

  // `filters` describes the whole result set; `pageFilters` adds the cursor so
  // the total stays stable as the visitor scrolls.
  const filters = [eq(media.albumId, access.album.id)];
  if (options.filter === "photos") {
    filters.push(sql`${media.cloudinaryResourceType} <> 'video'`);
  } else if (options.filter === "videos") {
    filters.push(eq(media.cloudinaryResourceType, "video"));
  } else if (options.filter === "mine") {
    filters.push(eq(media.contributorId, access.contributor.id));
  }

  const pageFilters = [...filters];
  if (cursor) {
    pageFilters.push(
      or(
        lt(media.createdAt, cursor.createdAt),
        and(eq(media.createdAt, cursor.createdAt), lt(media.id, cursor.id)),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(media)
    .where(and(...pageFilters))
    .orderBy(desc(media.createdAt), desc(media.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const [totalRow] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(media)
    .where(and(...filters));

  return {
    items: page.map((row) => toMediaItem(row, access)),
    nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
    total: Number(totalRow?.value ?? page.length),
  };
}

export async function getMediaById(mediaId: string): Promise<Media | null> {
  const [row] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  return row ?? null;
}

export async function getMediaForAlbum(albumId: string, mediaId: string): Promise<Media | null> {
  const [row] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.albumId, albumId)))
    .limit(1);
  return row ?? null;
}

export interface RegisterMediaInput {
  publicId: string;
  resourceType: ResourceType;
  originalFilename: string;
  mimeType?: string;
  allowDuplicate?: boolean;
}

export type RegisterResult =
  | { status: "created"; item: MediaItem }
  | { status: "duplicate"; existing: MediaItem; pendingPublicId: string };

/**
 * Turns a finished Cloudinary upload into a database record.
 *
 * Everything that matters is re-read from Cloudinary's Admin API: the client
 * cannot inflate dimensions, understate a file size to dodge the limit, or
 * register an asset that belongs to a different album.
 */
export async function registerMedia(
  access: AlbumAccess,
  input: RegisterMediaInput,
): Promise<RegisterResult> {
  if (!isPublicIdInAlbum(input.publicId, access.album.id)) {
    throw forbidden("That upload does not belong to this album.");
  }

  const [alreadyRegistered] = await db
    .select()
    .from(media)
    .where(eq(media.cloudinaryPublicId, input.publicId))
    .limit(1);
  if (alreadyRegistered) {
    // Retries of the confirm step are idempotent rather than an error.
    return { status: "created", item: toMediaItem(alreadyRegistered, access) };
  }

  const resource = await fetchResource(input.publicId, input.resourceType);
  if (!resource) {
    throw upstreamFailure("That upload could not be found in storage. Please try uploading again.");
  }

  const filename = sanitizeFilename(input.originalFilename);
  const spec = findFormat(filename, input.mimeType);
  const isVideo = resource.resourceType === "video";
  const limit = isVideo ? env.maxVideoSizeBytes : env.maxImageSizeBytes;

  if (resource.bytes > limit) {
    // The asset made it to Cloudinary before we could measure it, so remove it
    // again rather than keeping an over-limit file nobody asked for.
    await destroyResource(input.publicId, resource.resourceType);
    const limitMb = isVideo ? env.MAX_VIDEO_SIZE_MB : env.MAX_IMAGE_SIZE_MB;
    throw payloadTooLarge(
      `${filename} is larger than the ${limitMb} MB limit for ${isVideo ? "videos" : "photos"}.`,
    );
  }

  if (!input.allowDuplicate && resource.etag) {
    const [duplicate] = await db
      .select()
      .from(media)
      .where(and(eq(media.albumId, access.album.id), eq(media.checksum, resource.etag)))
      .limit(1);
    if (duplicate) {
      // The freshly uploaded copy stays put until the user decides; it is never
      // merged into, and never overwrites, the original that is already here.
      return {
        status: "duplicate",
        existing: toMediaItem(duplicate, access),
        pendingPublicId: input.publicId,
      };
    }
  }

  const [row] = await db
    .insert(media)
    .values({
      albumId: access.album.id,
      contributorId: access.contributor.id,
      uploaderName: access.contributor.displayName,
      cloudinaryPublicId: resource.publicId,
      cloudinaryResourceType: resource.resourceType,
      cloudinarySecureUrl: resource.secureUrl,
      cloudinaryAssetId: resource.assetId,
      cloudinaryVersion: resource.version,
      originalFilename: filename,
      format: resource.format ?? spec?.extensions[0] ?? null,
      mimeType: input.mimeType?.slice(0, 128) ?? spec?.mimeTypes[0] ?? null,
      fileSize: resource.bytes,
      width: resource.width,
      height: resource.height,
      duration: resource.duration,
      checksum: resource.etag,
    })
    .returning();

  logger.info("media registered", {
    albumId: access.album.id,
    mediaId: row.id,
    bytes: resource.bytes,
    resourceType: resource.resourceType,
  });

  return { status: "created", item: toMediaItem(row, access) };
}

/**
 * Discards an asset that was uploaded but never registered — the "Cancel" side
 * of the duplicate prompt, and the cleanup path for a half-finished upload.
 */
export async function discardPendingUpload(
  access: AlbumAccess,
  publicId: string,
  resourceType: ResourceType,
): Promise<void> {
  if (!isPublicIdInAlbum(publicId, access.album.id)) {
    throw forbidden("That upload does not belong to this album.");
  }
  const [registered] = await db
    .select({ id: media.id })
    .from(media)
    .where(eq(media.cloudinaryPublicId, publicId))
    .limit(1);
  if (registered) {
    throw conflict("That file is already part of the album. Delete it from the gallery instead.");
  }
  await destroyResource(publicId, resourceType);
}

export interface DeleteOutcome {
  deleted: string[];
  failed: Array<{ id: string; reason: string }>;
}

/**
 * Deletes one item: Cloudinary first, then the database row.
 *
 * If Cloudinary refuses, the database row is deliberately left in place and the
 * caller gets an error. Dropping the row anyway would hide a file that still
 * exists and still costs storage.
 */
export async function deleteMediaItem(access: AlbumAccess, mediaId: string): Promise<void> {
  const row = await getMediaForAlbum(access.album.id, mediaId);
  if (!row) throw notFound("That photo or video is no longer in this album.");
  if (!canDelete(access, row)) {
    throw forbidden("You can only delete photos and videos that you uploaded.");
  }

  const result = await destroyResource(row.cloudinaryPublicId, row.cloudinaryResourceType);
  if (!result.ok) {
    await db.insert(orphanedAssets).values({
      cloudinaryPublicId: row.cloudinaryPublicId,
      cloudinaryResourceType: row.cloudinaryResourceType,
      albumId: row.albumId,
      reason: `delete failed: ${result.result}`,
    });
    logger.error("cloudinary delete refused; keeping db row", {
      mediaId,
      publicId: row.cloudinaryPublicId,
      result: result.result,
    });
    throw upstreamFailure(
      "We could not delete that file from storage, so nothing was removed. Please try again.",
    );
  }

  await db.delete(media).where(eq(media.id, row.id));
  logger.info("media deleted", { albumId: access.album.id, mediaId, by: access.role });
}

/** Bulk delete. Each item is authorized independently; failures are reported. */
export async function deleteMediaBulk(
  access: AlbumAccess,
  mediaIds: string[],
): Promise<DeleteOutcome> {
  const rows = await db
    .select()
    .from(media)
    .where(and(eq(media.albumId, access.album.id), inArray(media.id, mediaIds)));

  const outcome: DeleteOutcome = { deleted: [], failed: [] };
  const found = new Set(rows.map((r) => r.id));

  for (const id of mediaIds) {
    if (!found.has(id)) outcome.failed.push({ id, reason: "not_found" });
  }

  for (const row of rows) {
    if (!canDelete(access, row)) {
      outcome.failed.push({ id: row.id, reason: "forbidden" });
      continue;
    }
    const result = await destroyResource(row.cloudinaryPublicId, row.cloudinaryResourceType);
    if (!result.ok) {
      await db.insert(orphanedAssets).values({
        cloudinaryPublicId: row.cloudinaryPublicId,
        cloudinaryResourceType: row.cloudinaryResourceType,
        albumId: row.albumId,
        reason: `bulk delete failed: ${result.result}`,
      });
      outcome.failed.push({ id: row.id, reason: "storage_error" });
      continue;
    }
    await db.delete(media).where(eq(media.id, row.id));
    outcome.deleted.push(row.id);
  }

  logger.info("media bulk delete", {
    albumId: access.album.id,
    deleted: outcome.deleted.length,
    failed: outcome.failed.length,
  });

  return outcome;
}

/** Media rows for a set of ids, in a stable order, scoped to one album. */
export async function getMediaByIds(albumId: string, ids: string[]): Promise<Media[]> {
  if (!ids.length) return [];
  return db
    .select()
    .from(media)
    .where(and(eq(media.albumId, albumId), inArray(media.id, ids)))
    .orderBy(asc(media.createdAt), asc(media.id));
}

export async function listAllMediaForAlbum(albumId: string): Promise<Media[]> {
  return db
    .select()
    .from(media)
    .where(eq(media.albumId, albumId))
    .orderBy(asc(media.createdAt), asc(media.id));
}

export async function recentUploads(access: AlbumAccess, limit = 12): Promise<MediaItem[]> {
  const rows = await db
    .select()
    .from(media)
    .where(eq(media.albumId, access.album.id))
    .orderBy(desc(media.createdAt))
    .limit(limit);
  return rows.map((row) => toMediaItem(row, access));
}
