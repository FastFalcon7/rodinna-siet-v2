CREATE TABLE "feed_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "feed_cards_entity_unique" UNIQUE("module","entity_id")
);
--> statement-breakpoint
ALTER TABLE "feed_cards" ADD CONSTRAINT "feed_cards_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feed_cards_created_idx" ON "feed_cards" USING btree ("created_at");