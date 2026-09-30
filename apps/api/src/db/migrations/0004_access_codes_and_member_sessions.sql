CREATE TABLE "access_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"issuer_administrator_id" uuid,
	"issuer_member_id" uuid,
	"code_hash" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status_changed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "access_codes_code_hash_key" UNIQUE("code_hash"),
	CONSTRAINT "access_codes_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "access_codes_space_id_issuer_member_id_key" UNIQUE("space_id","issuer_member_id"),
	CONSTRAINT "access_codes_status_allowed" CHECK ("access_codes"."status" in ('issued', 'redeemed', 'expired', 'replaced', 'revoked')),
	CONSTRAINT "access_codes_single_issuer" CHECK (("access_codes"."issuer_administrator_id" is null) <> ("access_codes"."issuer_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "member_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "member_sessions_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "member_sessions_space_id_id_key" UNIQUE("space_id","id")
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_issuer_administrator_id_administrators_id_fk" FOREIGN KEY ("issuer_administrator_id") REFERENCES "public"."administrators"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_space_id_member_id_fk" FOREIGN KEY ("space_id","member_id") REFERENCES "public"."members"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_space_id_issuer_member_id_fk" FOREIGN KEY ("space_id","issuer_member_id") REFERENCES "public"."members"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_sessions" ADD CONSTRAINT "member_sessions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_sessions" ADD CONSTRAINT "member_sessions_space_id_member_id_fk" FOREIGN KEY ("space_id","member_id") REFERENCES "public"."members"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_sessions_expires_at_idx" ON "member_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "member_sessions_member_id_idx" ON "member_sessions" USING btree ("member_id");