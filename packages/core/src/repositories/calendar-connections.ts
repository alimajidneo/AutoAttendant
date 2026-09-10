import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { calendarConnections } from "../db/schema.js";

export type CalendarConnectionRow = typeof calendarConnections.$inferSelect;

export function listCalendarConnections(agentId: string) {
  return db.select().from(calendarConnections)
    .where(eq(calendarConnections.agentId, agentId))
    .orderBy(calendarConnections.createdAt, calendarConnections.id);
}

export async function getCalendarConnection(agentId: string, id: string) {
  const [row] = await db.select().from(calendarConnections).where(and(
    eq(calendarConnections.agentId, agentId),
    eq(calendarConnections.id, id),
  )).limit(1);
  return row ?? null;
}

export async function saveCalendarConnection(input: {
  id: string;
  agentId: string;
  providerAccountId: string;
  accountEmail: string;
  accountName: string | null;
  encryptedRefreshToken: string;
  encryptionOwner: string;
}) {
  const values = { ...input, provider: "google" as const, updatedAt: new Date() };
  const [row] = await db.insert(calendarConnections).values(values)
    .onConflictDoUpdate({
      target: [calendarConnections.agentId, calendarConnections.provider, calendarConnections.providerAccountId],
      set: {
        accountEmail: values.accountEmail,
        accountName: values.accountName,
        encryptedRefreshToken: values.encryptedRefreshToken,
        encryptionOwner: values.encryptionOwner,
        updatedAt: values.updatedAt,
      },
    }).returning();
  return row!;
}

export async function deleteCalendarConnection(agentId: string, id: string) {
  await db.delete(calendarConnections).where(and(
    eq(calendarConnections.agentId, agentId),
    eq(calendarConnections.id, id),
  ));
}
