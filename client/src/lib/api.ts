import type {
  AdminDashboard,
  AlbumResponse,
  AlbumSummary,
  AppConfigResponse,
  DownloadJob,
  MediaItem,
  MediaPage,
  RejectedUpload,
  Role,
  UploadTicket,
  Viewer,
} from "@shared/types/index";

/** An API failure the UI can present as-is — the server writes friendly copy. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = options;
  let response: Response;

  try {
    response = await fetch(path, {
      ...rest,
      // Cookies carry the session; they must ride along on every call.
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiRequestError(0, "network_error", "You appear to be offline. Check your connection and try again.");
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiRequestError(
      response.status,
      error?.code ?? "unknown_error",
      error?.message ?? "Something went wrong. Please try again.",
      error?.details,
    );
  }

  return payload as T;
}

export const api = {
  config: () => request<AppConfigResponse>("/api/config"),

  createAlbum: (input: {
    name: string;
    description?: string | null;
    eventDate?: string | null;
    creatorName?: string | null;
  }) =>
    request<{ album: AlbumSummary; joinCode: string; viewer: Viewer }>("/api/albums", {
      method: "POST",
      json: input,
    }),

  joinAlbum: (input: { code: string; displayName?: string | null }) =>
    request<AlbumResponse>("/api/albums/join", { method: "POST", json: input }),

  myAlbums: () =>
    request<{ albums: Array<{ album: AlbumSummary; role: Role }> }>("/api/albums/mine"),

  getAlbum: (albumId: string) => request<AlbumResponse>(`/api/albums/${albumId}`),

  updateAlbum: (
    albumId: string,
    changes: { name?: string; description?: string | null; eventDate?: string | null },
  ) =>
    request<{ album: AlbumSummary }>(`/api/albums/${albumId}`, {
      method: "PATCH",
      json: changes,
    }),

  deleteAlbum: (albumId: string, confirmName: string) =>
    request<{ deletedMedia: number; warning: string | null }>(`/api/albums/${albumId}`, {
      method: "DELETE",
      json: { confirmName },
    }),

  setDisplayName: (albumId: string, displayName: string) =>
    request<{ viewer: Viewer }>(`/api/albums/${albumId}/identity`, {
      method: "POST",
      json: { displayName },
    }),

  leaveAlbum: (albumId: string) =>
    request<{ ok: true }>(`/api/albums/${albumId}/leave`, { method: "POST" }),

  listMedia: (albumId: string, params: { cursor?: string; filter?: string; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.cursor) query.set("cursor", params.cursor);
    if (params.filter && params.filter !== "all") query.set("filter", params.filter);
    if (params.limit) query.set("limit", String(params.limit));
    const suffix = query.toString() ? `?${query}` : "";
    return request<MediaPage>(`/api/albums/${albumId}/media${suffix}`);
  },

  uploadTickets: (
    albumId: string,
    files: Array<{ clientId: string; filename: string; mimeType?: string; fileSize: number }>,
  ) =>
    request<{ tickets: UploadTicket[]; rejected: RejectedUpload[] }>(`/api/albums/${albumId}/upload/signature`, {
      method: "POST",
      json: { files },
    }),

  registerMedia: (
    albumId: string,
    input: {
      publicId: string;
      resourceType: string;
      originalFilename: string;
      mimeType?: string;
      allowDuplicate?: boolean;
    },
  ) => request<{ media: MediaItem }>(`/api/albums/${albumId}/media`, { method: "POST", json: input }),

  discardUpload: (albumId: string, publicId: string, resourceType: string) =>
    request<{ ok: true }>(`/api/albums/${albumId}/media/discard`, {
      method: "POST",
      json: { publicId, resourceType },
    }),

  deleteMedia: (mediaId: string) =>
    request<{ deleted: string }>(`/api/media/${mediaId}`, { method: "DELETE" }),

  bulkDeleteMedia: (mediaIds: string[]) =>
    request<{
      deleted: string[];
      failed: Array<{ id: string; reason: string }>;
      message: string | null;
    }>("/api/media/bulk-delete", { method: "POST", json: { mediaIds } }),

  adminDashboard: (albumId: string) => request<AdminDashboard>(`/api/albums/${albumId}/admin`),

  regenerateCode: (albumId: string, revokeExistingSessions: boolean) =>
    request<{ joinCode: string; revokedSessions: number }>(
      `/api/albums/${albumId}/regenerate-code`,
      { method: "POST", json: { revokeExistingSessions } },
    ),

  createDownload: (albumId: string, mediaIds?: string[]) =>
    request<{ job: DownloadJob }>(`/api/albums/${albumId}/downloads`, {
      method: "POST",
      json: mediaIds?.length ? { mediaIds } : {},
    }),

  downloadStatus: (jobId: string) => request<{ job: DownloadJob }>(`/api/downloads/${jobId}`),
};

/** Direct link to an original. Cookie-authorized, so a plain anchor works. */
export function downloadUrl(mediaId: string): string {
  return `/api/media/${mediaId}/download`;
}
