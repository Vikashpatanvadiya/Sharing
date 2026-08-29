import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: "not_found", message: "Endpoint not found." } });
}

/**
 * The single place where an exception becomes an HTTP response. Users get a
 * friendly sentence; the stack trace, SQL and Cloudinary detail go to the log.
 */
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) {
    logger.error("error after response started", { path: req.path, error });
    res.end();
    return;
  }

  if (error instanceof ZodError) {
    logger.warn("validation failed", { path: req.path, issues: error.issues });
    res.status(400).json({
      error: {
        code: "validation_failed",
        message: firstFriendlyIssue(error),
        details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return;
  }

  if (error instanceof AppError) {
    if (error.status >= 500) {
      logger.error("handled server error", { path: req.path, code: error.code, error });
    } else {
      logger.warn("handled client error", { path: req.path, code: error.code, message: error.message });
    }
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  logger.error("unhandled error", { path: req.path, method: req.method, error });
  res.status(500).json({
    error: {
      code: "internal_error",
      message: "Something went wrong on our side. Please try again.",
    },
  });
}

function firstFriendlyIssue(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Please check the information you entered.";
  const field = issue.path.length ? `${issue.path.join(".")}: ` : "";
  return `${field}${issue.message}`;
}
