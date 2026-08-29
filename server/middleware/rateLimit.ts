import rateLimit, { type Options } from "express-rate-limit";
import type { Request } from "express";
import { env } from "../env.js";
import { logger } from "../lib/logger.js";

/**
 * Rate limits are keyed on the anonymous visitor cookie when present and fall
 * back to IP, so a single browser cannot dodge the join-code limiter simply by
 * dropping its cookie behind a shared NAT.
 */
function keyFor(req: Request): string {
  const visitor = req.cookies?.sa_visitor as string | undefined;
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  return visitor ? `${ip}:${visitor.slice(0, 24)}` : ip;
}

function makeLimiter(name: string, options: Partial<Options> & { windowMs: number; limit: number }) {
  return rateLimit({
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: keyFor,
    // Development would otherwise be miserable while testing 100-file uploads.
    skip: () => !env.isProduction && process.env.RATE_LIMIT_IN_DEV !== "1",
    handler: (req, res) => {
      logger.warn("rate limit hit", { limiter: name, path: req.path, key: keyFor(req) });
      res.status(429).json({
        error: {
          code: "rate_limited",
          message: "Too many attempts. Please wait a moment and try again.",
        },
      });
    },
    ...options,
  });
}

/** Brute-forcing a 6-character code needs millions of tries; this stops it dead. */
export const joinLimiter = makeLimiter("join", { windowMs: 10 * 60 * 1000, limit: 12 });

export const createAlbumLimiter = makeLimiter("create-album", {
  windowMs: 60 * 60 * 1000,
  limit: 20,
});

/** Generous — one signature per uploaded file, and bulk uploads are the norm. */
export const uploadLimiter = makeLimiter("upload", { windowMs: 60 * 1000, limit: 400 });

export const deleteLimiter = makeLimiter("delete", { windowMs: 60 * 1000, limit: 120 });

export const downloadLimiter = makeLimiter("download", { windowMs: 5 * 60 * 1000, limit: 60 });

export const adminLimiter = makeLimiter("admin", { windowMs: 60 * 1000, limit: 60 });

export const generalApiLimiter = makeLimiter("api", { windowMs: 60 * 1000, limit: 600 });
