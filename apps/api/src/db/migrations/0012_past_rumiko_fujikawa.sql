CREATE TABLE "gift_favorites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"wish_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gift_favorites_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "gift_favorites_member_wish_key" UNIQUE("space_id","member_id","wish_id")
);
--> statement-breakpoint
CREATE TABLE "gift_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"wish_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gift_reservations_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "gift_reservations_wish_key" UNIQUE("space_id","wish_id")
);
--> statement-breakpoint
ALTER TABLE "gift_favorites" ADD CONSTRAINT "gift_favorites_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "gift_favorites" ADD CONSTRAINT "gift_favorites_space_id_member_id_fk" FOREIGN KEY ("space_id","member_id") REFERENCES "public"."members"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_favorites" ADD CONSTRAINT "gift_favorites_space_id_wish_id_fk" FOREIGN KEY ("space_id","wish_id") REFERENCES "public"."wishes"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_reservations" ADD CONSTRAINT "gift_reservations_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "gift_reservations" ADD CONSTRAINT "gift_reservations_space_id_member_id_fk" FOREIGN KEY ("space_id","member_id") REFERENCES "public"."members"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_reservations" ADD CONSTRAINT "gift_reservations_space_id_wish_id_fk" FOREIGN KEY ("space_id","wish_id") REFERENCES "public"."wishes"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gift_favorites_member_idx" ON "gift_favorites" USING btree ("space_id","member_id","created_at");--> statement-breakpoint
CREATE INDEX "gift_favorites_wish_idx" ON "gift_favorites" USING btree ("space_id","wish_id");--> statement-breakpoint
CREATE INDEX "gift_favorites_sync_idx" ON "gift_favorites" USING btree ("space_id","revision");--> statement-breakpoint
CREATE INDEX "gift_reservations_sync_idx" ON "gift_reservations" USING btree ("space_id","revision");