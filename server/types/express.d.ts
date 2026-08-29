import type { AlbumAccess } from "../middleware/auth.js";

declare global {
  namespace Express {
    interface Request {
      /** Populated by requireAlbumAccess / requireAdmin. Never trust the body. */
      access?: AlbumAccess;
      visitorId?: string;
    }
  }
}

export {};
