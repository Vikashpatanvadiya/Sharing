CREATE TABLE "albums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"event_date" date,
	"join_code_hash" varchar(64) NOT NULL,
	"join_code_encrypted" text NOT NULL,
	"admin_token_hash" varchar(64) NOT NULL,
	"code_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"album_id" uuid NOT NULL,
	"display_name" varchar(60) DEFAULT 'Guest' NOT NULL,
	"name_confirmed" integer DEFAULT 0 NOT NULL,
	"session_identifier" varchar(64) NOT NULL,
	"is_admin" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "download_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"album_id" uuid NOT NULL,
	"requested_by" uuid,
	"owner_key" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"filename" varchar(255) NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"media_ids" text[],
	"storage_path" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"album_id" uuid NOT NULL,
	"contributor_id" uuid,
	"uploader_name" varchar(60) DEFAULT 'Guest' NOT NULL,
	"cloudinary_public_id" text NOT NULL,
	"cloudinary_resource_type" varchar(16) NOT NULL,
	"cloudinary_secure_url" text NOT NULL,
	"cloudinary_asset_id" text,
	"cloudinary_version" bigint,
	"original_filename" varchar(255) NOT NULL,
	"format" varchar(24),
	"mime_type" varchar(128),
	"file_size" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"duration" real,
	"checksum" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orphaned_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cloudinary_public_id" text NOT NULL,
	"cloudinary_resource_type" varchar(16) NOT NULL,
	"album_id" uuid,
	"reason" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contributors" ADD CONSTRAINT "contributors_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_jobs" ADD CONSTRAINT "download_jobs_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "albums_join_code_hash_idx" ON "albums" USING btree ("join_code_hash");--> statement-breakpoint
CREATE INDEX "albums_admin_token_hash_idx" ON "albums" USING btree ("admin_token_hash");--> statement-breakpoint
CREATE INDEX "albums_created_at_idx" ON "albums" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "contributors_album_id_idx" ON "contributors" USING btree ("album_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contributors_session_identifier_idx" ON "contributors" USING btree ("session_identifier");--> statement-breakpoint
CREATE INDEX "contributors_album_created_idx" ON "contributors" USING btree ("album_id","created_at");--> statement-breakpoint
CREATE INDEX "download_jobs_album_id_idx" ON "download_jobs" USING btree ("album_id");--> statement-breakpoint
CREATE INDEX "download_jobs_expiry_idx" ON "download_jobs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "media_album_id_idx" ON "media" USING btree ("album_id");--> statement-breakpoint
CREATE INDEX "media_contributor_id_idx" ON "media" USING btree ("contributor_id");--> statement-breakpoint
CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "media_album_feed_idx" ON "media" USING btree ("album_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_cloudinary_public_id_idx" ON "media" USING btree ("cloudinary_public_id");--> statement-breakpoint
CREATE INDEX "media_album_checksum_idx" ON "media" USING btree ("album_id","checksum");--> statement-breakpoint
CREATE INDEX "orphaned_assets_pending_idx" ON "orphaned_assets" USING btree ("resolved_at","created_at");