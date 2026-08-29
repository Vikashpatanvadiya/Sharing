import { Router } from "express";
import type { AppConfigResponse } from "../../shared/types/index.js";
import { env } from "../env.js";
import {
  acceptAttribute,
  acceptedImageExtensions,
  acceptedVideoExtensions,
} from "../lib/media-types.js";
import { csrfGuard } from "../middleware/csrf.js";
import { generalApiLimiter } from "../middleware/rateLimit.js";
import { albumsRouter } from "./albums.js";
import { downloadsRouter } from "./downloads.js";
import { mediaRouter } from "./media.js";

export const apiRouter = Router();

apiRouter.use(generalApiLimiter);
apiRouter.use(csrfGuard);

/** Upload limits and accepted formats, so the client never hardcodes them. */
apiRouter.get("/config", (_req, res) => {
  const config: AppConfigResponse = {
    maxImageSizeMb: env.MAX_IMAGE_SIZE_MB,
    maxVideoSizeMb: env.MAX_VIDEO_SIZE_MB,
    acceptedImageExtensions,
    acceptedVideoExtensions,
    acceptAttribute,
  };
  res.json(config);
});

apiRouter.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

apiRouter.use("/albums", albumsRouter);
apiRouter.use("/media", mediaRouter);
apiRouter.use("/downloads", downloadsRouter);
