CREATE TABLE "retell_function_invocations" (
	"key" text PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"call_id" text NOT NULL,
	"name" text NOT NULL,
	"semantic_hash" text NOT NULL,
	"state" text DEFAULT 'processing' NOT NULL,
	"result" jsonb,
	"appointment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retell_invocation_state_check" CHECK ("retell_function_invocations"."state" IN ('processing', 'completed', 'uncertain')),
	CONSTRAINT "retell_invocation_result_check" CHECK (("retell_function_invocations"."state" = 'completed') = ("retell_function_invocations"."result" IS NOT NULL) AND ("retell_function_invocations"."result" IS NULL OR (jsonb_typeof("retell_function_invocations"."result") = 'object' AND octet_length("retell_function_invocations"."result"::text) <= 8192))),
	CONSTRAINT "retell_invocation_identity_check" CHECK ("retell_function_invocations"."key" ~ '^[a-f0-9]{64}$' AND "retell_function_invocations"."semantic_hash" ~ '^[a-f0-9]{64}$' AND length("retell_function_invocations"."call_id") BETWEEN 1 AND 200 AND "retell_function_invocations"."name" IN ('book-appointment', 'save-message'))
);
--> statement-breakpoint
ALTER TABLE "retell_function_invocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "retell_function_invocations" ADD CONSTRAINT "retell_function_invocations_agent_id_workspaces_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."workspaces"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retell_function_invocations" ADD CONSTRAINT "retell_function_invocations_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retell_invocation_recovery_idx" ON "retell_function_invocations" USING btree ("agent_id","state","updated_at");