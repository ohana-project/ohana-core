CREATE TABLE "calendar_event_reminder_recipients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "calendar_event_reminder_recipients_recipient_key" UNIQUE("space_id","event_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "calendar_event_reminders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"lead_minutes" integer NOT NULL,
	"scheduled_through" timestamp with time zone,
	"everyone" boolean NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "calendar_event_reminders_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "calendar_event_reminders_event_key" UNIQUE("space_id","event_id"),
	CONSTRAINT "calendar_event_reminders_lead_range" CHECK ("calendar_event_reminders"."lead_minutes" between 1 and 43200)
);
--> statement-breakpoint
CREATE TABLE "calendar_reminders_sent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"original_date" date NOT NULL,
	"reminded_at" timestamp with time zone NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "calendar_reminders_sent_occurrence_key" UNIQUE("space_id","event_id","original_date")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"notify_details" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "push_subscriptions_member_endpoint_key" UNIQUE("space_id","member_id","endpoint")
);
--> statement-breakpoint
CREATE TABLE "push_vapid_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "push_vapid_keys_singleton_key" UNIQUE("singleton"),
	CONSTRAINT "push_vapid_keys_singleton_true" CHECK ("push_vapid_keys"."singleton"),
	CONSTRAINT "push_vapid_keys_non_empty" CHECK (length("push_vapid_keys"."public_key") > 0 and length("push_vapid_keys"."private_key") > 0)
);
--> statement-breakpoint
ALTER TABLE "calendar_event_reminder_recipients" ADD CONSTRAINT "calendar_event_reminder_recipients_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "calendar_event_reminder_recipients" ADD CONSTRAINT "calendar_event_reminder_recipients_space_id_event_id_fk" FOREIGN KEY ("space_id","event_id") REFERENCES "public"."calendar_events"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_reminder_recipients" ADD CONSTRAINT "calendar_event_reminder_recipients_space_id_member_id_fk" FOREIGN KEY ("space_id","member_id") REFERENCES "public"."members"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_reminders" ADD CONSTRAINT "calendar_event_reminders_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "calendar_event_reminders" ADD CONSTRAINT "calendar_event_reminders_space_id_event_id_fk" FOREIGN KEY ("space_id","event_id") REFERENCES "public"."calendar_events"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_reminders_sent" ADD CONSTRAINT "calendar_reminders_sent_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "calendar_reminders_sent" ADD CONSTRAINT "calendar_reminders_sent_space_id_event_id_fk" FOREIGN KEY ("space_id","event_id") REFERENCES "public"."calendar_events"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_space_id_member_id_fk" FOREIGN KEY ("space_id","member_id") REFERENCES "public"."members"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_reminders_sent_reminded_idx" ON "calendar_reminders_sent" USING btree ("reminded_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_member_idx" ON "push_subscriptions" USING btree ("space_id","member_id");