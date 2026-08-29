import type { CookieOptions, Request, Response } from "express";
import { env } from "../env.js";
import { generateToken, hashToken, signPayload, verifyPayload } from "../lib/crypto.js";

/**
 * Sessions are stateless signed cookies that carry *credentials*, never claims.
 * The cookie says "here is a secret for album X"; the server still has to match
 * that secret against a hash in the database before granting anything. A forged
 * or edited cookie therefore buys an attacker nothing.
 */
const ADMIN_COOKIE = "sa_admin";
const MEMBER_COOKIE = "sa_member";
const VISITOR_COOKIE = "sa_visitor";

/** Keeps the cookie small; people realistically juggle a handful of albums. */
const MAX_ENTRIES = 24;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

type TokenMap = Record<string, string>;

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Lax still sends the cookie on top-level navigation (opening a share link)
    // while blocking cross-site POSTs — our first line of CSRF defence.
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    maxAge: ONE_YEAR_MS,
  };
}

function read(req: Request, name: string): TokenMap {
  const value = verifyPayload<TokenMap>(req.cookies?.[name]);
  return value && typeof value === "object" ? value : {};
}

/**
 * Writes the cookie on the response *and* updates `req.cookies` in place.
 *
 * Without the second half, code that issues a credential and then re-resolves
 * the session inside the same request (joining an album, then loading it)
 * would read the stale pre-request cookie and conclude the caller has no
 * access at all.
 */
function write(req: Request, res: Response, name: string, map: TokenMap): void {
  // Trim oldest entries first (insertion order is preserved by JSON objects).
  const entries = Object.entries(map);
  const trimmed = entries.slice(Math.max(0, entries.length - MAX_ENTRIES));
  const signed = signPayload(Object.fromEntries(trimmed));
  res.cookie(name, signed, cookieOptions());
  if (req.cookies) req.cookies[name] = signed;
}

export function getAdminToken(req: Request, albumId: string): string | undefined {
  return read(req, ADMIN_COOKIE)[albumId];
}

export function setAdminToken(req: Request, res: Response, albumId: string, token: string): void {
  const map = read(req, ADMIN_COOKIE);
  delete map[albumId];
  map[albumId] = token;
  write(req, res, ADMIN_COOKIE, map);
}

export function clearAdminToken(req: Request, res: Response, albumId: string): void {
  const map = read(req, ADMIN_COOKIE);
  delete map[albumId];
  write(req, res, ADMIN_COOKIE, map);
}

export function getMemberSecret(req: Request, albumId: string): string | undefined {
  return read(req, MEMBER_COOKIE)[albumId];
}

export function setMemberSecret(req: Request, res: Response, albumId: string, secret: string): void {
  const map = read(req, MEMBER_COOKIE);
  delete map[albumId];
  map[albumId] = secret;
  write(req, res, MEMBER_COOKIE, map);
}

export function clearMemberSecret(req: Request, res: Response, albumId: string): void {
  const map = read(req, MEMBER_COOKIE);
  delete map[albumId];
  write(req, res, MEMBER_COOKIE, map);
}

/** Album ids this browser holds *some* credential for — used by "my albums". */
export function knownAlbumIds(req: Request): { admin: string[]; member: string[] } {
  return {
    admin: Object.keys(read(req, ADMIN_COOKIE)),
    member: Object.keys(read(req, MEMBER_COOKIE)),
  };
}

/**
 * A stable, anonymous per-browser id. Used to rate-limit join attempts and to
 * scope prepared ZIP downloads to the browser that asked for them. It carries
 * no authority on its own.
 */
export function getVisitorId(req: Request, res: Response): string {
  const existing = verifyPayload<{ v: string }>(req.cookies?.[VISITOR_COOKIE]);
  if (existing?.v) return existing.v;
  const id = generateToken(16);
  const signed = signPayload({ v: id });
  res.cookie(VISITOR_COOKIE, signed, cookieOptions());
  // Visible to the rest of this request too, so a download job created on a
  // visitor's very first call is still owned by that same visitor.
  if (req.cookies) req.cookies[VISITOR_COOKIE] = signed;
  req.visitorId = id;
  return id;
}

export function ownerKeyFor(visitorId: string): string {
  return hashToken(`download:${visitorId}`);
}
