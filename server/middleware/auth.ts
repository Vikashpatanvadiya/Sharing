import { and, eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { albums, contributors, type Album, type Contributor } from "../db/schema.js";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/errors.js";
import { generateToken, hashToken, safeEqual } from "../lib/crypto.js";
import {
  getAdminToken,
  getMemberSecret,
  getVisitorId,
  setMemberSecret,
} from "./session.js";

export interface AlbumAccess {
  album: Album;
  role: "admin" | "contributor";
  contributor: Contributor;
}

const uuidSchema = z.string().uuid();

/** How stale `last_seen_at` may get before we bother writing to the database. */
const LAST_SEEN_REFRESH_MS = 5 * 60 * 1000;

export async function loadAlbumById(albumId: string): Promise<Album | null> {
  if (!uuidSchema.safeParse(albumId).success) return null;
  const [album] = await db.select().from(albums).where(eq(albums.id, albumId)).limit(1);
  return album ?? null;
}

async function findContributorBySecret(
  albumId: string,
  secret: string | undefined,
): Promise<Contributor | null> {
  if (!secret) return null;
  const [row] = await db
    .select()
    .from(contributors)
    .where(
      and(
        eq(contributors.sessionIdentifier, hashToken(secret)),
        eq(contributors.albumId, albumId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Creates the contributor record that a session points at. Used when someone
 * joins, and as a self-heal when a valid admin token arrives without a
 * matching contributor row (cleared cookies, a second device, …).
 */
export async function createContributorSession(
  req: Request,
  res: Response,
  albumId: string,
  options: { displayName?: string; isAdmin?: boolean } = {},
): Promise<Contributor> {
  const secret = generateToken(32);
  const [row] = await db
    .insert(contributors)
    .values({
      albumId,
      displayName: options.displayName?.trim() || (options.isAdmin ? "Album creator" : "Guest"),
      nameConfirmed: options.displayName?.trim() ? 1 : 0,
      sessionIdentifier: hashToken(secret),
      isAdmin: options.isAdmin ? 1 : 0,
    })
    .returning();
  setMemberSecret(req, res, albumId, secret);
  return row;
}

async function touchLastSeen(contributor: Contributor): Promise<void> {
  const age = Date.now() - new Date(contributor.lastSeenAt).getTime();
  if (age < LAST_SEEN_REFRESH_MS) return;
  await db
    .update(contributors)
    .set({ lastSeenAt: new Date() })
    .where(eq(contributors.id, contributor.id));
}

/**
 * Resolves who the caller is *for this album*, purely from signed cookies and
 * database state. Anything the frontend claims about identity is ignored.
 */
export async function resolveAlbumAccess(
  req: Request,
  res: Response,
  albumId: string,
): Promise<AlbumAccess | null> {
  const album = await loadAlbumById(albumId);
  if (!album) return null;

  const adminToken = getAdminToken(req, album.id);
  const isAdmin = Boolean(adminToken) && safeEqual(hashToken(adminToken!), album.adminTokenHash);

  let contributor = await findContributorBySecret(album.id, getMemberSecret(req, album.id));

  if (!contributor && isAdmin) {
    // Valid admin credential but no contributor row on this device — mint one so
    // the admin's own uploads are still attributed correctly.
    contributor = await createContributorSession(req, res, album.id, { isAdmin: true });
  }

  if (!contributor) return null;

  // A contributor row flagged as admin is not sufficient on its own; the admin
  // token has to verify against the album. This keeps a stolen member cookie
  // from ever escalating.
  if (isAdmin && contributor.isAdmin !== 1) {
    const [updated] = await db
      .update(contributors)
      .set({ isAdmin: 1 })
      .where(eq(contributors.id, contributor.id))
      .returning();
    contributor = updated ?? contributor;
  }

  await touchLastSeen(contributor);

  return { album, role: isAdmin ? "admin" : "contributor", contributor };
}

/** Route guard: caller must hold a valid credential for :albumId. */
export async function requireAlbumAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const albumId = req.params.albumId ?? req.params.id;
    if (!albumId || !uuidSchema.safeParse(albumId).success) {
      throw badRequest("Invalid album reference.");
    }
    getVisitorId(req, res);
    const access = await resolveAlbumAccess(req, res, albumId);
    if (!access) {
      // Deliberately identical for "no such album" and "no access", so probing
      // ids cannot be used to enumerate which albums exist.
      throw unauthorized("You don't have access to this album. Enter the album code to continue.");
    }
    req.access = access;
    next();
  } catch (error) {
    next(error);
  }
}

/** Route guard: caller must be the album's admin. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.access) return next(unauthorized());
  if (req.access.role !== "admin") {
    return next(forbidden("Only the album creator can do that."));
  }
  next();
}

export function requireAccess(req: Request): AlbumAccess {
  if (!req.access) throw unauthorized();
  return req.access;
}

export function albumNotFound(): never {
  throw notFound("Album not found. Please check your code and try again.");
}
