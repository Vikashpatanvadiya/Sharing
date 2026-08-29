import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { AlbumResponse, MediaItem, MediaPage } from "@shared/types/index";
import { api, ApiRequestError } from "@/lib/api";

export const albumKeys = {
  album: (albumId: string) => ["album", albumId] as const,
  media: (albumId: string, filter: string) => ["album", albumId, "media", filter] as const,
  admin: (albumId: string) => ["album", albumId, "admin"] as const,
  mine: ["albums", "mine"] as const,
  config: ["config"] as const,
};

export function useAlbum(albumId: string | undefined) {
  return useQuery<AlbumResponse, ApiRequestError>({
    queryKey: albumKeys.album(albumId ?? ""),
    queryFn: () => api.getAlbum(albumId!),
    enabled: Boolean(albumId),
    retry: (failureCount, error) => {
      // No point retrying "you're not a member" — send them to the join screen.
      if (error.status === 401 || error.status === 403 || error.status === 404) return false;
      return failureCount < 2;
    },
  });
}

export type MediaFilter = "all" | "photos" | "videos" | "mine";

export function useAlbumMedia(albumId: string | undefined, filter: MediaFilter) {
  return useInfiniteQuery<MediaPage, ApiRequestError>({
    queryKey: albumKeys.media(albumId ?? "", filter),
    queryFn: ({ pageParam }) =>
      api.listMedia(albumId!, { cursor: pageParam as string | undefined, filter }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(albumId),
  });
}

export function useAdminDashboard(albumId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: albumKeys.admin(albumId ?? ""),
    queryFn: () => api.adminDashboard(albumId!),
    enabled: Boolean(albumId) && enabled,
  });
}

export function useMyAlbums() {
  return useQuery({ queryKey: albumKeys.mine, queryFn: api.myAlbums, staleTime: 30_000 });
}

/**
 * Media mutations all invalidate the album (for counts and storage) alongside
 * the gallery pages, so the header never disagrees with the grid.
 */
export function useMediaMutations(albumId: string) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["album", albumId] });
  };

  const removeFromCache = (ids: string[]) => {
    const removed = new Set(ids);
    queryClient.setQueriesData<{ pages: MediaPage[]; pageParams: unknown[] }>(
      { queryKey: ["album", albumId, "media"] },
      (data) => {
        if (!data) return data;
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => !removed.has(item.id)),
            total: Math.max(0, page.total - ids.length),
          })),
        };
      },
    );
  };

  const deleteOne = useMutation({
    mutationFn: (mediaId: string) => api.deleteMedia(mediaId),
    onSuccess: (_data, mediaId) => {
      removeFromCache([mediaId]);
      invalidate();
    },
  });

  const deleteMany = useMutation({
    mutationFn: (mediaIds: string[]) => api.bulkDeleteMedia(mediaIds),
    onSuccess: (result) => {
      removeFromCache(result.deleted);
      invalidate();
    },
  });

  /** Places a freshly uploaded item at the top of the grid immediately. */
  const prependMedia = (media: MediaItem) => {
    queryClient.setQueriesData<{ pages: MediaPage[]; pageParams: unknown[] }>(
      { queryKey: ["album", albumId, "media"] },
      (data) => {
        if (!data?.pages?.length) return data;
        const [first, ...rest] = data.pages;
        if (first.items.some((item) => item.id === media.id)) return data;
        return {
          ...data,
          pages: [{ ...first, items: [media, ...first.items], total: first.total + 1 }, ...rest],
        };
      },
    );
  };

  return { deleteOne, deleteMany, prependMedia, invalidate };
}

export function useAppConfig() {
  return useQuery({ queryKey: albumKeys.config, queryFn: api.config, staleTime: Infinity });
}
