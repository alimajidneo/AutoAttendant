import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { EmployeeCalendarPolicy, EmployeeDraft } from "@receptionist/shared";
import { db } from "../db/client.js";
import { employees, calendarConnections, workspaces, appointments } from "../db/schema.js";
import { env } from "../env.js";
import { encryptToken, decryptToken } from "../providers/token-encryption.js";

export class EmployeeBookingInProgressError extends Error {
  constructor() {
    super("A booking write is in progress or ambiguous; check Appointments/provider before retrying.");
    this.name = "EmployeeBookingInProgressError";
  }
}

async function assertNoRequestedBooking(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], agentId: string, id: string) {
  const [requested] = await tx.select({ id: appointments.id }).from(appointments).where(and(
    eq(appointments.agentId, agentId), eq(appointments.employeeId, id), eq(appointments.status, "requested"),
  )).limit(1);
  if (requested) throw new EmployeeBookingInProgressError();
}
// Snapshots expose millisecond timestamps; every mutation must advance that visible version.
const nextUpdatedAt = sql`greatest(clock_timestamp(), date_trunc('milliseconds', ${employees.updatedAt}) + interval '1 millisecond')`;

type Employee = typeof employees.$inferSelect;
const scope = (agentId: string, id: string) => and(eq(employees.agentId, agentId), eq(employees.id, id));
const owner = (agentId: string, id: string) => `employee-transfer:${agentId}:${id}`;
function key() {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("Transfer encryption is not configured");
  return env.TOKEN_ENCRYPTION_KEY;
}
function destination(agentId: string, id: string, number: string | null | undefined) {
  if (number === undefined) return {};
  if (number === null) return { encryptedTransferDestination: null, transferDestinationDisplay: null };
  if (!/^\+[1-9]\d{7,14}$/.test(number)) throw new Error("Invalid transfer destination");
  return { encryptedTransferDestination: encryptToken(number, owner(agentId, id), key()), transferDestinationDisplay: `•••• ${number.slice(-4)}` };
}
function view(row: Employee) {
  return { id: row.id, displayName: row.displayName, department: row.department,
    routingEnabled: row.routingEnabled, manualAvailability: row.manualAvailability,
    timezone: row.timezone, workingHours: row.workingHours, calendarPolicy: row.calendarPolicy,
    hasTransferDestination: !!row.encryptedTransferDestination, transferDestinationDisplay: row.transferDestinationDisplay,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
export async function listEmployees(agentId: string, limit = 100, offset = 0) {
  const rows = await db.select().from(employees).where(eq(employees.agentId, agentId))
    .orderBy(employees.displayName, employees.id).limit(Math.max(1, Math.min(100, Math.trunc(limit) || 1)))
    .offset(Math.max(0, Math.min(10000, Math.trunc(offset) || 0)));
  return rows.map(view);
}
export async function createEmployee(agentId: string, input: EmployeeDraft) {
  const id = randomUUID();
  const { transferNumber, ...fields } = input;
  const [row] = await db.insert(employees).values({ ...fields, agentId, id, ...destination(agentId, id, transferNumber) }).returning();
  return view(row!);
}
export async function updateEmployee(agentId: string, id: string, input: Partial<EmployeeDraft>) {
  return db.transaction(async tx => {
    await tx.select({ id: workspaces.agentId }).from(workspaces).where(eq(workspaces.agentId, agentId)).for("update");
    await assertNoRequestedBooking(tx, agentId, id);
    const { transferNumber, ...fields } = input;
    const [row] = await tx.update(employees).set({ ...fields, ...destination(agentId, id, transferNumber), updatedAt: nextUpdatedAt })
      .where(scope(agentId, id)).returning();
    return row ? view(row) : null;
  });
}
export function deactivateEmployee(agentId: string, id: string) {
  return updateEmployee(agentId, id, { routingEnabled: false, manualAvailability: "unavailable" });
}
export async function resolveEmployeeTransferDestination(agentId: string, id: string) {
  const [row] = await db.select({ encrypted: employees.encryptedTransferDestination }).from(employees).where(scope(agentId, id)).limit(1);
  return row?.encrypted ? decryptToken(row.encrypted, owner(agentId, id), key()) : null;
}
export function listEmployeeConnections(agentId: string) {
  return db.select({ id: calendarConnections.id, employeeId: calendarConnections.employeeId,
    provider: calendarConnections.provider, accountEmail: calendarConnections.accountEmail, accountName: calendarConnections.accountName })
    .from(calendarConnections).where(and(eq(calendarConnections.agentId, agentId), inArray(calendarConnections.provider, ["google", "microsoft"])))
    .orderBy(calendarConnections.createdAt, calendarConnections.id).limit(100);
}
export async function assignEmployeeConnection(agentId: string, id: string, connectionId: string, assigned: boolean) {
  return db.transaction(async tx => {
    await tx.select({ id: workspaces.agentId }).from(workspaces).where(eq(workspaces.agentId, agentId)).for("update");
    const [employee] = await tx.select().from(employees).where(scope(agentId, id)).limit(1);
    const [connection] = await tx.select().from(calendarConnections).where(and(eq(calendarConnections.agentId, agentId), eq(calendarConnections.id, connectionId),
      inArray(calendarConnections.provider, ["google", "microsoft"]))).for("update");
    if (!employee || !connection || (connection.employeeId !== null && connection.employeeId !== id) || (!assigned && connection.employeeId !== id)) return false;
    if (!assigned) await assertNoRequestedBooking(tx, agentId, id);
    await tx.update(calendarConnections).set({ employeeId: assigned ? id : null, updatedAt: new Date() })
      .where(and(eq(calendarConnections.agentId, agentId), eq(calendarConnections.id, connectionId)));
    if (!assigned && employee.calendarPolicy.authority === "direct") {
      const policy = employee.calendarPolicy;
      await tx.update(employees).set({ calendarPolicy: { authority: "direct",
        booking: policy.booking?.connectionId === connectionId ? null : policy.booking,
        conflicts: policy.conflicts.filter(ref => ref.connectionId !== connectionId) }, updatedAt: nextUpdatedAt }).where(scope(agentId, id));
    }
    return true;
  });
}
export async function saveEmployeePolicy(agentId: string, id: string, policy: EmployeeCalendarPolicy) {
  return db.transaction(async tx => {
    await tx.select({ id: workspaces.agentId }).from(workspaces).where(eq(workspaces.agentId, agentId)).for("update");
    await assertNoRequestedBooking(tx, agentId, id);
    if (policy.authority === "direct") {
      const refs = [...policy.conflicts, ...(policy.booking ? [policy.booking] : [])];
      const ids = [...new Set(refs.map(ref => ref.connectionId))];
      if (ids.length) {
        const rows = await tx.select({ id: calendarConnections.id }).from(calendarConnections).where(and(
          eq(calendarConnections.agentId, agentId), eq(calendarConnections.employeeId, id),
          inArray(calendarConnections.provider, ["google", "microsoft"]), inArray(calendarConnections.id, ids))).for("update");
        if (rows.length !== ids.length) return null;
      }
    }
    const [row] = await tx.update(employees).set({ calendarPolicy: policy, updatedAt: nextUpdatedAt }).where(scope(agentId, id)).returning();
    return row ? view(row) : null;
  });
}

export async function getEmployee(agentId: string, id: string) {
  const [row] = await db.select().from(employees).where(scope(agentId, id)).limit(1);
  return row ? view(row) : null;
}

export async function lookupEmployees(agentId: string, input: { name?: string; department?: string }) {
  const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  const rows = await db.select({ id: employees.id, name: employees.displayName, department: employees.department,
    calendarAuthority: sql<string>`${employees.calendarPolicy}->>'authority'` }).from(employees).where(and(
      eq(employees.agentId, agentId), eq(employees.routingEnabled, true),
      input.name ? sql`regexp_replace(lower(trim(${employees.displayName})), '\\s+', ' ', 'g') = ${normalized(input.name)}` : undefined,
      input.department ? sql`regexp_replace(lower(trim(${employees.department})), '\\s+', ' ', 'g') = ${normalized(input.department)}` : undefined,
    )).orderBy(employees.displayName, employees.id).limit(10);
  return rows;
}
