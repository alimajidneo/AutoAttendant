CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"department" text,
	"routing_enabled" boolean DEFAULT false NOT NULL,
	"manual_availability" text DEFAULT 'unknown' NOT NULL,
	"timezone" text NOT NULL,
	"working_hours" jsonb DEFAULT '{"weekly":{"mon":[{"start":"09:00","end":"17:00"}],"tue":[{"start":"09:00","end":"17:00"}],"wed":[{"start":"09:00","end":"17:00"}],"thu":[{"start":"09:00","end":"17:00"}],"fri":[{"start":"09:00","end":"17:00"}],"sat":[],"sun":[]},"exceptions":[]}'::jsonb NOT NULL,
	"encrypted_transfer_destination" text,
	"transfer_destination_display" text,
	"calendar_policy" jsonb DEFAULT '{"authority":"direct","booking":null,"conflicts":[]}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_agent_id_unique" UNIQUE("agent_id","id")
);
--> statement-breakpoint
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_agent_id_workspaces_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."workspaces"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employees_agent_name_idx" ON "employees" USING btree ("agent_id","display_name","id");--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_employee_workspace_fk" FOREIGN KEY ("agent_id","employee_id") REFERENCES "public"."employees"("agent_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_connections_employee_idx" ON "calendar_connections" USING btree ("agent_id","employee_id");