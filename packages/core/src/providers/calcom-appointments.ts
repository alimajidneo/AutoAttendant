import { getCalcomClient } from '../repositories/calcom.js';
import type { AppointmentRow } from '../repositories/appointments.js';
export function isCalcomAppointment(row: Pick<AppointmentRow, 'externalCalendarId'>) { return row.externalCalendarId?.startsWith('calcom:') ?? false; }
export async function readCalcomAppointment(agentId: string, row: AppointmentRow) {
 if (!row.employeeId || !row.externalCalendarConnectionId || !row.externalEventId || !isCalcomAppointment(row)) throw new Error('Cal.com appointment unavailable');
 const client = await getCalcomClient(agentId, row.employeeId, row.externalCalendarConnectionId);
 if (!client) throw new Error('Cal.com connection unavailable');
 const booking = await client.get(row.externalEventId);
 if (`calcom:${booking.eventType?.id ?? booking.eventTypeId}` !== row.externalCalendarId || booking.metadata?.appointmentId !== row.id
  || booking.metadata?.agentId !== agentId || booking.metadata?.employeeId !== row.employeeId) throw new Error('Cal.com booking identity mismatch');
 return { client, booking };
}
export async function cancelCalcomAppointment(agentId: string, row: AppointmentRow) {
 const { client, booking } = await readCalcomAppointment(agentId, row);
 if (booking.status === 'cancelled' || booking.status === 'rejected') return;
 await client.cancel(booking.uid);
}
