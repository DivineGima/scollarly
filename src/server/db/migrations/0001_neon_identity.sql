-- Neon-centred identity (ADR-037, D15). Stage 0 throwaway data only: the self-hosted Better Auth tables and the
-- bytea image table are removed; Neon Auth keeps users and sessions in its own schema, and images move to Neon
-- Object Storage (ADR-039). Nothing here is referenced by real data.
DROP TABLE IF EXISTS "public"."media_blob" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "public"."two_factor" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "public"."verification" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "public"."account" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "public"."session" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "public"."user" CASCADE;
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" text PRIMARY KEY NOT NULL,
	"role" text DEFAULT 'student' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_role_check" CHECK ("app_user"."role" in ('student', 'admin', 'owner'))
);
--> statement-breakpoint
CREATE TABLE "owner_totp" (
	"user_id" text PRIMARY KEY NOT NULL,
	"secret_encrypted" text NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_step" bigint,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recovery_code" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "step_up" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owner_totp" ADD CONSTRAINT "owner_totp_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "step_up" ADD CONSTRAINT "step_up_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_single_owner" ON "app_user" USING btree ("role") WHERE "app_user"."role" = 'owner';
--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_code_user_hash" ON "recovery_code" USING btree ("user_id","code_hash");
