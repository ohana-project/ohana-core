CREATE TABLE "members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "members_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "members_role_allowed" CHECK ("members"."role" in ('owner', 'regular'))
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_tombstones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"member_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sync_tombstones_audience_allowed" CHECK ("sync_tombstones"."audience" in ('all', 'member')),
	CONSTRAINT "sync_tombstones_audience_member_consistent" CHECK (("sync_tombstones"."audience" = 'all' and "sync_tombstones"."member_id" is null) or ("sync_tombstones"."audience" = 'member' and "sync_tombstones"."member_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sync_tombstones" ADD CONSTRAINT "sync_tombstones_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sync_tombstones" ADD CONSTRAINT "sync_tombstones_member_space_fk" FOREIGN KEY ("space_id","member_id") REFERENCES "public"."members"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_tombstones_space_revision_idx" ON "sync_tombstones" USING btree ("space_id","revision");