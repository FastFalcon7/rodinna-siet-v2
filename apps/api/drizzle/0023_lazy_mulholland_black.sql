CREATE TABLE "event_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	CONSTRAINT "event_rooms_unique" UNIQUE("event_id","room_id")
);
--> statement-breakpoint
CREATE TABLE "note_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	CONSTRAINT "note_rooms_unique" UNIQUE("note_id","room_id")
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "visibility" text DEFAULT 'family' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_rooms" ADD CONSTRAINT "event_rooms_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rooms" ADD CONSTRAINT "event_rooms_room_id_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_rooms" ADD CONSTRAINT "note_rooms_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_rooms" ADD CONSTRAINT "note_rooms_room_id_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_rooms_event_idx" ON "event_rooms" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "note_rooms_note_idx" ON "note_rooms" USING btree ("note_id");