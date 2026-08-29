/**
 * Vercel serverless entry point.
 * Boots the Express app and exports it as the default handler.
 * NOTE: Long-running features (ZIP downloads, cleanup timers) are unreliable
 * on Vercel's free plan due to the 30s function timeout and ephemeral filesystem.
 */
import cookieParser from "cookie-parser";
import express, { type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";

// Validate env vars before anything else. On Vercel, env vars are injected
// directly into process.env — no .env file needed.
const REQUIRED_ENV = [
  "DATABASE_URL",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "SESSION_SECRET",
];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[api/index] Missing required environment variables: ${missing.join(", ")}`);
  // Don't exit — let the function boot and return a 500 with a clear message.
}

const app = express();

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
        mediaSrc: ["'self'", "blob:", "https://res.cloudinary.com"],
        connectSrc: ["'self'", "https://api.cloudinary.com", "https://res.cloudinary.com"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(cookieParser());

// Lazy-load routes so env validation errors surface as 500 responses
// rather than crashing the process before Vercel can invoke the handler.
app.use("/api", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { apiRouter } = await import("../server/routes/index.js");
    apiRouter(req, res, next);
  } catch (err) {
    next(err);
  }
});

app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: { code: "not_found", message: "Endpoint not found." } });
});

// Error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[api/index] unhandled error:", err);
  const message =
    err instanceof Error ? err.message : "Something went wrong on our side. Please try again.";
  res.status(500).json({ error: { code: "internal_error", message } });
});

export default app;
