import { and, count, desc, eq, exists, or, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import type { AlbumStats, AlbumSummary, ContributorSummary } from "../../shared/types/index.js";
import { db } from "../db/index.js";
import { albums, contributors, media, orphanedAssets, type Album } from "../db/schema.js";
import { env } from "../env.js";
import {
  decryptSecret,
  encryptSecret,
  generateAlbumCode,
  generateToken,
  hashJoinCode,
  hashToken,
  normalizeAlbumCode,
} from "../lib/crypto.js";
import { AppError, notFound } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { createContributorSession } from "../middleware/auth.js";
import { getMemberSecret, setAdminToken, setMemberSecret } from "../middleware/session.js";
import { deleteAlbumFolder, destroyManyResources } from "./cloudinary.js";

export interface CreateAlbumInput {
  name: string;
  description?: string | null;
  eventDate?: string | null;
  creatorName?: string | null;
}

/** Same message for "wrong code" and "no such album" — no album enumeration. */
export const ALBUM_NOT_FOUND_MESSAGE = "Album not found. Please check your code and try again.";

/**
 * Creates an album with a fresh join code and a *separate* admin credential.
 * The code is stored twice: as a keyed hash (for lookup/verification) and
 * encrypted (so the admin can re-read their own code later). The admin token is
 * stored as a hash only and lives in an httpOnly cookie on the creator's device.
 */
export async function createAlbum(req: Request, res: Response, input: CreateAlbumInput) {
  const adminToken = generateToken(32);

  // Practically impossible with 29 bits of entropy, but a unique index means a
  // collision would be a hard failure, so retry a few times rather than 500.
  let album: Album | undefined;
  let joinCode = "";
  for (let attempt = 0; attempt < 5 && !album; attempt += 1) {
    joinCode = generateAlbumCode();
    try {
      [album] = await db
        .insert(albums)
        .values({
          name: input.name.trim(),
          description: input.description?.trim() || null,
          eventDate: input.eventDate || null,
          joinCodeHash: hashJoinCode(joinCode),
          joinCodeEncrypted: encryptSecret(joinCode),
          adminTokenHash: hashToken(adminToken),
        })
        .returning();
    } catch (error) {
      const isUniqueViolation = (error as { code?: string })?.code === "23505";
      if (!isUniqueViolation) throw error;
      logger.warn("album code collision, retrying");
    }
  }

  if (!album) {
    throw new AppError(500, "internal_error", "We could not create the album. Please try again.");
  }

  setAdminToken(req, res, album.id, adminToken);
  const contributor = await createContributorSession(req, res, album.id, {
    displayName: input.creatorName ?? undefined,
    isAdmin: true,
  });

  logger.info("album created", { albumId: album.id });
  return { album, joinCode, contributor };
}

/** Looks an album up by the code a visitor typed. */
export async function findAlbumByCode(code: string): Promise<Album | null> {
  const normalized = normalizeAlbumCode(code);
  if (!normalized) return null;
  const [album] = await db
    .select()
    .from(albums)
    .where(eq(albums.joinCodeHash, hashJoinCode(normalized)))
    .limit(1);
  return album ?? null;
}

/**
 * Joins the caller to an album. Re-joining from the same browser reuses the
 * existing contributor so a person does not fragment into several identities.
 */
export async function joinAlbum(
  req: Request,
  res: Response,
  album: Album,
  displayName?: string | null,
) {
  const existingSecret = getMemberSecret(req, album.id);

  if (existingSecret) {
    const [existing] = await db
      .select()
      .from(contributors)
      .where(
        and(
          eq(contributors.sessionIdentifier, hashToken(existingSecret)),
          eq(contributors.albumId, album.id),
        ),
      )
      .limit(1);
    if (existing) {
      if (displayName?.trim()) {
        const [updated] = await db
          .update(contributors)
          .set({ displayName: displayName.trim(), nameConfirmed: 1, lastSeenAt: new Date() })
          .where(eq(contributors.id, existing.id))
          .returning();
        setMemberSecret(req, res, album.id, existingSecret);
        return updated ?? existing;
      }
      setMemberSecret(req, res, album.id, existingSecret);
      return existing;
    }
  }

  return createContributorSession(req, res, album.id, {
    displayName: displayName ?? undefined,
  });
}

export async function setDisplayName(contributorId: string, displayName: string) {
  const [updated] = await db
    .update(contributors)
    .set({ displayName: displayName.trim(), nameConfirmed: 1, lastSeenAt: new Date() })
    .where(eq(contributors.id, contributorId))
    .returning();
  return updated;
}

export async function getAlbumStats(albumId: string): Promise<AlbumStats> {
  const [mediaRow] = await db
    .select({
      mediaCount: sql<number>`count(*)::int`,
      photoCount: sql<number>`count(*) filter (where ${media.cloudinaryResourceType} <> 'video')::int`,
      videoCount: sql<number>`count(*) filter (where ${media.cloudinaryResourceType} = 'video')::int`,
      storageBytes: sql<number>`coalesce(sum(${media.fileSize}), 0)::bigint`,
    })
    .from(media)
    .where(eq(media.albumId, albumId));

  // Only people who actually showed up count as contributors; a session row
  // created by a stray visit with no name and no upload would be noise.
  // Built with the query builder rather than a raw correlated subquery: raw SQL
  // renders outer column references unqualified, which silently resolves them
  // against the *inner* table instead.
  const [contributorRow] = await db
    .select({ value: count() })
    .from(contributors)
    .where(
      and(
        eq(contributors.albumId, albumId),
        or(
          eq(contributors.nameConfirmed, 1),
          exists(
            db
              .select({ one: sql`1` })
              .from(media)
              .where(eq(media.contributorId, contributors.id)),
          ),
        ),
      ),
    );

  return {
    mediaCount: Number(mediaRow?.mediaCount ?? 0),
    photoCount: Number(mediaRow?.photoCount ?? 0),
    videoCount: Number(mediaRow?.videoCount ?? 0),
    storageBytes: Number(mediaRow?.storageBytes ?? 0),
    contributorCount: Number(contributorRow?.value ?? 0),
  };
}

export async function toAlbumSummary(album: Album): Promise<AlbumSummary> {
  return {
    id: album.id,
    name: album.name,
    description: album.description,
    eventDate: album.eventDate,
    createdAt: new Date(album.createdAt).toISOString(),
    stats: await getAlbumStats(album.id),
  };
}

/** The plaintext join code, decrypted. Only ever returned to a verified admin. */
export function revealJoinCode(album: Album): string {
  return decryptSecret(album.joinCodeEncrypted) ?? "";
}

export function joinUrlFor(): string {
  return `${env.allowedOrigins[0] ?? ""}/join`;
}

export async function updateAlbum(
  albumId: string,
  changes: { name?: string; description?: string | null; eventDate?: string | null },
) {
  const [updated] = await db
    .update(albums)
    .set({
      ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
      ...(changes.description !== undefined
        ? { description: changes.description?.trim() || null }
        : {}),
      ...(changes.eventDate !== undefined ? { eventDate: changes.eventDate || null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(albums.id, albumId))
    .returning();
  if (!updated) throw notFound(ALBUM_NOT_FOUND_MESSAGE);
  return updated;
}

/**
 * Rotates the join code.
 *
 * Documented behaviour: existing contributor sessions are *independent*
 * credentials and keep working by default — people already in the album are not
 * kicked out just because a new person needs a new code. Passing
 * `revokeExistingSessions` additionally rotates every contributor's session
 * secret, which forces everyone (except the admin) to re-enter the new code.
 */
export async function regenerateJoinCode(
  albumId: string,
  options: { revokeExistingSessions?: boolean } = {},
) {
  let newCode = "";
  let updated: Album | undefined;

  for (let attempt = 0; attempt < 5 && !updated; attempt += 1) {
    newCode = generateAlbumCode();
    try {
      [updated] = await db
        .update(albums)
        .set({
          joinCodeHash: hashJoinCode(newCode),
          joinCodeEncrypted: encryptSecret(newCode),
          codeVersion: sql`${albums.codeVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(albums.id, albumId))
        .returning();
    } catch (error) {
      if ((error as { code?: string })?.code !== "23505") throw error;
    }
  }

  if (!updated) throw notFound(ALBUM_NOT_FOUND_MESSAGE);

  let revokedSessions = 0;
  if (options.revokeExistingSessions) {
    // Replacing each session identifier with a fresh random hash makes every
    // outstanding member cookie unmatchable, without deleting anyone's uploads.
    const rows = await db
      .select({ id: contributors.id })
      .from(contributors)
      .where(and(eq(contributors.albumId, albumId), eq(contributors.isAdmin, 0)));
    for (const row of rows) {
      await db
        .update(contributors)
        .set({ sessionIdentifier: hashToken(generateToken(32)) })
        .where(eq(contributors.id, row.id));
    }
    revokedSessions = rows.length;
  }

  logger.info("album code regenerated", { albumId, revokedSessions });
  return { album: updated, joinCode: newCode, revokedSessions };
}

export async function listContributors(albumId: string): Promise<ContributorSummary[]> {
  const rows = await db
    .select({
      id: contributors.id,
      displayName: contributors.displayName,
      lastSeenAt: contributors.lastSeenAt,
      mediaCount: sql<number>`count(${media.id})::int`,
    })
    .from(contributors)
    .leftJoin(media, eq(media.contributorId, contributors.id))
    .where(eq(contributors.albumId, albumId))
    .groupBy(contributors.id, contributors.displayName, contributors.lastSeenAt)
    .orderBy(desc(contributors.lastSeenAt))
    .limit(200);

  return rows
    .filter((row) => row.mediaCount > 0 || row.displayName !== "Guest")
    .map((row) => ({
      id: row.id,
      displayName: row.displayName,
      mediaCount: Number(row.mediaCount),
      lastSeenAt: new Date(row.lastSeenAt).toISOString(),
    }));
}

export interface DeleteAlbumResult {
  deletedMedia: number;
  failedAssets: string[];
}

/**
 * Deletes an album and every asset behind it.
 *
 * Cloudinary is emptied first, in batches by resource type. Assets Cloudinary
 * refuses to delete are recorded in `orphaned_assets` before the rows go away,
 * so an operator can retry them — nothing is ever silently abandoned. The album
 * deletion itself still completes, because leaving a "half-deleted" album that
 * the admin cannot retry would be worse.
 */
export async function deleteAlbum(albumId: string): Promise<DeleteAlbumResult> {
  const rows = await db
    .select({
      publicId: media.cloudinaryPublicId,
      resourceType: media.cloudinaryResourceType,
    })
    .from(media)
    .where(eq(media.albumId, albumId));

  const byType = new Map<string, string[]>();
  for (const row of rows) {
    const list = byType.get(row.resourceType) ?? [];
    list.push(row.publicId);
    byType.set(row.resourceType, list);
  }

  const failedAssets: string[] = [];
  for (const [resourceType, publicIds] of byType) {
    const { failed } = await destroyManyResources(publicIds, resourceType);
    if (failed.length) {
      failedAssets.push(...failed);
      await db.insert(orphanedAssets).values(
        failed.map((publicId) => ({
          cloudinaryPublicId: publicId,
          cloudinaryResourceType: resourceType,
          albumId,
          reason: "album deletion: cloudinary delete failed",
        })),
      );
    }
  }

  // ON DELETE CASCADE removes media, contributors and download jobs with it.
  await db.delete(albums).where(eq(albums.id, albumId));
  await deleteAlbumFolder(albumId);

  logger.info("album deleted", {
    albumId,
    deletedMedia: rows.length,
    failedAssets: failedAssets.length,
  });

  return { deletedMedia: rows.length, failedAssets };
}
