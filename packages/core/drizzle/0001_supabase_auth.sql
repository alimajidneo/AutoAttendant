CREATE TABLE "google_credentials" (
	"auth_user_id" text PRIMARY KEY NOT NULL,
	"google_subject" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" RENAME COLUMN "clerk_user_id" TO "auth_user_id";--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT "agents_clerk_user_id_unique";--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_auth_user_id_unique" UNIQUE("auth_user_id");