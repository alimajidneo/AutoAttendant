CREATE TABLE "retell_connections" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"retell_agent_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retell_connections_retell_agent_id_unique" UNIQUE("retell_agent_id")
);
--> statement-breakpoint
ALTER TABLE "retell_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "retell_webhook_receipts" (
	"dedup_key" text PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"event" text NOT NULL,
	"call_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retell_webhook_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "provider" text DEFAULT 'livekit' NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "provider_call_id" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "provider_status" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "disconnection_reason" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "transfer_status" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "cost_cents" double precision;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "retell_agent_id" text;--> statement-breakpoint
ALTER TABLE "retell_connections" ADD CONSTRAINT "retell_connections_agent_id_workspaces_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."workspaces"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retell_webhook_receipts" ADD CONSTRAINT "retell_webhook_receipts_agent_id_workspaces_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."workspaces"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_employee_workspace_fk" FOREIGN KEY ("agent_id","employee_id") REFERENCES "public"."employees"("agent_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calls_retell_provider_call_idx" ON "calls" USING btree ("provider_call_id") WHERE "calls"."provider" = 'retell';--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_employee_interval_check" CHECK ("appointments"."employee_id" IS NULL OR ("appointments"."start_time" IS NOT NULL AND "appointments"."end_time" IS NOT NULL AND "appointments"."end_time" > "appointments"."start_time"));--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_provider_check" CHECK ("calls"."provider" IN ('livekit', 'retell'));--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_retell_privacy_check" CHECK ("calls"."provider" <> 'retell' OR ("calls"."provider_call_id" IS NOT NULL AND "calls"."retell_agent_id" IS NOT NULL AND "calls"."transcript" IS NULL AND "calls"."recording_key" IS NULL AND "calls"."caller_id" IS NULL AND ("calls"."caller_phone" IS NULL OR "calls"."caller_phone" ~ '^•••• [0-9]{4}$')));--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_cost_duration_check" CHECK (("calls"."duration_ms" IS NULL OR "calls"."duration_ms" >= 0) AND ("calls"."cost_cents" IS NULL OR ("calls"."cost_cents" >= 0 AND "calls"."cost_cents" <= 100000000)));--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE appointments ADD CONSTRAINT appointments_employee_no_overlap EXCLUDE USING gist
  (agent_id WITH =, employee_id WITH =, tstzrange(start_time, end_time, '[)') WITH &&)
  WHERE (employee_id IS NOT NULL AND status IN ('requested', 'confirmed'));

--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "transfer_attempt_started_at" bigint;

--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "provider_write_state" text;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_provider_write_state_check"
CHECK (provider_write_state IS NULL OR (employee_id IS NOT NULL AND status = 'requested' AND provider_write_state IN ('in_flight', 'reconciliation_required')));
