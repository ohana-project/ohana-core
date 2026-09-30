ALTER TABLE "members" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "interface_language" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_interface_language_allowed" CHECK ("members"."interface_language" in ('ru', 'en'));