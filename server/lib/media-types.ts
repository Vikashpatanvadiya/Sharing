import type { ResourceType } from "../../shared/types/index.js";

/**
 * The single source of truth for "what may be uploaded". Adding a format is a
 * one-line change here — nothing else in the codebase hardcodes an extension.
 */
interface FormatSpec {
  extensions: string[];
  mimeTypes: string[];
  resourceType: ResourceType;
  kind: "photo" | "video";
}

export const SUPPORTED_FORMATS: FormatSpec[] = [
  {
    extensions: ["jpg", "jpeg", "jpe"],
    mimeTypes: ["image/jpeg"],
    resourceType: "image",
    kind: "photo",
  },
  { extensions: ["png"], mimeTypes: ["image/png"], resourceType: "image", kind: "photo" },
  { extensions: ["webp"], mimeTypes: ["image/webp"], resourceType: "image", kind: "photo" },
  { extensions: ["gif"], mimeTypes: ["image/gif"], resourceType: "image", kind: "photo" },
  { extensions: ["avif"], mimeTypes: ["image/avif"], resourceType: "image", kind: "photo" },
  { extensions: ["bmp"], mimeTypes: ["image/bmp"], resourceType: "image", kind: "photo" },
  { extensions: ["tif", "tiff"], mimeTypes: ["image/tiff"], resourceType: "image", kind: "photo" },
  {
    // Requires HEIC support on the Cloudinary account/plan. Uploads are stored
    // untouched either way — we never convert HEIC to JPG on ingest.
    extensions: ["heic", "heif"],
    mimeTypes: ["image/heic", "image/heif", "image/heic-sequence"],
    resourceType: "image",
    kind: "photo",
  },
  { extensions: ["dng"], mimeTypes: ["image/x-adobe-dng"], resourceType: "image", kind: "photo" },

  { extensions: ["mp4", "m4v"], mimeTypes: ["video/mp4"], resourceType: "video", kind: "video" },
  {
    extensions: ["mov", "qt"],
    mimeTypes: ["video/quicktime"],
    resourceType: "video",
    kind: "video",
  },
  { extensions: ["webm"], mimeTypes: ["video/webm"], resourceType: "video", kind: "video" },
  { extensions: ["avi"], mimeTypes: ["video/x-msvideo"], resourceType: "video", kind: "video" },
  { extensions: ["mkv"], mimeTypes: ["video/x-matroska"], resourceType: "video", kind: "video" },
  { extensions: ["3gp"], mimeTypes: ["video/3gpp"], resourceType: "video", kind: "video" },
  { extensions: ["mpeg", "mpg"], mimeTypes: ["video/mpeg"], resourceType: "video", kind: "video" },
  { extensions: ["m2ts", "mts"], mimeTypes: ["video/mp2t"], resourceType: "video", kind: "video" },
  { extensions: ["flv"], mimeTypes: ["video/x-flv"], resourceType: "video", kind: "video" },
  { extensions: ["wmv"], mimeTypes: ["video/x-ms-wmv"], resourceType: "video", kind: "video" },
];

export function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

export function findFormat(filename: string, mimeType?: string): FormatSpec | null {
  const ext = extensionOf(filename);
  const byExt = SUPPORTED_FORMATS.find((f) => f.extensions.includes(ext));
  if (byExt) return byExt;
  if (mimeType) {
    const normalized = mimeType.split(";")[0].trim().toLowerCase();
    const byMime = SUPPORTED_FORMATS.find((f) => f.mimeTypes.includes(normalized));
    if (byMime) return byMime;
    // Unknown but clearly a photo/video: let Cloudinary make the final call
    // rather than blocking a format we simply have not listed yet.
    if (normalized.startsWith("image/")) {
      return { extensions: [ext], mimeTypes: [normalized], resourceType: "image", kind: "photo" };
    }
    if (normalized.startsWith("video/")) {
      return { extensions: [ext], mimeTypes: [normalized], resourceType: "video", kind: "video" };
    }
  }
  return null;
}

export function isVideoResource(resourceType: string): boolean {
  return resourceType === "video";
}

export const acceptedImageExtensions = SUPPORTED_FORMATS.filter((f) => f.kind === "photo").flatMap(
  (f) => f.extensions,
);

export const acceptedVideoExtensions = SUPPORTED_FORMATS.filter((f) => f.kind === "video").flatMap(
  (f) => f.extensions,
);

/** `accept` attribute for the file input; deliberately permissive on mobile. */
export const acceptAttribute = [
  "image/*",
  "video/*",
  ...SUPPORTED_FORMATS.flatMap((f) => f.extensions.map((e) => `.${e}`)),
].join(",");

/**
 * Keeps the original filename intact (extension included) while stripping path
 * separators and control characters, so it is safe in a Content-Disposition
 * header and inside a ZIP entry.
 */
export function sanitizeFilename(filename: string): string {
  const cleaned = filename
    .replace(/[\\/]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return (cleaned || "upload").slice(0, 200);
}
