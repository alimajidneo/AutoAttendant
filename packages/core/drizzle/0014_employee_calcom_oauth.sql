CREATE TABLE "calcom_oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"intent" text NOT NULL,
	"starting_connection_id" uuid,
	"starting_provider_user_id" text,
	"starting_lifecycle_generation" bigint,
	"browser_challenge_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calcom_oauth_state_hash_check" CHECK ("calcom_oauth_states"."state_hash" ~ '^[a-f0-9]{64}$' AND "calcom_oauth_states"."browser_challenge_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "calcom_oauth_state_identity_check" CHECK (length("calcom_oauth_states"."user_id") BETWEEN 1 AND 200 AND ("calcom_oauth_states"."starting_provider_user_id" IS NULL OR length("calcom_oauth_states"."starting_provider_user_id") BETWEEN 1 AND 200)),
	CONSTRAINT "calcom_oauth_state_intent_check" CHECK (("calcom_oauth_states"."intent" = 'connect' AND "calcom_oauth_states"."starting_connection_id" IS NULL AND "calcom_oauth_states"."starting_provider_user_id" IS NULL AND "calcom_oauth_states"."starting_lifecycle_generation" IS NULL) OR ("calcom_oauth_states"."intent" = 'reconnect' AND "calcom_oauth_states"."starting_connection_id" IS NOT NULL AND "calcom_oauth_states"."starting_provider_user_id" IS NOT NULL AND "calcom_oauth_states"."starting_lifecycle_generation" > 0))
);
--> statement-breakpoint
ALTER TABLE "calcom_oauth_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calcom_connections" DROP CONSTRAINT "calcom_auth_kind_check";--> statement-breakpoint
ALTER TABLE "calcom_connections" DROP CONSTRAINT "calcom_status_check";--> statement-breakpoint
ALTER TABLE "calcom_connections" ADD COLUMN "credential_version" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "calcom_connections" ADD COLUMN "lifecycle_generation" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "calcom_connections" ADD COLUMN "lifecycle_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calcom_connections" ADD COLUMN "credential_refresh_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calcom_connections" ADD COLUMN "event_type_id" integer;--> statement-breakpoint
ALTER TABLE "calcom_connections" ADD COLUMN "webhook_id" text;--> statement-breakpoint
ALTER TABLE "calcom_connections" ADD COLUMN "destination_calendar_integration" text;--> statement-breakpoint
ALTER TABLE "calcom_connections" ADD COLUMN "destination_calendar_external_id" text;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "calcom_oauth_states" ADD CONSTRAINT "calcom_oauth_states_agent_id_workspaces_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."workspaces"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calcom_oauth_states" ADD CONSTRAINT "calcom_oauth_states_employee_workspace_fk" FOREIGN KEY ("agent_id","employee_id") REFERENCES "public"."employees"("agent_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calcom_oauth_states_expiry_idx" ON "calcom_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "calcom_oauth_states_employee_idx" ON "calcom_oauth_states" USING btree ("agent_id","employee_id");--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_employee_workspace_fk" FOREIGN KEY ("agent_id","employee_id") REFERENCES "public"."employees"("agent_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_employee_unique" UNIQUE("agent_id","employee_id");--> statement-breakpoint
ALTER TABLE "calcom_connections" ADD CONSTRAINT "calcom_versions_check" CHECK ("calcom_connections"."credential_version" > 0 AND "calcom_connections"."lifecycle_generation" > 0);--> statement-breakpoint
ALTER TABLE "calcom_connections" ADD CONSTRAINT "calcom_lease_state_check" CHECK (("calcom_connections"."auth_kind" = 'oauth' OR "calcom_connections"."credential_refresh_lease_expires_at" IS NULL) AND ("calcom_connections"."lifecycle_lease_expires_at" IS NULL OR "calcom_connections"."status" IN ('setup_required', 'disconnecting')));--> statement-breakpoint
ALTER TABLE "calcom_connections" ADD CONSTRAINT "calcom_oauth_setup_check" CHECK ("calcom_connections"."auth_kind" <> 'oauth' OR "calcom_connections"."status" <> 'active' OR ("calcom_connections"."event_type_id" IS NOT NULL AND "calcom_connections"."webhook_id" IS NOT NULL AND "calcom_connections"."destination_calendar_integration" IS NOT NULL AND "calcom_connections"."destination_calendar_external_id" IS NOT NULL AND length("calcom_connections"."destination_calendar_integration") > 0 AND length("calcom_connections"."destination_calendar_external_id") > 0));--> statement-breakpoint
ALTER TABLE "calcom_connections" ADD CONSTRAINT "calcom_auth_kind_check" CHECK ("calcom_connections"."auth_kind" IN ('api_key', 'oauth'));--> statement-breakpoint
ALTER TABLE "calcom_connections" ADD CONSTRAINT "calcom_status_check" CHECK ("calcom_connections"."status" IN ('active', 'setup_required', 'reconnect_required', 'disconnecting'));
