CREATE TABLE "entry_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"uploader_member_id" uuid NOT NULL,
	"original_bytes" integer NOT NULL,
	"original_sha256" text NOT NULL,
	"original_content_type" text NOT NULL,
	"state" text NOT NULL,
	"width" integer,
	"height" integer,
	"revision" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "entry_images_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "entry_images_state_allowed" CHECK ("entry_images"."state" in ('processing', 'ready', 'failed')),
	CONSTRAINT "entry_images_original_bytes_positive" CHECK ("entry_images"."original_bytes" > 0),
	CONSTRAINT "entry_images_size_matches_state" CHECK (("entry_images"."state" = 'ready') = ("entry_images"."width" is not null and "entry_images"."height" is not null))
);
--> statement-breakpoint
ALTER TABLE "entry_images" ADD CONSTRAINT "entry_images_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "entry_images" ADD CONSTRAINT "entry_images_space_id_entry_id_fk" FOREIGN KEY ("space_id","entry_id") REFERENCES "public"."journal_entries"("space_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "entry_images" ADD CONSTRAINT "entry_images_space_id_uploader_member_id_fk" FOREIGN KEY ("space_id","uploader_member_id") REFERENCES "public"."members"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_images_entry_idx" ON "entry_images" USING btree ("space_id","entry_id","created_at");