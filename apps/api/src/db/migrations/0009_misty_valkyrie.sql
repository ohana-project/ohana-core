CREATE TABLE "instance_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"trash_retention_days" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "instance_settings_singleton_key" UNIQUE("singleton"),
	CONSTRAINT "instance_settings_singleton_true" CHECK ("instance_settings"."singleton"),
	CONSTRAINT "instance_settings_trash_retention_days_allowed" CHECK ("instance_settings"."trash_retention_days" between 1 and 365)
);
--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_state_allowed";--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_published_at_matches_state";--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "trashed_from_state" text;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "trashed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "journal_entries_trash_idx" ON "journal_entries" USING btree ("space_id","state","trashed_at");--> statement-breakpoint
CREATE INDEX "journal_entries_purge_idx" ON "journal_entries" USING btree ("state","trashed_at");--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_trashed_from_state_allowed" CHECK ("journal_entries"."trashed_from_state" in ('draft', 'published'));--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_trash_columns_match_state" CHECK (("journal_entries"."state" = 'trashed') = ("journal_entries"."trashed_at" is not null)
        and ("journal_entries"."state" = 'trashed') = ("journal_entries"."trashed_from_state" is not null));--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_state_allowed" CHECK ("journal_entries"."state" in ('draft', 'published', 'trashed'));--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_published_at_matches_state" CHECK (("journal_entries"."state" = 'published' and "journal_entries"."published_at" is not null)
        or ("journal_entries"."state" = 'draft' and "journal_entries"."published_at" is null)
        or ("journal_entries"."state" = 'trashed'
            and "journal_entries"."trashed_from_state" is not null
            and "journal_entries"."trashed_at" is not null
            and (("journal_entries"."trashed_from_state" = 'published' and "journal_entries"."published_at" is not null)
              or ("journal_entries"."trashed_from_state" = 'draft' and "journal_entries"."published_at" is null))));