-- pgvector pre diary_embeddings (obraz pgvector/pgvector:pg16 ho obsahuje)
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "diary_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diary_embeddings_entry_id_unique" UNIQUE("entry_id")
);
--> statement-breakpoint
CREATE TABLE "diary_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"body_md" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diary_entries_user_date_unique" UNIQUE("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "diary_fragments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"mood" text,
	"media_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_ref_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diary_embeddings" ADD CONSTRAINT "diary_embeddings_entry_id_diary_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."diary_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_embeddings" ADD CONSTRAINT "diary_embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_fragments" ADD CONSTRAINT "diary_fragments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_fragments" ADD CONSTRAINT "diary_fragments_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diary_embeddings_user_idx" ON "diary_embeddings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "diary_fragments_user_created_idx" ON "diary_fragments" USING btree ("user_id","created_at");