import { Router } from "express";
import { z } from "zod";
import type {
  AdminDashboard,
  AlbumResponse,
  RejectedUpload,
  UploadTicket,
} from "../../shared/types/index.js";
import { env } from "../env.js";
import { badRequest, notFound, payloadTooLarge, unsupportedMedia } from "../lib/errors.js";
import { findFormat } from "../lib/media-types.js";
import {
  createContributorSession,
  requireAccess,
  requireAdmin,
  requireAlbumAccess,
  resolveAlbumAccess,
} from "../middleware/auth.js";
import {
  adminLimiter,
  createAlbumLimiter,
  deleteLimiter,
  downloadLimiter,
  joinLimiter,
  uploadLimiter,
} from "../middleware/rateLimit.js";
import { clearAdminToken, clearMemberSecret, getVisitorId, knownAlbumIds, ownerKeyFor } from "../middleware/session.js";
import {
  ALBUM_NOT_FOUND_MESSAGE,
  createAlbum,
  deleteAlbum,
  findAlbumByCode,
  joinAlbum,
  listAlbumMembers,
  listContributors,
  regenerateJoinCode,
  revealJoinCode,
  setDisplayName,
  toAlbumSummary,
  updateAlbum,
} from "../services/albums.js";
import { createSignedUpload } from "../services/cloudinary.js";
import { createDownloadJob, toDownloadJob } from "../services/downloads.js";
import {
  discardPendingUpload,
  listMedia,
  recentUploads,
  registerMedia,
} from "../services/media.js";
import { loadAlbumById } from "../middleware/auth.js";

export const albumsRouter = Router();

const nameSchema = z
  .string()
  .trim()
  .min(1, "Please give your album a name.")
  .max(120, "Album names can be up to 120 characters.");

const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Please enter a name.")
  .max(60, "Names can be up to 60 characters.");

const eventDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Please use the date picker.")
  .nullable()
  .optional();

const createAlbumSchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(500).nullable().optional(),
  eventDate: eventDateSchema,
  creatorName: displayNameSchema.nullable().optional(),
});

/** Everything the album screen needs in one round trip. */
function albumResponse(
  access: NonNullable<Awaited<ReturnType<typeof resolveAlbumAccess>>>,
  summary: Awaited<ReturnType<typeof toAlbumSummary>>,
): AlbumResponse {
  return {
    album: summary,
    viewer: {
      role: access.role,
      contributorId: access.contributor.id,
      displayName: access.contributor.displayName,
      needsDisplayName: access.contributor.nameConfirmed !== 1,
    },
    ...(access.role === "admin" ? { joinCode: revealJoinCode(access.album) } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Create & join                                                              */
/* -------------------------------------------------------------------------- */

albumsRouter.post("/", createAlbumLimiter, async (req, res, next) => {
  try {
    getVisitorId(req, res);
    const input = createAlbumSchema.parse(req.body);
    const { album, joinCode } = await createAlbum(req, res, input);
    res.status(201).json({
      album: await toAlbumSummary(album),
      joinCode,
      viewer: { role: "admin", contributorId: null, displayName: null, needsDisplayName: false },
    });
  } catch (error) {
    next(error);
  }
});

albumsRouter.post("/join", joinLimiter, async (req, res, next) => {
  try {
    getVisitorId(req, res);
    const { code, displayName } = z
      .object({
        code: z.string().trim().min(1, "Please enter an album code."),
        displayName: displayNameSchema.nullable().optional(),
      })
      .parse(req.body);

    const album = await findAlbumByCode(code);
    // Identical failure for a bad code and a non-existent album; nothing here
    // tells an attacker whether they were close.
    if (!album) throw notFound(ALBUM_NOT_FOUND_MESSAGE);

    await joinAlbum(req, res, album, displayName ?? null);
    const access = await resolveAlbumAccess(req, res, album.id);
    if (!access) throw notFound(ALBUM_NOT_FOUND_MESSAGE);

    res.json(albumResponse(access, await toAlbumSummary(album, access)));
  } catch (error) {
    next(error);
  }
});

/** Albums this browser already holds a credential for, for quick re-entry. */
albumsRouter.get("/mine", async (req, res, next) => {
  try {
    const { admin, member } = knownAlbumIds(req);
    const ids = Array.from(new Set([...admin, ...member]));
    const results = [];
    for (const id of ids.slice(-24).reverse()) {
      const access = await resolveAlbumAccess(req, res, id);
      if (!access) continue;
      results.push({
        album: await toAlbumSummary(access.album, access),
        role: access.role,
      });
    }
    res.json({ albums: results });
  } catch (error) {
    next(error);
  }
});

/* -------------------------------------------------------------------------- */
/* Read, update, delete                                                       */
/* -------------------------------------------------------------------------- */

albumsRouter.get("/:albumId", requireAlbumAccess, async (req, res, next) => {
  try {
    const access = requireAccess(req);
    res.json(albumResponse(access, await toAlbumSummary(access.album, access)));
  } catch (error) {
    next(error);
  }
});

albumsRouter.patch("/:albumId", requireAlbumAccess, requireAdmin, adminLimiter, async (req, res, next) => {
  try {
    const access = requireAccess(req);
    const changes = z
      .object({
        name: nameSchema.optional(),
        description: z.string().trim().max(500).nullable().optional(),
        eventDate: eventDateSchema,
      })
      .parse(req.body);
    const updated = await updateAlbum(access.album.id, changes);
    res.json({ album: await toAlbumSummary(updated) });
  } catch (error) {
    next(error);
  }
});

albumsRouter.delete("/:albumId", requireAlbumAccess, requireAdmin, deleteLimiter, async (req, res, next) => {
  try {
    const access = requireAccess(req);
    const { confirmName } = z
      .object({ confirmName: z.string().optional() })
      .parse(req.body ?? {});
    if (confirmName !== undefined && confirmName.trim() !== access.album.name) {
      throw badRequest("The album name did not match.");
    }

    const result = await deleteAlbum(access.album.id);
    clearAdminToken(req, res, access.album.id);
    clearMemberSecret(req, res, access.album.id);

    res.json({
      deletedMedia: result.deletedMedia,
      // Surfaced rather than hidden: the admin is told if storage cleanup was
      // incomplete, and the assets are queued for retry server-side.
      warning: result.failedAssets.length
        ? `${result.failedAssets.length} file(s) could not be removed from storage and have been flagged for cleanup.`
        : null,
    });
  } catch (error) {
    next(error);
  }
});

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

albumsRouter.post("/:albumId/identity", requireAlbumAccess, async (req, res, next) => {
  try {
    const access = requireAccess(req);
    const { displayName } = z.object({ displayName: displayNameSchema }).parse(req.body);
    const updated = await setDisplayName(access.contributor.id, displayName);
    res.json({
      viewer: {
        role: access.role,
        contributorId: updated.id,
        displayName: updated.displayName,
        needsDisplayName: false,
      },
    });
  } catch (error) {
    next(error);
  }
});

albumsRouter.post("/:albumId/leave", requireAlbumAccess, async (req, res, next) => {
  try {
    const access = requireAccess(req);
    clearMemberSecret(req, res, access.album.id);
    clearAdminToken(req, res, access.album.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/* -------------------------------------------------------------------------- */
/* Gallery                                                                    */
/* -------------------------------------------------------------------------- */

/** The album's members, so anyone can choose who to share a photo with. */
albumsRouter.get("/:albumId/members", requireAlbumAccess, async (req, res, next) => {
  try {
    const access = requireAccess(req);
    res.json({ members: await listAlbumMembers(access) });
  } catch (error) {
    next(error);
  }
});

albumsRouter.get("/:albumId/media", requireAlbumAccess, async (req, res, next) => {
  try {
    const access = requireAccess(req);
    const query = z
      .object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(120).optional(),
        filter: z.enum(["all", "photos", "videos", "mine"]).optional(),
      })
      .parse(req.query);
    res.json(await listMedia(access, query));
  } catch (error) {
    next(error);
  }
});

/* -------------------------------------------------------------------------- */
/* Upload                                                                     */
/* -------------------------------------------------------------------------- */

const uploadTicketSchema = z.object({
  files: z
    .array(
      z.object({
        clientId: z.string().min(1).max(64),
        filename: z.string().min(1).max(255),
        mimeType: z.string().max(128).optional(),
        fileSize: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(100, "Please request signatures in batches of 100 files or fewer."),
});

/**
 * Hands the browser one signed ticket per file. Validation happens here, before
 * a single byte is uploaded, so an unsupported or oversized file fails fast.
 *
 * Each file is judged on its own: one unsupported format in a selection of 100
 * holiday photos rejects that file and signs the other 99, rather than failing
 * the whole batch.
 */
albumsRouter.post("/:albumId/upload/signature", requireAlbumAccess, uploadLimiter, async (req, res, next) => {
  try {
    const access = requireAccess(req);
    const { files } = uploadTicketSchema.parse(req.body);

    const tickets: UploadTicket[] = [];
    const rejected: RejectedUpload[] = [];

    for (const file of files) {
      const spec = findFormat(file.filename, file.mimeType);
      if (!spec) {
        rejected.push({
          clientId: file.clientId,
          code: "unsupported_media_type",
          message: `${file.filename} is not a supported photo or video format.`,
        });
        continue;
      }

      const isVideo = spec.resourceType === "video";
      const limit = isVideo ? env.maxVideoSizeBytes : env.maxImageSizeBytes;
      if (file.fileSize > limit) {
        const limitMb = isVideo ? env.MAX_VIDEO_SIZE_MB : env.MAX_IMAGE_SIZE_MB;
        rejected.push({
          clientId: file.clientId,
          code: "file_too_large",
          message: `${file.filename} is larger than the ${limitMb} MB limit for ${isVideo ? "videos" : "photos"}.`,
        });
        continue;
      }

      const signed = createSignedUpload(access.album.id, spec.resourceType);
      tickets.push({
        clientId: file.clientId,
        uploadUrl: signed.uploadUrl,
        publicId: signed.publicId,
        resourceType: spec.resourceType,
        apiKey: signed.apiKey,
        timestamp: signed.timestamp,
        signature: signed.signature,
        folder: signed.folder,
      });
    }

    // Only an all-or-nothing rejection is an error; a partial one is normal.
    if (!tickets.length && rejected.length) {
      const first = rejected[0];
      throw first.code === "file_too_large"
        ? payloadTooLarge(first.message)
        : unsupportedMedia(first.message);
    }

    res.json({ tickets, rejected });
  } catch (error) {
    next(error);
  }
});

/** Confirms an upload and creates its database record. */
albumsRouter.post("/:albumId/media", requireAlbumAccess, uploadLimiter, async (req, res, next) => {
  try {
    const access = requireAccess(req);
    const input = z
      .object({
        publicId: z.string().min(1).max(300),
        resourceType: z.enum(["image", "video", "raw"]),
        originalFilename: z.string().min(1).max(255),
        mimeType: z.string().max(128).optional(),
        allowDuplicate: z.boolean().optional(),
      })
      .parse(req.body);

    const result = await registerMedia(access, input);
    if (result.status === "duplicate") {
      res.status(409).json({
        error: {
          code: "duplicate_media",
          message: "This photo appears to already exist in this album.",
          details: { existing: result.existing, pendingPublicId: result.pendingPublicId },
        },
      });
      return;
    }
    res.status(201).json({ media: result.item });
  } catch (error) {
    next(error);
  }
});

/** Throws away an uploaded-but-unregistered asset (the "Cancel" on a duplicate). */
albumsRouter.post("/:albumId/media/discard", requireAlbumAccess, uploadLimiter, async (req, res, next) => {
  try {
    const access = requireAccess(req);
    const { publicId, resourceType } = z
      .object({
        publicId: z.string().min(1).max(300),
        resourceType: z.enum(["image", "video", "raw"]),
      })
      .parse(req.body);
    await discardPendingUpload(access, publicId, resourceType);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

albumsRouter.get("/:albumId/admin", requireAlbumAccess, requireAdmin, async (req, res, next) => {
  try {
    const access = requireAccess(req);
    const origin = env.allowedOrigins[0] ?? `${req.protocol}://${req.get("host")}`;
    const joinCode = revealJoinCode(access.album);
    const dashboard: AdminDashboard = {
      album: await toAlbumSummary(access.album),
      joinCode,
      joinUrl: `${origin}/join?code=${encodeURIComponent(joinCode)}`,
      contributors: await listContributors(access.album.id),
      recentUploads: await recentUploads(access, 12),
    };
    res.json(dashboard);
  } catch (error) {
    next(error);
  }
});

albumsRouter.post(
  "/:albumId/regenerate-code",
  requireAlbumAccess,
  requireAdmin,
  adminLimiter,
  async (req, res, next) => {
    try {
      const access = requireAccess(req);
      const { revokeExistingSessions } = z
        .object({ revokeExistingSessions: z.boolean().optional() })
        .parse(req.body ?? {});

      const result = await regenerateJoinCode(access.album.id, { revokeExistingSessions });
      res.json({
        joinCode: result.joinCode,
        revokedSessions: result.revokedSessions,
      });
    } catch (error) {
      next(error);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* Downloads                                                                  */
/* -------------------------------------------------------------------------- */

albumsRouter.post("/:albumId/downloads", requireAlbumAccess, downloadLimiter, async (req, res, next) => {
  try {
    const access = requireAccess(req);
    const { mediaIds } = z
      .object({ mediaIds: z.array(z.string().uuid()).max(5000).optional() })
      .parse(req.body ?? {});

    const visitorId = getVisitorId(req, res);
    const job = await createDownloadJob({
      access,
      ownerKey: ownerKeyFor(visitorId),
      mediaIds,
    });
    res.status(202).json({ job: toDownloadJob(job) });
  } catch (error) {
    next(error);
  }
});

export async function albumFromId(albumId: string) {
  const album = await loadAlbumById(albumId);
  if (!album) throw notFound(ALBUM_NOT_FOUND_MESSAGE);
  return album;
}
