import { Router } from "express";
import fs from "node:fs";
import { z } from "zod";
import { notFound, unauthorized } from "../lib/errors.js";
import { resolveAlbumAccess } from "../middleware/auth.js";
import { downloadLimiter } from "../middleware/rateLimit.js";
import { getVisitorId, ownerKeyFor } from "../middleware/session.js";
import { db } from "../db/index.js";
import { downloadJobs } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { getOwnedJob, jobFilePath, toDownloadJob } from "../services/downloads.js";

export const downloadsRouter = Router();

const idSchema = z.string().uuid();

/**
 * A prepared archive is bound to three things at once: the job id, the browser
 * that requested it, and a still-valid session for that album. Losing album
 * access mid-download revokes the ZIP too.
 */
async function loadJob(req: Parameters<typeof getVisitorId>[0], res: Parameters<typeof getVisitorId>[1], jobId: string) {
  if (!idSchema.safeParse(jobId).success) throw notFound("That download is no longer available.");
  const [row] = await db.select().from(downloadJobs).where(eq(downloadJobs.id, jobId)).limit(1);
  if (!row) throw notFound("That download is no longer available.");

  const access = await resolveAlbumAccess(req, res, row.albumId);
  if (!access) throw unauthorized("You don't have access to this album.");

  const visitorId = getVisitorId(req, res);
  return getOwnedJob(jobId, row.albumId, ownerKeyFor(visitorId));
}

downloadsRouter.get("/:jobId", downloadLimiter, async (req, res, next) => {
  try {
    const job = await loadJob(req, res, req.params.jobId);
    res.json({ job: toDownloadJob(job) });
  } catch (error) {
    next(error);
  }
});

downloadsRouter.get("/:jobId/file", downloadLimiter, async (req, res, next) => {
  try {
    const job = await loadJob(req, res, req.params.jobId);
    const filePath = await jobFilePath(job);
    const stat = await fs.promises.stat(filePath);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Disposition", `attachment; filename="${job.filename}"`);
    res.setHeader("Cache-Control", "private, max-age=0, no-store");

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
});
