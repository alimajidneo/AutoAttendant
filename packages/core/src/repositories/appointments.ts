import { retellFunctionInvocations } from '../db/schema.js';
import { getTableColumns, sql, and, asc, desc, eq, gt, isNotNull, isNull, lt, lte, ne, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { appointments, employees, workspaces } from "../db/schema.js";
import type { BookingDetail } from "@receptionist/shared";

export type AppointmentRow = typeof appointments.$inferSelect;
export class PriorCallBookingError extends Error {}

type CreateAppointmentInput = {
  agentId: string;
  callerId: string | null;
  callerPhone: string | null;
  /** Independent of `callers.name`: an anonymous caller has no row to hang it on. */
  callerName?: string | null;
  /** The service record this was booked against; null if it is since deleted. */
  serviceId?: string | null;
  serviceName: string;
  startTime: Date;
  endTime: Date;
  status: "requested" | "confirmed" | "cancelled";
  externalEventId?: string;
  externalCalendarId?: string;
  externalCalendarConnectionId?: string;
  bookingDetails?: BookingDetail[];
};

export async function createAppointment(input: CreateAppointmentInput): Promise<AppointmentRow> {
  const rows = await db
    .insert(appointments)
    .values({
      agentId: input.agentId,
      callerId: input.callerId,
      callerPhone: input.callerPhone,
      callerName: input.callerName ?? null,
      serviceId: input.serviceId ?? null,
      serviceName: input.serviceName,
      startTime: input.startTime,
      endTime: input.endTime,
      status: input.status,
      externalEventId: input.externalEventId ?? null,
      externalCalendarId: input.externalCalendarId ?? null,
      externalCalendarConnectionId: input.externalCalendarConnectionId ?? null,
      bookingDetails: input.bookingDetails ?? [],
    })
    .returning();
  return rows[0];
}

export async function getAppointmentById(
  appointmentId: string,
  agentId: string,
): Promise<AppointmentRow | null> {
  const rows = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.agentId, agentId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listConfirmedAppointmentsForSync(agentId: string): Promise<AppointmentRow[]> {
  return db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.agentId, agentId),
        eq(appointments.status, "confirmed"),
        isNotNull(appointments.externalEventId),
        isNotNull(appointments.externalCalendarId),
        gt(appointments.endTime, new Date()),
      ),
    )
    .orderBy(asc(appointments.startTime))
    .limit(100);
}

export async function listAppointments(agentId: string) {
  return db
    .select({
      id: appointments.id,
      callerPhone: appointments.callerPhone,
      callerName: appointments.callerName,
      service: appointments.serviceName,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      status: appointments.status,
      providerWriteState: appointments.providerWriteState,
      externalEventId: appointments.externalEventId,
      externalCalendarId: appointments.externalCalendarId,
      bookingDetails: appointments.bookingDetails,
      createdAt: appointments.createdAt,
      updatedAt: appointments.updatedAt,
    })
    .from(appointments)
    .where(eq(appointments.agentId, agentId))
    .orderBy(desc(appointments.startTime))
    .limit(100);
}

/** Non-null by design: querying with a placeholder reads one caller's
 *  appointments to another. */
export async function getUpcomingByPhone(agentId: string, callerPhone: string) {
  return db
    .select({
      id: appointments.id,
      service: appointments.serviceName,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      status: appointments.status,
      externalEventId: appointments.externalEventId,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.agentId, agentId),
        eq(appointments.callerPhone, callerPhone),
        gt(appointments.startTime, new Date()),
        ne(appointments.status, "cancelled")
      )
    )
    .orderBy(asc(appointments.startTime))
    .limit(10);
}

export async function cancelAppointmentById(
  appointmentId: string,
  agentId: string
): Promise<AppointmentRow | null> {
  const rows = await db
    .update(appointments)
    .set({ status: "cancelled", providerWriteState: null, updatedAt: new Date() })
    .where(and(eq(appointments.id, appointmentId), eq(appointments.agentId, agentId),
      or(isNull(appointments.employeeId), ne(appointments.status, "requested"))))
    .returning();
  return rows[0] ?? null;
}

export async function deletePastAppointment(agentId: string, appointmentId: string): Promise<boolean> {
  const rows = await db.delete(appointments).where(and(
    eq(appointments.agentId, agentId), eq(appointments.id, appointmentId),
    lte(appointments.endTime, new Date()),
    or(isNull(appointments.employeeId), ne(appointments.status, "requested")),
  )).returning({ id: appointments.id });
  return rows.length > 0;
}

export async function reserveEmployeeAppointment(agentId: string, input: {
  employeeId: string; expectedEmployeeUpdatedAt: string; callerName: string; callerPhone?: string; purpose?: string;
  startTime: Date; endTime: Date; externalCalendarId: string; externalCalendarConnectionId: string | null;
}, invocationKey?: string) {
  try {
    return await db.transaction(async tx => {
      // Claim exists before read-only inspection. Intent/link and the uncertain network
      // checkpoint commit together; no provider write may precede this transaction.
      let invocationCallId: string | undefined;
      if (invocationKey) {
        const [invocation] = await tx.select().from(retellFunctionInvocations).where(and(
          eq(retellFunctionInvocations.key, invocationKey), eq(retellFunctionInvocations.agentId, agentId),
          eq(retellFunctionInvocations.state, 'processing'))).for('update');
        if (!invocation) return null;
        invocationCallId = invocation.callId;
      }
      // Serialize snapshot validation and reservation with employee mutations, never provider I/O.
      await tx.select({ id: workspaces.agentId }).from(workspaces).where(eq(workspaces.agentId, agentId)).for("update");
      if (invocationKey && invocationCallId) {
        const [prior] = await tx.select({ id: appointments.id }).from(retellFunctionInvocations)
          .innerJoin(appointments, eq(appointments.id, retellFunctionInvocations.appointmentId))
          .where(and(eq(retellFunctionInvocations.agentId, agentId), eq(retellFunctionInvocations.callId, invocationCallId),
            eq(retellFunctionInvocations.name, 'book-appointment'), ne(retellFunctionInvocations.key, invocationKey),
            or(eq(appointments.status, 'requested'), eq(appointments.status, 'confirmed')))).limit(1);
        if (prior) throw new PriorCallBookingError();
      }
      const [employee] = await tx.select({ updatedAt: employees.updatedAt }).from(employees)
        .where(and(eq(employees.agentId, agentId), eq(employees.id, input.employeeId))).limit(1);
      if (!employee || employee.updatedAt.toISOString() !== input.expectedEmployeeUpdatedAt) return null;
      const { purpose, expectedEmployeeUpdatedAt: _expectedEmployeeUpdatedAt, ...fields } = input;
      const [row] = await tx.insert(appointments).values({ ...fields, agentId, serviceName: purpose ?? 'Employee appointment', status: 'requested', providerWriteState: 'in_flight' }).returning({ ...getTableColumns(appointments), revision: sql<string>`xmin::text` });
      if (invocationKey) await tx.update(retellFunctionInvocations).set({
        appointmentId: row!.id, state: 'uncertain', updatedAt: new Date(),
      }).where(eq(retellFunctionInvocations.key, invocationKey));
      return row!;
    });
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === '23P01') return null;
    throw error;
  }
}
// Compare all booking identity/state fields read before provider I/O.
export function appointmentSnapshotMatches(row: AppointmentRow & { revision?: string }) {
 return and(eq(appointments.status, row.status), row.revision ? sql`xmin::text = ${row.revision}` : undefined,
  sql`${appointments.employeeId} IS NOT DISTINCT FROM ${row.employeeId}::uuid`,
  sql`${appointments.externalCalendarConnectionId} IS NOT DISTINCT FROM ${row.externalCalendarConnectionId}::uuid`,
  sql`${appointments.externalCalendarId} IS NOT DISTINCT FROM ${row.externalCalendarId}`,
  sql`${appointments.externalEventId} IS NOT DISTINCT FROM ${row.externalEventId}`,
  sql`${appointments.providerWriteState} IS NOT DISTINCT FROM ${row.providerWriteState}`,
  sql`${appointments.startTime} IS NOT DISTINCT FROM ${row.startTime?.toISOString() ?? null}::timestamptz`,
  sql`${appointments.endTime} IS NOT DISTINCT FROM ${row.endTime?.toISOString() ?? null}::timestamptz`,
  sql`date_trunc('milliseconds', ${appointments.updatedAt}) = ${row.updatedAt.toISOString()}::timestamptz`);
}
export async function finishEmployeeAppointment(agentId: string, id: string, externalEventId: string | null, expected?: AppointmentRow & { revision?: string }) {
  const [row] = await db.update(appointments).set({ status: externalEventId ? 'confirmed' : 'cancelled', externalEventId, providerWriteState: null, updatedAt: new Date() })
    .where(and(eq(appointments.agentId, agentId), eq(appointments.id, id), eq(appointments.status, 'requested'), isNotNull(appointments.employeeId),
      eq(appointments.providerWriteState, 'in_flight'), isNull(appointments.externalEventId), expected ? appointmentSnapshotMatches(expected) : undefined)).returning();
  return row ?? null;
}


// A stalled process must not free a possibly successful write automatically.
// Managers may attest absence after 24 hours; elapsed time alone never releases it.
const STALE_PROVIDER_WRITE_MS = 24 * 60 * 60 * 1000;

export async function markEmployeeAppointmentReconciliationRequired(agentId: string, id: string) {
  await db.update(appointments).set({ providerWriteState: 'reconciliation_required', updatedAt: new Date() })
    .where(and(eq(appointments.agentId, agentId), eq(appointments.id, id),
      isNotNull(appointments.employeeId), eq(appointments.status, 'requested')));
}

export async function reconcileEmployeeAppointmentNotCreated(agentId: string, id: string) {
  const now = new Date();
  const [row] = await db.update(appointments)
    .set({ status: 'cancelled', providerWriteState: null, updatedAt: now })
    .where(and(eq(appointments.agentId, agentId), eq(appointments.id, id),
      isNotNull(appointments.employeeId), eq(appointments.status, 'requested'),
      isNull(appointments.externalEventId),
      or(eq(appointments.providerWriteState, 'reconciliation_required'),
        and(eq(appointments.providerWriteState, 'in_flight'),
          lt(appointments.updatedAt, new Date(now.getTime() - STALE_PROVIDER_WRITE_MS))))))
    .returning();
  return row ?? null;
}
