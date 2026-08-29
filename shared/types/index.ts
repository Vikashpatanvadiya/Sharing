/**
 * Contract shared by the Express API and the React client.
 * Everything the browser is allowed to know about an album lives here —
 * note that neither the join code hash, the admin token, nor any Cloudinary
 * credential is ever part of a client-facing type.
 */

export type Role = "admin" | "contributor";

export type ResourceType = "image" | "video" | "raw";

export interface AlbumStats {
  photoCount: number;
  videoCount: number;
  mediaCount: number;
  contributorCount: number;
  /** Sum of the ORIGINAL uploaded file sizes, in bytes. */
  storageBytes: number;
}

export interface AlbumSummary {
  id: string;
  name: string;
  description: string | null;
  /** ISO date (yyyy-mm-dd) or null. */
  eventDate: string | null;
  createdAt: string;
  stats: AlbumStats;
}

/** What the current caller is allowed to do in this album. */
export interface Viewer {
  role: Role;
  contributorId: string | null;
  displayName: string | null;
  /** True when the viewer still needs to tell us their name. */
  needsDisplayName: boolean;
}

export interface AlbumResponse {
  album: AlbumSummary;
  viewer: Viewer;
  /** Only ever populated for admins. */
  joinCode?: string;
}

export interface MediaItem {
  id: string;
  albumId: string;
  contributorId: string | null;
  uploaderName: string;
  /** True when the signed-in viewer may delete this item. */
  canDelete: boolean;
  /** True when the viewer may change who can see this item. */
  canRestrict: boolean;

  /**
   * "album" means everyone in the album sees it. "restricted" means only the
   * uploader, the admin and the people in `visibleTo` can — enforced by the
   * server on every read, not just hidden in the UI.
   */
  visibility: "album" | "restricted";
  /** Contributor ids this item is shared with; only sent to those who may edit it. */
  visibleTo: string[];

  resourceType: ResourceType;
  originalFilename: string;
  format: string | null;
  mimeType: string | null;
  fileSize: number;

  width: number | null;
  height: number | null;
  /** Video duration in seconds. */
  duration: number | null;

  /** Small, cheap gallery preview (a Cloudinary *delivery* transformation). */
  thumbnailUrl: string;
  /** Larger preview used by the lightbox while the original loads. */
  previewUrl: string;
  /** Playable/viewable original. */
  originalUrl: string;
  /** Poster frame for videos. */
  posterUrl: string | null;

  createdAt: string;
}

export interface MediaPage {
  items: MediaItem[];
  /** Opaque cursor for the next page, or null when the end is reached. */
  nextCursor: string | null;
  total: number;
}

export interface UploadTicket {
  /** Client-supplied id so the browser can match tickets back to files. */
  clientId: string;
  uploadUrl: string;
  publicId: string;
  resourceType: ResourceType;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
}

/** A file the server refused to sign, reported per file rather than per batch. */
export interface RejectedUpload {
  clientId: string;
  code: string;
  message: string;
}

export interface UploadTicketRequest {
  files: Array<{
    clientId: string;
    filename: string;
    mimeType?: string;
    fileSize: number;
  }>;
}

export interface CloudinaryUploadResult {
  public_id: string;
  resource_type: string;
  secure_url: string;
  bytes: number;
  format?: string;
  width?: number;
  height?: number;
  duration?: number;
  asset_id?: string;
  version?: number;
  etag?: string;
}

export interface RegisterMediaRequest {
  publicId: string;
  resourceType: ResourceType;
  originalFilename: string;
  mimeType?: string;
  checksum?: string;
}

/** A member of the album, for the "who can see this" picker. */
export interface AlbumMember {
  id: string;
  displayName: string;
  isYou: boolean;
  isAdmin: boolean;
}

export interface ContributorSummary {
  id: string;
  displayName: string;
  mediaCount: number;
  lastSeenAt: string;
}

export interface AdminDashboard {
  album: AlbumSummary;
  joinCode: string;
  joinUrl: string;
  contributors: ContributorSummary[];
  recentUploads: MediaItem[];
}

export type DownloadJobStatus = "pending" | "running" | "ready" | "failed" | "expired";

export interface DownloadJob {
  id: string;
  status: DownloadJobStatus;
  fileCount: number;
  processedCount: number;
  filename: string;
  /** Populated once status === "ready". */
  downloadUrl: string | null;
  error: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface AppConfigResponse {
  maxImageSizeMb: number;
  maxVideoSizeMb: number;
  acceptedImageExtensions: string[];
  acceptedVideoExtensions: string[];
  acceptAttribute: string;
}
