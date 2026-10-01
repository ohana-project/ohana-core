ALTER TABLE "member_sessions" ADD COLUMN "browser" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_sessions" ADD COLUMN "platform" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_sessions" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
UPDATE "member_sessions" SET "last_used_at" = "created_at";--> statement-breakpoint
ALTER TABLE "member_sessions" ALTER COLUMN "last_used_at" SET NOT NULL;
