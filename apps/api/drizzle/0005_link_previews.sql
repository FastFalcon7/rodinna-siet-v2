CREATE TABLE "link_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url_hash" text NOT NULL,
	"url" text NOT NULL,
	"ok" boolean DEFAULT false NOT NULL,
	"title" text,
	"description" text,
	"site_name" text,
	"image_media_id" uuid,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_previews_url_hash_unique" UNIQUE("url_hash")
);
--> statement-breakpoint
ALTER TABLE "link_previews" ADD CONSTRAINT "link_previews_image_media_id_media_id_fk" FOREIGN KEY ("image_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;