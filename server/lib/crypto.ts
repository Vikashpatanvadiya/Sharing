import crypto from "node:crypto";
import { env } from "../env.js";

/**
 * Key material is derived from SESSION_SECRET with distinct info strings, so a
 * single environment secret yields independent keys for independent purposes.
 */
function derive(purpose: string, bytes = 32): Buffer {
  const key = crypto.hkdfSync(
    "sha256",
    Buffer.from(env.SESSION_SECRET, "utf8"),
    Buffer.alloc(0),
    Buffer.from(purpose, "utf8"),
    bytes,
  );
  return Buffer.from(key);
}

const KEYS = {
  /** Keyed hash used to look up / verify album join codes. */
  joinCode: derive("join-code-hash-v1"),
  /** AES key used to keep the join code readable *by the admin only*. */
  joinCodeCipher: derive("join-code-cipher-v1"),
  /** Keyed hash for admin tokens and contributor session secrets. */
  token: derive("token-hash-v1"),
  /** Signing key for the session cookies. */
  cookie: derive("cookie-sign-v1"),
};

/**
 * Album codes avoid characters that are easy to misread out loud or in a
 * screenshot (0/O, 1/I/L, U/V). 6 characters over a 29-symbol alphabet is
 * ~29 bits; brute force is blocked by rate limiting, and codes are rotatable.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTWXYZ23456789";
const CODE_LENGTH = 6;

/** Cryptographically secure, uniformly distributed album code. */
export function generateAlbumCode(length = CODE_LENGTH): string {
  const alphabet = CODE_ALPHABET;
  let out = "";
  while (out.length < length) {
    // Rejection sampling keeps the distribution uniform (no modulo bias).
    const limit = 256 - (256 % alphabet.length);
    for (const byte of crypto.randomBytes(length * 2)) {
      if (byte >= limit) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/**
 * Users paste codes with spaces, dashes and mixed case; we always compare a
 * canonical form. No character substitution happens here: the alphabet already
 * excludes every ambiguous glyph, so a typed "O" or "l" is a genuine typo
 * rather than something we should silently "fix" into a different album.
 */
export function normalizeAlbumCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Keyed (peppered) hash of the join code. Unlike a bare SHA-256 this cannot be
 * reversed with a rainbow table of every possible code, because an attacker
 * with a database dump still lacks SESSION_SECRET. It is deterministic, so it
 * doubles as the lookup index for `POST /api/albums/join`.
 */
export function hashJoinCode(code: string): string {
  return crypto.createHmac("sha256", KEYS.joinCode).update(normalizeAlbumCode(code)).digest("hex");
}

/** Random, URL-safe secret used for admin tokens and contributor sessions. */
export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** Keyed hash for tokens stored in the database. */
export function hashToken(token: string): string {
  return crypto.createHmac("sha256", KEYS.token).update(token).digest("hex");
}

/** Constant-time comparison that tolerates length mismatches. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * The admin has to be able to re-read and re-share the join code, so the raw
 * code is kept encrypted at rest (AES-256-GCM) alongside its keyed hash.
 * The database alone is not enough to recover any code.
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEYS.joinCodeCipher, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(payload: string): string | null {
  try {
    const [version, ivPart, tagPart, dataPart] = payload.split(".");
    if (version !== "v1" || !ivPart || !tagPart || !dataPart) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      KEYS.joinCodeCipher,
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** Sign an arbitrary JSON payload for storage in an httpOnly cookie. */
export function signPayload(payload: unknown): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = crypto.createHmac("sha256", KEYS.cookie).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyPayload<T>(signed: string | undefined): T | null {
  if (!signed) return null;
  const idx = signed.lastIndexOf(".");
  if (idx <= 0) return null;
  const body = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const expected = crypto.createHmac("sha256", KEYS.cookie).update(body).digest("base64url");
  if (!safeEqual(mac, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

/** Short, opaque, non-sequential identifiers for Cloudinary public_ids. */
export function randomSlug(bytes = 12): string {
  return crypto.randomBytes(bytes).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
}

export const ALBUM_CODE_LENGTH = CODE_LENGTH;
