ALTER TABLE "appointments" ADD COLUMN "external_calendar_id" text;
--> statement-breakpoint
UPDATE "appointments"
SET "external_calendar_id" = "agents"."calendar_external_id"
FROM "agents"
WHERE "appointments"."agent_id" = "agents"."id"
  AND "appointments"."external_event_id" IS NOT NULL;
