import { v2 as cloudinary } from "cloudinary";
import { Readable } from "node:stream";
import type { ResourceType } from "../../shared/types/index.js";
import { env } from "../env.js";
import { randomSlug } from "../lib/crypto.js";
import { upstreamFailure } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
  ...(env.CLOUDINARY_API_BASE
    ? { upload_prefix: env.CLOUDINARY_API_BASE, api_proxy: undefined }
    : {}),
});

/** Base used for the direct-upload endpoint the browser posts to. */
const API_BASE = env.CLOUDINARY_API_BASE ?? "https://api.cloudinary.com";

/**
 * ----------------------------------------------------------------------------
 * THE ORIGINAL-FILE RULE
 * ----------------------------------------------------------------------------
 * Uploads carry no transformation, no eager derivation, no format coercion and
 * no `overwrite`. Whatever bytes the phone sends are the bytes Cloudinary keeps.
 * Everything below that produces a smaller/faster URL is a *delivery*
 * transformation: Cloudinary derives it on the fly and caches it on the CDN,
 * leaving the stored original completely untouched.
 * ----------------------------------------------------------------------------
 */

export interface SignedUpload {
  uploadUrl: string;
  publicId: string;
  folder: string;
  timestamp: number;
  signature: string;
  apiKey: string;
}

/** Assets are grouped per album: `shared-albums/album_<uuid>/<random>`. */
export function albumFolder(albumId: string): string {
  return `${env.CLOUDINARY_FOLDER}/album_${albumId}`;
}

export function isPublicIdInAlbum(publicId: string, albumId: string): boolean {
  return publicId.startsWith(`${albumFolder(albumId)}/`);
}

/**
 * Signs a single direct-to-Cloudinary upload. The browser gets a signature that
 * is valid for exactly one pre-assigned public_id inside exactly one album's
 * folder — it can neither choose where the file lands nor overwrite anything.
 * CLOUDINARY_API_SECRET never leaves the server.
 */
export function createSignedUpload(albumId: string, resourceType: ResourceType): SignedUpload {
  const folder = albumFolder(albumId);
  const publicId = `${folder}/${randomSlug()}`;
  const timestamp = Math.floor(Date.now() / 1000);

  // Only these params are signed, so only these params may be sent (plus
  // file/api_key/resource_type/cloud_name, which Cloudinary excludes by design).
  const paramsToSign = {
    public_id: publicId,
    timestamp,
    overwrite: false,
    invalidate: false,
  };

  const signature = cloudinary.utils.api_sign_request(paramsToSign, env.CLOUDINARY_API_SECRET);

  return {
    uploadUrl: `${API_BASE}/v1_1/${env.CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
    publicId,
    folder,
    timestamp,
    signature,
    apiKey: env.CLOUDINARY_API_KEY,
  };
}

export interface CloudinaryResource {
  publicId: string;
  resourceType: ResourceType;
  secureUrl: string;
  bytes: number;
  format: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  assetId: string | null;
  version: number | null;
  etag: string | null;
}

/**
 * Reads the asset back from Cloudinary's Admin API after the browser claims an
 * upload succeeded. This is what makes the flow trustworthy: size, dimensions
 * and existence all come from Cloudinary, never from the client's JSON.
 */
export async function fetchResource(
  publicId: string,
  resourceType: ResourceType,
): Promise<CloudinaryResource | null> {
  try {
    const resource = await cloudinary.api.resource(publicId, {
      resource_type: resourceType,
      type: "upload",
    });
    return {
      publicId: resource.public_id,
      resourceType: (resource.resource_type ?? resourceType) as ResourceType,
      secureUrl: resource.secure_url,
      bytes: Number(resource.bytes ?? 0),
      format: resource.format ?? null,
      width: resource.width ?? null,
      height: resource.height ?? null,
      duration: resource.duration != null ? Number(resource.duration) : null,
      assetId: resource.asset_id ?? null,
      version: resource.version != null ? Number(resource.version) : null,
      etag: resource.etag ?? null,
    };
  } catch (error) {
    const status = (error as { error?: { http_code?: number } })?.error?.http_code;
    if (status === 404) return null;
    logger.error("cloudinary resource lookup failed", { publicId, resourceType, error });
    throw upstreamFailure("We could not confirm the upload with the storage provider.");
  }
}

/**
 * Permanently destroys an asset. Returns true only when Cloudinary confirms the
 * asset is gone ("ok") or was already absent ("not found") — anything else is
 * reported as a failure so the caller can refuse to drop the database row.
 */
export async function destroyResource(
  publicId: string,
  resourceType: string,
): Promise<{ ok: boolean; result: string }> {
  try {
    const response = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      type: "upload",
      invalidate: true,
    });
    const result = String(response?.result ?? "unknown");
    return { ok: result === "ok" || result === "not found", result };
  } catch (error) {
    logger.error("cloudinary destroy failed", { publicId, resourceType, error });
    return { ok: false, result: "error" };
  }
}

/** Bulk delete used by album deletion. Cloudinary caps each call at 100 ids. */
export async function destroyManyResources(
  publicIds: string[],
  resourceType: string,
): Promise<{ deleted: string[]; failed: string[] }> {
  const deleted: string[] = [];
  const failed: string[] = [];
  for (let i = 0; i < publicIds.length; i += 100) {
    const batch = publicIds.slice(i, i + 100);
    try {
      const response = await cloudinary.api.delete_resources(batch, {
        resource_type: resourceType,
        type: "upload",
        invalidate: true,
      });
      const results = (response?.deleted ?? {}) as Record<string, string>;
      for (const id of batch) {
        const outcome = results[id];
        if (outcome === "deleted" || outcome === "not_found") deleted.push(id);
        else failed.push(id);
      }
    } catch (error) {
      logger.error("cloudinary bulk destroy failed", { resourceType, count: batch.length, error });
      failed.push(...batch);
    }
  }
  return { deleted, failed };
}

/** Removes the now-empty per-album folder. Best effort; never fatal. */
export async function deleteAlbumFolder(albumId: string): Promise<void> {
  try {
    await cloudinary.api.delete_folder(albumFolder(albumId));
  } catch (error) {
    logger.warn("cloudinary folder cleanup skipped", { albumId, error });
  }
}

/* ---------------------------------------------------------------------------
 * Delivery URLs (previews only — the stored original is never rewritten)
 * ------------------------------------------------------------------------- */

export function thumbnailUrl(publicId: string, resourceType: ResourceType): string {
  if (resourceType === "video") {
    return cloudinary.url(publicId, {
      resource_type: "video",
      secure: true,
      format: "jpg",
      transformation: [
        { start_offset: "0" },
        { width: 600, height: 600, crop: "fill", gravity: "auto" },
        { quality: "auto", fetch_format: "auto" },
      ],
    });
  }
  return cloudinary.url(publicId, {
    resource_type: "image",
    secure: true,
    transformation: [
      { width: 600, height: 600, crop: "fill", gravity: "auto" },
      { quality: "auto", fetch_format: "auto" },
    ],
  });
}

export function previewUrl(publicId: string, resourceType: ResourceType): string {
  if (resourceType === "video") {
    // A streamable MP4 rendition for the in-page player. The original MOV/MKV
    // stays exactly as uploaded and remains what "Download original" returns.
    return cloudinary.url(publicId, {
      resource_type: "video",
      secure: true,
      format: "mp4",
      transformation: [{ width: 1280, crop: "limit" }, { quality: "auto" }],
    });
  }
  return cloudinary.url(publicId, {
    resource_type: "image",
    secure: true,
    transformation: [
      { width: 2000, crop: "limit" },
      { quality: "auto:good", fetch_format: "auto" },
    ],
  });
}

export function posterUrl(publicId: string, resourceType: ResourceType): string | null {
  if (resourceType !== "video") return null;
  return cloudinary.url(publicId, {
    resource_type: "video",
    secure: true,
    format: "jpg",
    transformation: [{ start_offset: "0" }, { width: 1280, crop: "limit" }, { quality: "auto" }],
  });
}

/** The untouched original. Used server-side only, for proxying and zipping. */
export function originalDeliveryUrl(
  publicId: string,
  resourceType: string,
  version?: number | null,
): string {
  return cloudinary.url(publicId, {
    resource_type: resourceType,
    type: "upload",
    secure: true,
    version: version ?? undefined,
    // No transformation array at all: byte-for-byte what was uploaded.
  });
}

export interface OriginalStream {
  stream: Readable;
  status: number;
  headers: Headers;
}

/**
 * Streams the original from Cloudinary through the app. Downloads are proxied
 * rather than redirected so that (a) authorization is enforced on every byte
 * served, (b) the browser gets the real filename via Content-Disposition, and
 * (c) raw storage URLs are never handed to the client.
 */
export async function streamOriginal(
  publicId: string,
  resourceType: string,
  options: { version?: number | null; range?: string; secureUrl?: string } = {},
): Promise<OriginalStream> {
  const url = options.secureUrl || originalDeliveryUrl(publicId, resourceType, options.version);
  const headers: Record<string, string> = {};
  if (options.range) headers.Range = options.range;

  const response = await fetch(url, { headers });
  if (!response.ok && response.status !== 206) {
    logger.error("cloudinary original fetch failed", { publicId, status: response.status });
    throw upstreamFailure("We could not retrieve that file from storage. Please try again.");
  }
  if (!response.body) {
    throw upstreamFailure("We could not retrieve that file from storage. Please try again.");
  }

  return {
    stream: Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    status: response.status,
    headers: response.headers,
  };
}

export { cloudinary };
