import { relations, sql } from "drizzle-orm";
import {
  bigint,
  date,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Albums. The join code is never stored in the clear:
 *  - `joinCodeHash` is a keyed HMAC used for lookup + verification
 *  - `joinCodeEncrypted` is AES-256-GCM so an *authenticated admin* can
 *    re-read and re-share their own code
 * The admin credential is a separate random token, stored only as a hash.
 */
export const albums = pgTable(
  "albums",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    eventDate: date("event_date"),

    joinCodeHash: varchar("join_code_hash", { length: 64 }).notNull(),
    joinCodeEncrypted: text("join_code_encrypted").notNull(),

    adminTokenHash: varchar("admin_token_hash", { length: 64 }).notNull(),

    /** Bumped when the code is regenerated, for auditing/telemetry. */
    codeVersion: integer("code_version").notNull().default(1),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    joinCodeHashIdx: uniqueIndex("albums_join_code_hash_idx").on(table.joinCodeHash),
    adminTokenHashIdx: index("albums_admin_token_hash_idx").on(table.adminTokenHash),
    createdAtIdx: index("albums_created_at_idx").on(table.createdAt),
  }),
);

/**
 * Contributors are anonymous, per-album participants — no accounts, no
 * passwords. `sessionSecretHash` is the hash of a random secret held in the
 * visitor's httpOnly cookie; identity is always re-derived from it server-side.
 */
export const contributors = pgTable(
  "contributors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 60 }).notNull().default("Guest"),
    /** 0 until the visitor tells us what to call them. */
    nameConfirmed: integer("name_confirmed").notNull().default(0),
    sessionIdentifier: varchar("session_identifier", { length: 64 }).notNull(),
    isAdmin: integer("is_admin").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    albumIdx: index("contributors_album_id_idx").on(table.albumId),
    sessionIdx: uniqueIndex("contributors_session_identifier_idx").on(table.sessionIdentifier),
    albumCreatedIdx: index("contributors_album_created_idx").on(table.albumId, table.createdAt),
  }),
);

/**
 * One row per uploaded original. Cloudinary holds the bytes; this table holds
 * everything needed to (a) render a gallery, (b) stream the original back, and
 * (c) delete the exact Cloudinary asset later.
 */
export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    contributorId: uuid("contributor_id").references(() => contributors.id, {
      onDelete: "set null",
    }),
    /** Denormalised so media survives a contributor row being cleaned up. */
    uploaderName: varchar("uploader_name", { length: 60 }).notNull().default("Guest"),

    cloudinaryPublicId: text("cloudinary_public_id").notNull(),
    cloudinaryResourceType: varchar("cloudinary_resource_type", { length: 16 }).notNull(),
    cloudinarySecureUrl: text("cloudinary_secure_url").notNull(),
    cloudinaryAssetId: text("cloudinary_asset_id"),
    cloudinaryVersion: bigint("cloudinary_version", { mode: "number" }),

    originalFilename: varchar("original_filename", { length: 255 }).notNull(),
    format: varchar("format", { length: 24 }),
    mimeType: varchar("mime_type", { length: 128 }),
    fileSize: bigint("file_size", { mode: "number" }).notNull(),

    width: integer("width"),
    height: integer("height"),
    duration: real("duration"),

    /** Cloudinary etag / client checksum, used for duplicate detection. */
    checksum: varchar("checksum", { length: 128 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    albumIdx: index("media_album_id_idx").on(table.albumId),
    contributorIdx: index("media_contributor_id_idx").on(table.contributorId),
    createdAtIdx: index("media_created_at_idx").on(table.createdAt),
    /** Drives keyset pagination for the gallery. */
    albumFeedIdx: index("media_album_feed_idx").on(table.albumId, table.createdAt, table.id),
    publicIdIdx: uniqueIndex("media_cloudinary_public_id_idx").on(table.cloudinaryPublicId),
    checksumIdx: index("media_album_checksum_idx").on(table.albumId, table.checksum),
  }),
);

/**
 * Cloudinary assets whose deletion failed. Nothing is ever silently orphaned:
 * failures are recorded here so they can be retried and audited.
 */
export const orphanedAssets = pgTable(
  "orphaned_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cloudinaryPublicId: text("cloudinary_public_id").notNull(),
    cloudinaryResourceType: varchar("cloudinary_resource_type", { length: 16 }).notNull(),
    albumId: uuid("album_id"),
    reason: text("reason"),
    attempts: integer("attempts").notNull().default(1),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pendingIdx: index("orphaned_assets_pending_idx").on(table.resolvedAt, table.createdAt),
  }),
);

/** Server-side ZIP jobs, so huge albums never have to fit in browser memory. */
export const downloadJobs = pgTable(
  "download_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by"),
    /** Hash of the session that may download the result. */
    ownerKey: varchar("owner_key", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    filename: varchar("filename", { length: 255 }).notNull(),
    fileCount: integer("file_count").notNull().default(0),
    processedCount: integer("processed_count").notNull().default(0),
    mediaIds: text("media_ids").array(),
    storagePath: text("storage_path"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => ({
    albumIdx: index("download_jobs_album_id_idx").on(table.albumId),
    expiryIdx: index("download_jobs_expiry_idx").on(table.expiresAt),
  }),
);

export const albumsRelations = relations(albums, ({ many }) => ({
  contributors: many(contributors),
  media: many(media),
}));

export const contributorsRelations = relations(contributors, ({ one, many }) => ({
  album: one(albums, { fields: [contributors.albumId], references: [albums.id] }),
  media: many(media),
}));

export const mediaRelations = relations(media, ({ one }) => ({
  album: one(albums, { fields: [media.albumId], references: [albums.id] }),
  contributor: one(contributors, { fields: [media.contributorId], references: [contributors.id] }),
}));

export type Album = typeof albums.$inferSelect;
export type NewAlbum = typeof albums.$inferInsert;
export type Contributor = typeof contributors.$inferSelect;
export type NewContributor = typeof contributors.$inferInsert;
export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
export type DownloadJobRow = typeof downloadJobs.$inferSelect;

export const nowSql = sql`now()`;
