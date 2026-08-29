import type { NextFunction, Request, Response } from "express";
import { env } from "../env.js";
import { forbidden } from "../lib/errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Defence in depth on top of SameSite=Lax cookies: every state-changing request
 * must come from an origin we recognise. Requests with no Origin/Referer at all
 * (curl, native apps) are allowed only outside production.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get("origin");
  const referer = req.get("referer");
  const candidate = origin ?? (referer ? safeOrigin(referer) : null);

  if (!candidate) {
    if (!env.isProduction) return next();
    return next(forbidden("Request blocked for security reasons. Please reload the page."));
  }

  const allowed = new Set(env.allowedOrigins);
  // Behind a proxy the real host is the source of truth for same-origin calls.
  const host = req.get("host");
  if (host) {
    allowed.add(`${req.protocol}://${host}`);
    allowed.add(`https://${host}`);
    allowed.add(`http://${host}`);
  }

  if (allowed.has(candidate.replace(/\/$/, ""))) return next();

  return next(forbidden("Request blocked for security reasons. Please reload the page."));
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
