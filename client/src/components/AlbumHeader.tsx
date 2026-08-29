import {
  CheckSquare,
  Download,
  ImagePlus,
  MoreHorizontal,
  Settings,
  Share2,
} from "lucide-react";
import { Link } from "wouter";
import type { AlbumResponse } from "@shared/types/index";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Logo } from "@/components/Logo";
import { formatBytes, formatDate, pluralize } from "@/lib/format";

interface AlbumHeaderProps {
  data: AlbumResponse;
  onUpload: () => void;
  onShare: () => void;
  onDownloadAlbum: () => void;
  onOpenAdmin: () => void;
  onToggleSelection: () => void;
}

export function AlbumHeader({
  data,
  onUpload,
  onShare,
  onDownloadAlbum,
  onOpenAdmin,
  onToggleSelection,
}: AlbumHeaderProps) {
  const { album, viewer } = data;
  const isAdmin = viewer.role === "admin";

  return (
    <header className="border-b border-border/70 bg-card/80 backdrop-blur-xl">
      <div className="container">
        <div className="flex h-16 items-center justify-between gap-3">
          <Logo className="shrink-0" />
          <div className="flex items-center gap-1.5">
            {isAdmin && (
              <Button variant="ghost" size="icon-sm" onClick={onOpenAdmin} aria-label="Album settings">
                <Settings className="h-4 w-4" />
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onShare} className="hidden sm:inline-flex">
              <Share2 className="h-4 w-4" />
              Share
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="More options">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onShare}>
                  <Share2 className="h-4 w-4" />
                  Share album code
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onToggleSelection}>
                  <CheckSquare className="h-4 w-4" />
                  Select items
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onDownloadAlbum}>
                  <Download className="h-4 w-4" />
                  Download album
                </DropdownMenuItem>
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={onOpenAdmin}>
                      <Settings className="h-4 w-4" />
                      Album settings
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/">Back to home</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="pb-6 pt-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{album.name}</h1>
          {album.description && (
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground sm:text-base">
              {album.description}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>{pluralize(album.stats.photoCount, "photo")}</span>
            <span>{pluralize(album.stats.videoCount, "video")}</span>
            <span>{pluralize(album.stats.contributorCount, "contributor")}</span>
            {album.stats.storageBytes > 0 && <span>{formatBytes(album.stats.storageBytes)}</span>}
            {album.eventDate && <span>{formatDate(album.eventDate)}</span>}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={onUpload} className="flex-1 sm:flex-none">
              <ImagePlus className="h-4 w-4" />
              Add photos &amp; videos
            </Button>
            <Button variant="outline" onClick={onDownloadAlbum} className="flex-1 sm:flex-none">
              <Download className="h-4 w-4" />
              Download album
            </Button>
            <Button variant="ghost" onClick={onToggleSelection} className="hidden sm:inline-flex">
              <CheckSquare className="h-4 w-4" />
              Select
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
