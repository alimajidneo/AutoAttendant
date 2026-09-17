import { getCalcomClient, reconcileCalcomAppointment } from '../repositories/calcom.js';
import { calcomContact, type CalcomClient, type CalcomSchedulingType } from './calcom.js';
import { ProviderWriteRejectedError } from './provider-write-error.js';
import { getEmployee, listEmployeeConnections } from '../repositories/employees.js';
import { reserveEmployeeAppointment, finishEmployeeAppointment, markEmployeeAppointmentReconciliationRequired } from '../repositories/appointments.js';
import { employeeIntervalEligibility } from '../domain/employee-availability.js';
import { getCalendarCredential, type CalendarCredential } from './calendarAccess.js';
import { listProviderCalendars, fetchProviderBusyRanges, createProviderCalendarEvent } from './calendarProvider.js';

type Interval = { employeeId: string; start: string; end: string };
type Decision = { available: boolean; reason: string; eventType?: string | null; bookingUrl?: string | null };
const unknown: Decision = { available: false, reason: 'provider_unknown' };
const MIN_SAFE_WRITE_BUDGET_MS = 15_000;
const MIN_PROVIDER_DISPATCH_BUDGET_MS = 10_000;
async function inspect(agentId: string, input: Interval, snapshot?: Awaited<ReturnType<typeof getEmployee>>, deadlineAt?: number): Promise<{ decision: Decision;
  calcom?: { client: CalcomClient; connectionId: string; eventTypeId: number; eventType: CalcomSchedulingType }; booking?: CalendarCredential & { calendarId: string }; employee?: NonNullable<Awaited<ReturnType<typeof getEmployee>>> }> {
  const employee = snapshot === undefined ? await getEmployee(agentId, input.employeeId) : snapshot;
  const signal = deadlineAt === undefined ? undefined : AbortSignal.timeout(Math.max(1, deadlineAt - Date.now()));
  if (!employee) return { decision: { available: false, reason: 'employee_unavailable' } };
  const start = new Date(input.start), end = new Date(input.end);
  const eligible = employeeIntervalEligibility(employee, start, end);
  if (!eligible.available) return { decision: { available: false, reason: eligible.reason } };
  const policy = employee.calendarPolicy;
  if (policy.authority === 'calcom') {
    if (!policy.connectionId || !policy.eventTypeId) return { decision: { available: false, reason: 'calcom_authority', eventType: policy.eventType, bookingUrl: policy.bookingUrl } };
    const client = await getCalcomClient(agentId, employee.id, policy.connectionId);
    if (!client) return { decision: unknown };
    const eventType = (await client.eventTypes(signal)).find(t => t.id === policy.eventTypeId);
    if (!eventType || eventType.lengthInMinutes * 60000 !== end.getTime() - start.getTime()) return { decision: unknown };
    const slots = await client.slots(policy.eventTypeId, input.start, input.end, employee.timezone, signal);
    const available = slots.some(slot => Date.parse(slot.start) === start.getTime() && Date.parse(slot.end) === end.getTime());
    return { decision: { available, reason: available ? 'available' : 'provider_busy' }, employee,
      calcom: { client, connectionId: policy.connectionId, eventTypeId: policy.eventTypeId, eventType } };
  }
  if (!policy.booking?.connectionId || !policy.booking.calendarId || !policy.conflicts.length || policy.conflicts.length > 50) return { decision: unknown };
  const grouped = new Map<string, Set<string>>();
  for (const ref of [...policy.conflicts, policy.booking]) {
    if (!ref.connectionId || !ref.calendarId) return { decision: unknown };
    const ids = grouped.get(ref.connectionId) ?? new Set<string>();
    ids.add(ref.calendarId); grouped.set(ref.connectionId, ids);
  }
  const assigned = (await listEmployeeConnections(agentId)).filter(row => row.employeeId === employee.id);
  if ([...grouped.keys()].some(id => !assigned.some(row => row.id === id))) return { decision: unknown };
  if (grouped.size > 10 || [...grouped.values()].reduce((n, ids) => n + ids.size, 0) > 50) return { decision: unknown };
  const results = await Promise.all([...grouped].map(async ([connectionId, ids]) => {
    const credential = await getCalendarCredential(agentId, connectionId, employee.id);
    if (!credential?.token) throw new Error('Missing credential');
    const [calendars, ranges] = await Promise.all([
      listProviderCalendars(credential.provider, credential.token, signal),
      fetchProviderBusyRanges(credential.provider, credential.token, [...ids], input.start, input.end, signal),
    ]);
    if ([...ids].some(id => !calendars.some(calendar => calendar.id === id))) throw new Error('Missing calendar');
    const isBooking = connectionId === policy.booking!.connectionId;
    if (isBooking && !calendars.some(calendar => calendar.id === policy.booking!.calendarId && calendar.writable)) throw new Error('Calendar not writable');
    if (!Array.isArray(ranges) || ranges.some(range => !(range.start instanceof Date) || !(range.end instanceof Date)
      || !Number.isFinite(range.start.getTime()) || !Number.isFinite(range.end.getTime()) || range.end <= range.start)) throw new Error('Incomplete calendar result');
    return { busy: ranges.some(range => range.start < end && range.end > start),
      booking: isBooking ? { ...credential, calendarId: policy.booking!.calendarId } : undefined };
  }));
  const booking = results.find(result => result.booking)?.booking;
  const busy = results.some(result => result.busy);
  return { decision: { available: !busy, reason: busy ? 'provider_busy' : 'available' }, booking, employee };
}
export async function checkEmployeeAvailability(agentId: string, input: Interval): Promise<Decision> {
  try { return (await inspect(agentId, input)).decision; } catch { return unknown; }
}
export async function bookEmployeeAppointment(agentId: string, input: Interval & { callerName: string; callerPhone?: string; callerEmail?: string; callerConfirmed?: boolean; purpose?: string }, invocationKey?: string, deadlineAt?: number) {
  try {
    const snapshot = await getEmployee(agentId, input.employeeId);
    if (snapshot?.calendarPolicy.authority === 'direct' && input.callerConfirmed !== true) {
      return { status: 'confirmation_required', reason: 'Ask the caller to explicitly confirm the employee, time, and contact details before booking.' };
    }
    if (snapshot?.calendarPolicy.authority === 'calcom' && snapshot.calendarPolicy.connectionId && snapshot.calendarPolicy.eventTypeId) {
      if (!calcomContact(input.callerEmail, input.callerPhone)) return { status: 'contact_required', reason: 'Ask the caller for a valid email address or international phone number, then confirm the booking details.' };
      if (input.callerConfirmed !== true) return { status: 'confirmation_required', reason: 'Ask the caller to explicitly confirm the employee, time, and contact details before booking.' };
    }
    const { decision, booking, employee, calcom } = await inspect(agentId, input, snapshot, deadlineAt);
    if (decision.reason === 'calcom_authority') return { status: 'use_calcom', eventType: decision.eventType, bookingUrl: decision.bookingUrl };
    if (!decision.available || (!booking && !calcom) || !employee) return { status: decision.reason === 'provider_unknown' ? 'unknown' : 'unavailable' };
    if (deadlineAt !== undefined && deadlineAt - Date.now() < MIN_SAFE_WRITE_BUDGET_MS) return { status: 'unknown' };
    if (calcom) {
      const contact = calcomContact(input.callerEmail, input.callerPhone);
      if (calcom.eventType.bookingFields.some(f => f.required && ((f.slug === 'email' && !contact?.email) || (f.slug === 'attendeePhoneNumber' && !contact?.phoneNumber))))
        return { status: 'contact_required', reason: 'Ask for the contact details required by this event type.' };
    }
    const reservation = await reserveEmployeeAppointment(agentId, { employeeId: employee.id, expectedEmployeeUpdatedAt: employee.updatedAt, callerName: input.callerName,
      callerPhone: calcom ? calcomContact(input.callerEmail, input.callerPhone)?.phoneNumber : input.callerPhone, purpose: input.purpose, startTime: new Date(input.start), endTime: new Date(input.end),
      externalCalendarId: calcom ? `calcom:${calcom.eventTypeId}` : booking!.calendarId, externalCalendarConnectionId: calcom?.connectionId ?? booking!.connectionId }, invocationKey);
    if (!reservation) return { status: 'unavailable' };
    if (deadlineAt !== undefined && deadlineAt - Date.now() < MIN_PROVIDER_DISPATCH_BUDGET_MS) {
      await finishEmployeeAppointment(agentId, reservation.id, null, reservation).catch(() => null);
      return { status: 'unknown' };
    }
    const providerSignal = deadlineAt === undefined ? undefined : AbortSignal.timeout(Math.max(1, deadlineAt - Date.now()));
    // Keep requested on ambiguous writes; freeing this reservation could duplicate an event that actually succeeded.
    let eventId: string;
    try {
      if (calcom) {
        const result = await calcom.client.book({ start: input.start, eventTypeId: calcom.eventTypeId,
          attendee: { name: input.callerName, timeZone: employee.timezone, ...calcomContact(input.callerEmail, input.callerPhone)! },
          metadata: { agentId, employeeId: employee.id, appointmentId: reservation.id } }, providerSignal);
        if (result.status !== 'accepted' || Date.parse(result.end) !== Date.parse(input.end)) throw new Error('Unconfirmed Cal.com booking');
        eventId = result.uid;
      } else eventId = await createProviderCalendarEvent(booking!.provider, booking!.token, booking!.calendarId, {
      summary: `Appointment with ${employee.displayName}`, startIso: input.start, endIso: input.end,
      timezone: employee.timezone, description: 'Booked via DeskRoute',
    }, providerSignal);
    } catch (error) {
      if (error instanceof ProviderWriteRejectedError) {
        try {
          const released = await finishEmployeeAppointment(agentId, reservation.id, null, reservation);
          if (released) return { status: 'unknown' };
        } catch { /* Finalization is uncertain; retain the reservation for inspection. */ }
      }
      await markEmployeeAppointmentReconciliationRequired(agentId, reservation.id);
      if (calcom) await reconcileCalcomAppointment(agentId, reservation.id).catch(() => null);
      return { status: 'unknown' };
    }
    if (typeof eventId === 'string' && eventId.trim()) {
      try {
        const finished = await finishEmployeeAppointment(agentId, reservation.id, eventId, reservation);
        if (finished?.status === 'confirmed') return { status: 'confirmed', appointmentId: reservation.id };
      } catch { /* The provider succeeded but local confirmation is uncertain. */ }
    }
    await markEmployeeAppointmentReconciliationRequired(agentId, reservation.id);
    if (calcom) await reconcileCalcomAppointment(agentId, reservation.id, eventId, { useStoredUid: true }).catch(() => null);
    return { status: 'unknown' };
  } catch { return { status: 'unknown' }; }
}
