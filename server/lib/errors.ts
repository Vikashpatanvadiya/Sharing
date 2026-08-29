/**
 * Errors that are safe to show a user. Anything else that reaches the error
 * middleware is logged in full server-side and reported as a generic 500 —
 * users never see a Postgres or Cloudinary stack trace.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "bad_request", message, details);

export const unauthorized = (message = "Your session has expired. Please enter the album code again.") =>
  new AppError(401, "unauthorized", message);

export const forbidden = (message = "You don't have permission to do that.") =>
  new AppError(403, "forbidden", message);

export const notFound = (message = "Not found.") => new AppError(404, "not_found", message);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, "conflict", message, details);

export const payloadTooLarge = (message: string) => new AppError(413, "file_too_large", message);

export const unsupportedMedia = (message: string) =>
  new AppError(415, "unsupported_media_type", message);

export const tooManyRequests = (message = "Too many attempts. Please wait a moment and try again.") =>
  new AppError(429, "rate_limited", message);

export const upstreamFailure = (message: string, details?: unknown) =>
  new AppError(502, "upstream_error", message, details);
