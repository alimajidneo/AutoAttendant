CREATE TABLE "calcom_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"auth_kind" text DEFAULT 'api_key' NOT NULL,
	"encrypted_credential" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"account_email" text NOT NULL,
	"display_label" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calcom_employee_unique" UNIQUE("agent_id","employee_id"),
	CONSTRAINT "calcom_provider_identity_unique" UNIQUE("agent_id","provider_user_id"),
	CONSTRAINT "calcom_agent_id_unique" UNIQUE("agent_id","id"),
	CONSTRAINT "calcom_auth_kind_check" CHECK ("calcom_connections"."auth_kind" IN ('api_key')),
	CONSTRAINT "calcom_status_check" CHECK ("calcom_connections"."status" IN ('active', 'reconnect_required'))
);
--> statement-breakpoint
ALTER TABLE "calcom_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "calcom_webhook_receipts" (
	"connection_id" uuid NOT NULL,
	"digest" text NOT NULL,
	"booking_uid" text NOT NULL,
	"event_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calcom_webhook_receipts_connection_id_digest_pk" PRIMARY KEY("connection_id","digest")
);
--> statement-breakpoint
ALTER TABLE "calcom_webhook_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calcom_connections" ADD CONSTRAINT "calcom_connections_agent_id_workspaces_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."workspaces"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calcom_connections" ADD CONSTRAINT "calcom_employee_workspace_fk" FOREIGN KEY ("agent_id","employee_id") REFERENCES "public"."employees"("agent_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calcom_webhook_receipts" ADD CONSTRAINT "calcom_webhook_receipts_connection_id_calcom_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calcom_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calcom_receipts_connection_time_idx" ON "calcom_webhook_receipts" USING btree ("connection_id","created_at");--> statement-breakpoint
CREATE INDEX "calcom_receipts_time_idx" ON "calcom_webhook_receipts" USING btree ("created_at");