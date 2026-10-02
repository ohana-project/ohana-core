CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"creator_member_id" uuid NOT NULL,
	"title" text NOT NULL,
	"all_day" boolean NOT NULL,
	"date" date,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"timezone" text,
	"revision" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "calendar_events_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "calendar_events_all_day_columns_match" CHECK (("calendar_events"."all_day" = ("calendar_events"."date" is not null))
        and ("calendar_events"."all_day" = ("calendar_events"."starts_at" is null))
        and ("calendar_events"."all_day" = ("calendar_events"."timezone" is null))),
	CONSTRAINT "calendar_events_timed_end_after_start" CHECK ("calendar_events"."all_day" or ("calendar_events"."ends_at" is not null and "calendar_events"."starts_at" is not null and "calendar_events"."ends_at" > "calendar_events"."starts_at"))
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_space_id_creator_member_id_fk" FOREIGN KEY ("space_id","creator_member_id") REFERENCES "public"."members"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_events_sync_idx" ON "calendar_events" USING btree ("space_id","revision");