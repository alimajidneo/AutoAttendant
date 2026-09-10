CREATE TABLE "notification_reads" (
	"agent_id" uuid NOT NULL,
	"notification_id" text NOT NULL,
	"seen_through" timestamp with time zone NOT NULL,
	CONSTRAINT "notification_reads_agent_id_notification_id_pk" PRIMARY KEY("agent_id","notification_id")
);
--> statement-breakpoint
ALTER TABLE "notification_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_agent_updated_idx" ON "appointments" USING btree ("agent_id","updated_at");