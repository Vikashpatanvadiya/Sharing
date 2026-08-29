/**
 * Vercel serverless entry point.
 * Boots the Express app and exports it as the default handler.
 * NOTE: Long-running features (ZIP downloads, cleanup timers) are unreliable
 * on Vercel's free plan due to the 30s function timeout and ephemeral filesystem.
 */
import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { errorHandler } from "../server/middleware/error.js";
import { apiRouter } from "../server/routes/index.js";

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

app.use("/api", apiRouter);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "Endpoint not found." } });
});

app.use(errorHandler);

export default app;
