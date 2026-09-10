CREATE TABLE "transfer_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"room_name" text NOT NULL,
	"caller_identity" text NOT NULL,
	"target_user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "transfer_requests_room_name_unique" UNIQUE("room_name")
);
--> statement-breakpoint
ALTER TABLE "transfer_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workspace_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "workspace_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "workspace_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"agent_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"department" text DEFAULT '' NOT NULL,
	"available" boolean DEFAULT false NOT NULL,
	CONSTRAINT "workspace_members_agent_id_user_id_pk" PRIMARY KEY("agent_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workspaces" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"kind" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_reads" DROP CONSTRAINT "notification_reads_agent_id_notification_id_pk";--> statement-breakpoint
ALTER TABLE "notification_reads" ADD COLUMN "user_id" text;--> statement-breakpoint
UPDATE notification_reads r SET user_id = a.auth_user_id FROM agents a WHERE a.id = r.agent_id;--> statement-breakpoint
ALTER TABLE notification_reads ALTER COLUMN user_id SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_agent_id_user_id_notification_id_pk" PRIMARY KEY("agent_id","user_id","notification_id");--> statement-breakpoint
INSERT INTO workspaces (agent_id, owner_user_id, kind) SELECT id, auth_user_id, 'personal' FROM agents WHERE auth_user_id IS NOT NULL;--> statement-breakpoint
INSERT INTO workspace_members (agent_id, user_id, role) SELECT agent_id, owner_user_id, 'manager' FROM workspaces;--> statement-breakpoint
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_agent_id_workspaces_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."workspaces"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_agent_id_workspaces_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."workspaces"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_agent_id_workspaces_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."workspaces"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transfer_requests_inbox_idx" ON "transfer_requests" USING btree ("agent_id","target_user_id","expires_at");--> statement-breakpoint
CREATE INDEX "workspace_invites_agent_idx" ON "workspace_invites" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");