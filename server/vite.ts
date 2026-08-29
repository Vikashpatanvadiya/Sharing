import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { logger } from "./lib/logger.js";

/**
 * In development the React app is served by Vite in middleware mode, so the API
 * and the client share one origin (and therefore one cookie jar). In production
 * we serve the built assets from dist/public.
 */
export async function setupVite(app: Express, server: Server): Promise<void> {
  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: path.resolve(process.cwd(), "vite.config.ts"),
    server: { middlewareMode: true, hmr: { server } },
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    try {
      const templatePath = path.resolve(process.cwd(), "client", "index.html");
      const template = await fs.promises.readFile(templatePath, "utf-8");
      const html = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      next(error);
    }
  });
}

export function serveStatic(app: Express): void {
  const publicDir = path.resolve(process.cwd(), "dist", "public");
  if (!fs.existsSync(publicDir)) {
    logger.error("client build missing", { publicDir });
    throw new Error(`Client build not found at ${publicDir}. Run "npm run build" first.`);
  }

  // Hashed asset filenames can be cached hard; index.html must not be.
  app.use(
    express.static(publicDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  app.use("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(publicDir, "index.html"));
  });
}
