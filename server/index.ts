import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { env } from "./env.js";
import { logger } from "./lib/logger.js";
import { errorHandler } from "./middleware/error.js";
import { apiRouter } from "./routes/index.js";
import { startDownloadCleanupTimer } from "./services/downloads.js";
import { closeDb } from "./db/index.js";

const app = express();

// Behind a reverse proxy (Render, Fly, nginx) this is what makes req.ip and
// secure-cookie detection correct — and therefore what makes rate limiting work.
app.set("trust proxy", 1);

app.use(
  helmet({
    // The React app needs inline styles; images and media come from Cloudinary.
    contentSecurityPolicy: env.isProduction
      ? {
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
        }
      : false,
    crossOriginEmbedderPolicy: false,
    // Thumbnails are loaded cross-origin from the Cloudinary CDN.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(cookieParser());

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    if (!req.path.startsWith("/api")) return;
    logger.info("request", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
    });
  });
  next();
});

app.use("/api", apiRouter);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "Endpoint not found." } });
});

const server = createServer(app);

async function bootstrap() {
  if (env.isProduction) {
    const { serveStatic } = await import("./vite.js");
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite.js");
    await setupVite(app, server);
  }

  // Registered last so it also catches errors thrown by the client middleware.
  app.use(errorHandler);

  startDownloadCleanupTimer();

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      // eslint-disable-next-line no-console
      console.error(
        `\nPort ${env.PORT} is already in use.\n\n` +
          `  - See what has it:  lsof -nP -iTCP:${env.PORT} -sTCP:LISTEN\n` +
          `  - Or pick another:  set PORT (and PUBLIC_ORIGIN) in .env\n\n` +
          `On macOS, port 5000 belongs to AirPlay Receiver\n` +
          `(System Settings -> General -> AirDrop & Handoff).\n`,
      );
      process.exit(1);
    }
    logger.error("server error", { error });
    process.exit(1);
  });

  server.listen(env.PORT, () => {
    logger.info("server listening", { port: env.PORT, env: env.NODE_ENV });

    if (env.NODE_ENV === "development") {
      const nets = networkInterfaces();
      const networkIp = Object.values(nets)
        .flat()
        .find((iface) => iface && iface.family === "IPv4" && !iface.internal)?.address;

      console.log(`\n  Local:   http://localhost:${env.PORT}`);
      if (networkIp) {
        console.log(`  Network: http://${networkIp}:${env.PORT}`);
      }
      console.log();
    }
  });
}

bootstrap().catch((error) => {
  logger.error("failed to start server", { error });
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info("shutting down", { signal });
    server.close(() => {
      void closeDb().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
