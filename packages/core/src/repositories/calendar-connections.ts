import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { calendarConnections, workspaceMembers, workspaces } from "../db/schema.js";
import type { CalendarProvider } from "@receptionist/shared";

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

export class CalendarConnectionOwnedByAnotherEmployee extends Error {}

export async function saveCalendarConnection(input: {
  id: string;
  agentId: string;
  employeeId?: string;
  memberUserId?: string;
  providerAccountId: string;
  accountEmail: string;
  accountName: string | null;
  encryptedRefreshToken: string;
  encryptionOwner: string;
  provider: CalendarProvider;
}) {
  const { memberUserId, ...values } = input;
  return db.transaction(async tx => {
    await tx.select({ id: workspaces.agentId }).from(workspaces)
      .where(eq(workspaces.agentId, values.agentId)).for("update");
    if (memberUserId) {
      if (!values.employeeId) throw new CalendarConnectionOwnedByAnotherEmployee("Employee authorization is required");
      const [linked] = await tx.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(
        eq(workspaceMembers.agentId, values.agentId),
        eq(workspaceMembers.userId, memberUserId),
        eq(workspaceMembers.employeeId, values.employeeId),
      )).limit(1);
      if (!linked) throw new CalendarConnectionOwnedByAnotherEmployee("The member is no longer linked to that employee");
    }
    const [existing] = await tx.select().from(calendarConnections).where(and(
      eq(calendarConnections.agentId, values.agentId),
      eq(calendarConnections.provider, values.provider),
      eq(calendarConnections.providerAccountId, values.providerAccountId),
    )).for("update");
    if (existing) {
      if (values.employeeId && existing.employeeId && existing.employeeId !== values.employeeId) {
        throw new CalendarConnectionOwnedByAnotherEmployee("That calendar account belongs to another employee");
      }
      const [row] = await tx.update(calendarConnections).set({
        employeeId: values.employeeId ?? existing.employeeId,
        accountEmail: values.accountEmail,
        accountName: values.accountName,
        encryptedRefreshToken: values.encryptedRefreshToken,
        encryptionOwner: values.encryptionOwner,
        updatedAt: new Date(),
      }).where(eq(calendarConnections.id, existing.id)).returning();
      return row!;
    }
    const [row] = await tx.insert(calendarConnections).values({ ...values, employeeId: values.employeeId ?? null }).returning();
    return row!;
  });
}

export async function deleteCalendarConnection(agentId: string, id: string) {
  return db.transaction(async tx => {
    await tx.select({ id: workspaces.agentId }).from(workspaces).where(eq(workspaces.agentId, agentId)).for('update');
    const where = and(eq(calendarConnections.agentId, agentId), eq(calendarConnections.id, id));
    const [row] = await tx.select({ employeeId: calendarConnections.employeeId }).from(calendarConnections).where(where).for('update');
    if (row?.employeeId) return false;
    await tx.delete(calendarConnections).where(where);
    return true;
  });
}

export async function updateCalendarConnectionCredential(
  agentId: string,
  id: string,
  encryptedRefreshToken: string,
  encryptionOwner: string,
) {
  const [row] = await db.update(calendarConnections).set({
    encryptedRefreshToken,
    encryptionOwner,
    updatedAt: new Date(),
  }).where(and(
    eq(calendarConnections.agentId, agentId),
    eq(calendarConnections.id, id),
  )).returning();
  return row ?? null;
}
