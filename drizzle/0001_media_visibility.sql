CREATE TABLE "media_visibility" (
	"media_id" uuid NOT NULL,
	"contributor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_visibility_media_id_contributor_id_pk" PRIMARY KEY("media_id","contributor_id")
);
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "visibility" varchar(16) DEFAULT 'album' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_visibility" ADD CONSTRAINT "media_visibility_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_visibility" ADD CONSTRAINT "media_visibility_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_visibility_contributor_idx" ON "media_visibility" USING btree ("contributor_id");--> statement-breakpoint
CREATE INDEX "media_album_visibility_idx" ON "media" USING btree ("album_id","visibility");