CREATE TABLE "wishes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"author_member_id" uuid NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"link" text,
	"received_at" timestamp with time zone,
	"revision" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wishes_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "wishes_link_is_http_url" CHECK ("wishes"."link" is null or "wishes"."link" ~ '^https?://[^[:space:]]+$')
);
--> statement-breakpoint
ALTER TABLE "wishes" ADD CONSTRAINT "wishes_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "wishes" ADD CONSTRAINT "wishes_space_id_author_member_id_fk" FOREIGN KEY ("space_id","author_member_id") REFERENCES "public"."members"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wishes_author_idx" ON "wishes" USING btree ("space_id","author_member_id","created_at");--> statement-breakpoint
CREATE INDEX "wishes_sync_idx" ON "wishes" USING btree ("space_id","revision");