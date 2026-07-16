CREATE TABLE "album_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"album_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	CONSTRAINT "album_rooms_unique" UNIQUE("album_id","room_id")
);
--> statement-breakpoint
ALTER TABLE "albums" ADD COLUMN "visibility" text DEFAULT 'family' NOT NULL;--> statement-breakpoint
ALTER TABLE "album_rooms" ADD CONSTRAINT "album_rooms_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_rooms" ADD CONSTRAINT "album_rooms_room_id_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "album_rooms_album_idx" ON "album_rooms" USING btree ("album_id");