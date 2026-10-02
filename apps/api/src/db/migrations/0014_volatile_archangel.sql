CREATE TABLE "calendar_event_exceptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"original_date" date NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"all_day" boolean,
	"date" date,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"timezone" text,
	"revision" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "calendar_event_exceptions_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "calendar_event_exceptions_date_key" UNIQUE("space_id","event_id","original_date"),
	CONSTRAINT "calendar_event_exceptions_kind_columns_match" CHECK (("calendar_event_exceptions"."kind" = 'cancelled' and "calendar_event_exceptions"."title" is null and "calendar_event_exceptions"."all_day" is null
            and "calendar_event_exceptions"."date" is null and "calendar_event_exceptions"."starts_at" is null
            and "calendar_event_exceptions"."ends_at" is null and "calendar_event_exceptions"."timezone" is null)
        or ("calendar_event_exceptions"."kind" = 'override' and "calendar_event_exceptions"."title" is not null and "calendar_event_exceptions"."all_day" is not null
            and ("calendar_event_exceptions"."all_day" = ("calendar_event_exceptions"."date" is not null))
            and ("calendar_event_exceptions"."all_day" = ("calendar_event_exceptions"."starts_at" is null))
            and ("calendar_event_exceptions"."all_day" = ("calendar_event_exceptions"."timezone" is null))
            and ("calendar_event_exceptions"."all_day" or ("calendar_event_exceptions"."ends_at" is not null and "calendar_event_exceptions"."starts_at" is not null and "calendar_event_exceptions"."ends_at" > "calendar_event_exceptions"."starts_at"))))
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "rrule" text;--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD CONSTRAINT "calendar_event_exceptions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD CONSTRAINT "calendar_event_exceptions_space_id_event_id_fk" FOREIGN KEY ("space_id","event_id") REFERENCES "public"."calendar_events"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_event_exceptions_event_idx" ON "calendar_event_exceptions" USING btree ("space_id","event_id");--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_rrule_shape" CHECK (("calendar_events"."rrule" is null or "calendar_events"."rrule" ~ ('^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)$|^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(' || chr(59) || 'UNTIL=[0-9]+(T[0-9]+Z)?)?$')));