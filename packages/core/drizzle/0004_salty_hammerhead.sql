CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"provider_account_id" text NOT NULL,
	"account_email" text NOT NULL,
	"account_name" text,
	"encrypted_refresh_token" text NOT NULL,
	"encryption_owner" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_connections_agent_provider_account_unique" UNIQUE("agent_id","provider","provider_account_id")
);
--> statement-breakpoint
ALTER TABLE "calendar_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "external_calendar_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "calendar_connections" (
	"agent_id", "provider", "provider_account_id", "account_email",
	"encrypted_refresh_token", "encryption_owner", "updated_at"
)
SELECT a."id", 'google', g."google_subject", u."email",
	g."encrypted_refresh_token", g."auth_user_id", g."updated_at"
FROM "google_credentials" g
JOIN "agents" a ON a."auth_user_id" = g."auth_user_id"
JOIN "auth"."users" u ON u."id"::text = g."auth_user_id"
ON CONFLICT ("agent_id", "provider", "provider_account_id") DO NOTHING;--> statement-breakpoint
UPDATE "agents" a
SET "calendar_payload" = jsonb_set(
	jsonb_set(
		a."calendar_payload",
		'{bookingConnectionId}',
		to_jsonb(c."id"::text),
		true
	),
	'{conflictCalendars}',
	COALESCE((
		SELECT jsonb_agg(jsonb_set(item, '{connectionId}', to_jsonb(c."id"::text), true))
		FROM jsonb_array_elements(COALESCE(a."calendar_payload"->'conflictCalendars', '[]'::jsonb)) item
	), '[]'::jsonb),
	true
)
FROM "calendar_connections" c
WHERE c."agent_id" = a."id"
	AND a."calendar_provider" = 'google'
	AND a."calendar_external_id" IS NOT NULL;--> statement-breakpoint
UPDATE "appointments" ap
SET "external_calendar_connection_id" = c."id"
FROM "calendar_connections" c
WHERE c."agent_id" = ap."agent_id"
	AND ap."external_calendar_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "calendar_connections_agent_idx" ON "calendar_connections" USING btree ("agent_id");
