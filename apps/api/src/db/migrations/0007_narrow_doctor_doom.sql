CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"author_member_id" uuid NOT NULL,
	"title" text,
	"text" text NOT NULL,
	"state" text NOT NULL,
	"published_at" timestamp with time zone,
	"revision" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "journal_entries_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "journal_entries_state_allowed" CHECK ("journal_entries"."state" in ('draft', 'published')),
	CONSTRAINT "journal_entries_published_at_matches_state" CHECK (("journal_entries"."state" = 'published' and "journal_entries"."published_at" is not null)
        or ("journal_entries"."state" = 'draft' and "journal_entries"."published_at" is null))
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_space_id_author_member_id_fk" FOREIGN KEY ("space_id","author_member_id") REFERENCES "public"."members"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entries_feed_idx" ON "journal_entries" USING btree ("space_id","state","published_at","id");--> statement-breakpoint
CREATE INDEX "journal_entries_author_idx" ON "journal_entries" USING btree ("space_id","author_member_id");