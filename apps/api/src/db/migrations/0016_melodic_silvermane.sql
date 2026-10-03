ALTER TABLE "members" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "private_state_purged_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "members_purge_idx" ON "members" USING btree ("archived_at") WHERE "members"."private_state_purged_at" is null and "members"."archived_at" is not null;