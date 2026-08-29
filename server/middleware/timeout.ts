import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";

/**
 * A backstop so no API call can hang indefinitely.
 *
 * A dropped database connection used to leave a request open for over a
 * minute with nothing on screen. Failing at 20 seconds with a message people
 * can act on is far better than an app that looks frozen.
 *
 * Streaming routes are exempt: downloading a 250 MB original legitimately
 * takes longer than any fixed budget.
 */
const DEFAULT_TIMEOUT_MS = 20_000;

const STREAMING = [/^\/media\/[^/]+\/(original|download)$/, /^\/downloads\/[^/]+\/file$/];

export function requestTimeout(ms = DEFAULT_TIMEOUT_MS) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (STREAMING.some((pattern) => pattern.test(req.path))) return next();

    const timer = setTimeout(() => {
      if (res.headersSent) return;
      logger.error("request timed out", { method: req.method, path: req.path, ms });
      res.status(503).json({
        error: {
          code: "timeout",
          message: "That took too long. Check your connection and try again.",
        },
      });
    }, ms);
    timer.unref();

    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));
    next();
  };
}
