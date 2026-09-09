import { and, asc, desc, eq, gt, isNotNull, lte, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { appointments } from "../db/schema.js";
import type { BookingDetail } from "@receptionist/shared";

export type AppointmentRow = typeof appointments.$inferSelect;

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
      externalEventId: appointments.externalEventId,
      externalCalendarId: appointments.externalCalendarId,
      bookingDetails: appointments.bookingDetails,
      createdAt: appointments.createdAt,
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
    .set({ status: "cancelled" })
    .where(and(eq(appointments.id, appointmentId), eq(appointments.agentId, agentId)))
    .returning();
  return rows[0] ?? null;
}

export async function deletePastAppointment(agentId: string, appointmentId: string): Promise<boolean> {
  const rows = await db.delete(appointments).where(and(
    eq(appointments.agentId, agentId), eq(appointments.id, appointmentId),
    lte(appointments.endTime, new Date()),
  )).returning({ id: appointments.id });
  return rows.length > 0;
}
