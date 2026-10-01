ALTER TABLE "spaces" ADD COLUMN "journal_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "calendar_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "wishlist_visible" boolean DEFAULT true NOT NULL;