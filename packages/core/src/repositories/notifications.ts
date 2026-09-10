import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { appointments, calls, escalations, notificationReads } from "../db/schema.js";
import type { NotificationItem, NotificationReadInput } from "@receptionist/shared";

// One bounded feed, derived from existing records rather than a second event log.
function sources(agentId: string) {
  return sql`
    SELECT 'appointment:' || a.id || ':' || a.status::text AS id, a.id AS record_id,
      CASE a.status WHEN 'confirmed' THEN 'booking' WHEN 'cancelled' THEN 'cancellation' ELSE 'request' END AS kind,
      a.service_name AS detail, date_trunc('milliseconds', a.updated_at) AS occurred_at
    FROM ${appointments} a
    WHERE a.agent_id = ${agentId} AND a.updated_at >= now() - interval '30 days'
    UNION ALL
    SELECT 'question:' || e.id, e.id, 'question', left(e.question, 180), date_trunc('milliseconds', e.created_at)
    FROM ${escalations} e
    WHERE e.agent_id = ${agentId} AND e.status = 'pending' AND e.created_at >= now() - interval '30 days'
    UNION ALL
    SELECT 'call:' || c.id, c.id, 'call-error', 'A call ended with an error. Review its details.',
      date_trunc('milliseconds', coalesce(c.ended_at, c.started_at))
    FROM ${calls} c
    WHERE c.agent_id = ${agentId} AND c.outcome = 'error' AND c.started_at >= now() - interval '30 days'
  `;
}

const titles: Record<NotificationItem["kind"], string> = {
  booking: "Appointment booked", cancellation: "Appointment cancelled", request: "Appointment requested",
  question: "Question needs attention", "call-error": "Call needs review",
};

export async function listNotifications(agentId: string, userId: string): Promise<NotificationItem[]> {
  const result = await db.execute<{
    id: string; record_id: string; kind: NotificationItem["kind"]; detail: string; occurred_at: string; read: boolean;
  }>(sql`
    WITH recent AS (SELECT * FROM (${sources(agentId)}) source ORDER BY occurred_at DESC, id DESC LIMIT 50)
    SELECT recent.*, coalesce(r.seen_through >= recent.occurred_at, false) AS read
    FROM recent LEFT JOIN ${notificationReads} r ON r.agent_id = ${agentId} AND r.user_id = ${userId} AND r.notification_id = recent.id
    ORDER BY recent.occurred_at DESC, recent.id DESC
  `);
  return result.rows.map(row => ({
    id: row.id, kind: row.kind, title: titles[row.kind], description: row.detail,
    occurredAt: new Date(row.occurred_at).toISOString(), read: row.read,
    href: row.kind === "question" ? "/escalations" : row.kind === "call-error" ? `/calls/${row.record_id}` : "/appointments",
  }));
}

export async function markNotificationsRead(agentId: string, userId: string, items: NotificationReadInput[]) {
  if (!items.length) return;
  const unique = [...new Map(items.map(item => [item.id, item])).values()];
  const requested = sql.join(unique.map(item => sql`(${item.id}::text, ${item.occurredAt}::timestamptz)`), sql`, `);
  // Match the displayed version; an event changing during this request stays unread.
  await db.execute(sql`
    WITH source AS (${sources(agentId)}), requested(id, occurred_at) AS (VALUES ${requested})
    INSERT INTO ${notificationReads} (agent_id, user_id, notification_id, seen_through)
    SELECT ${agentId}::uuid, ${userId}, s.id, s.occurred_at FROM source s
    JOIN requested r ON r.id = s.id AND r.occurred_at = s.occurred_at
    ON CONFLICT (agent_id, user_id, notification_id) DO UPDATE
      SET seen_through = greatest(notification_reads.seen_through, excluded.seen_through)
  `);
}
