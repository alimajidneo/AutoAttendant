import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_BUSINESS_HOURS } from '@receptionist/shared';
const m = vi.hoisted(() => ({ getEmployee: vi.fn(), listEmployeeConnections: vi.fn(), getCalendarCredential: vi.fn(), listProviderCalendars: vi.fn(), fetchProviderBusyRanges: vi.fn(), createProviderCalendarEvent: vi.fn(), reserveEmployeeAppointment: vi.fn(), finishEmployeeAppointment: vi.fn(), reconcileCalcomAppointment: vi.fn().mockResolvedValue(null), markEmployeeAppointmentReconciliationRequired: vi.fn() }));
vi.mock('../repositories/employees.js', () => m);
vi.mock('./calendarAccess.js', () => m);
vi.mock('./calendarProvider.js', () => m);
vi.mock('../repositories/appointments.js', () => m);
import { checkEmployeeAvailability, bookEmployeeAppointment } from './employee-calendar.js';
const input = { employeeId: 'employee', start: '2026-09-14T10:00:00Z', end: '2026-09-14T11:00:00Z' };
const employee = { updatedAt: '2026-09-13T10:00:00.000Z', id: 'employee', displayName: 'Sam', routingEnabled: true, manualAvailability: 'available', timezone: 'UTC', workingHours: DEFAULT_BUSINESS_HOURS,
  calendarPolicy: { authority: 'direct', booking: { connectionId: 'a', calendarId: 'book' }, conflicts: [{ connectionId: 'a', calendarId: 'private' }, { connectionId: 'a', calendarId: 'book' }, { connectionId: 'b', calendarId: 'work' }] } };
beforeEach(() => {
  vi.resetAllMocks(); m.getEmployee.mockResolvedValue(structuredClone(employee));
  m.listEmployeeConnections.mockResolvedValue([{ id: 'a', employeeId: 'employee', provider: 'google' }, { id: 'b', employeeId: 'employee', provider: 'microsoft' }]);
  m.getCalendarCredential.mockImplementation(async (_a, id) => ({ connectionId: id, provider: id === 'a' ? 'google' : 'microsoft', token: 'SECRET' }));
  m.listProviderCalendars.mockResolvedValue([{ id: 'book', writable: true }, { id: 'private', writable: false }, { id: 'work', writable: true }]);
  m.fetchProviderBusyRanges.mockResolvedValue([]);
  m.reserveEmployeeAppointment.mockResolvedValue({ id: 'reservation' });
  m.createProviderCalendarEvent.mockResolvedValue('event');
  m.finishEmployeeAppointment.mockResolvedValue({ status: 'confirmed' });
});
it('groups and deduplicates selected calendars, checks once per connection and returns no private data', async () => {
  const result = await checkEmployeeAvailability('workspace', input);
  expect(result).toEqual({ available: true, reason: 'available' });
  expect(m.getCalendarCredential).toHaveBeenCalledTimes(2);
  expect(m.fetchProviderBusyRanges).toHaveBeenCalledTimes(2);
  expect(m.fetchProviderBusyRanges).toHaveBeenCalledWith('google', 'SECRET', ['private', 'book'], input.start, input.end, undefined);
  expect(JSON.stringify(result)).not.toMatch(/SECRET|private|token/);
});
it.each([
  { start: '2026-09-14T16:59:00Z', end: '2026-09-14T17:04:00Z' },
  { start: '2026-09-14T23:00:00Z', end: '2026-09-15T01:00:00Z' },
])('checks the whole interval before providers %j', async range => {
  expect(await checkEmployeeAvailability('workspace', { ...input, ...range })).toMatchObject({ available: false, reason: 'outside_hours' });
  expect(m.getCalendarCredential).not.toHaveBeenCalled();
});
it('rejects an interval crossing a working-hours gap', async () => {
  const copy = structuredClone(employee); copy.workingHours.weekly.mon = [{ start: '09:00', end: '10:30' }, { start: '10:45', end: '17:00' }];
  m.getEmployee.mockResolvedValue(copy);
  expect(await checkEmployeeAvailability('workspace', input)).toMatchObject({ reason: 'outside_hours' });
});
it.each(['token', 'foreign', 'reference', 'readonly', 'provider', 'partial', 'empty-conflicts', 'missing-booking'])('fails closed for %s', async failure => {
  if (failure === 'token') m.getCalendarCredential.mockResolvedValue(null);
  if (failure === 'foreign') m.listEmployeeConnections.mockResolvedValue([{ id: 'a', employeeId: 'someone-else' }]);
  if (failure === 'reference') m.listProviderCalendars.mockResolvedValue([]);
  if (failure === 'readonly') m.listProviderCalendars.mockResolvedValue([{ id: 'book', writable: false }, { id: 'private' }, { id: 'work' }]);
  if (failure === 'provider') m.fetchProviderBusyRanges.mockRejectedValue(new Error('PRIVATE TOKEN'));
  if (failure === 'partial') m.fetchProviderBusyRanges.mockResolvedValue(undefined);
  if (failure === 'empty-conflicts') m.getEmployee.mockResolvedValue({ ...employee, calendarPolicy: { ...employee.calendarPolicy, conflicts: [] } });
  if (failure === 'missing-booking') m.getEmployee.mockResolvedValue({ ...employee, calendarPolicy: { ...employee.calendarPolicy, booking: null } });
  expect(await checkEmployeeAvailability('workspace', input)).toEqual({ available: false, reason: 'provider_unknown' });
});
it('reports overlapping busy time, including partial overlap, without event details', async () => {
  m.fetchProviderBusyRanges.mockResolvedValue([{ start: new Date('2026-09-14T10:59:00Z'), end: new Date('2026-09-14T12:00:00Z'), summary: 'SECRET' }]);
  expect(await checkEmployeeAvailability('workspace', input)).toEqual({ available: false, reason: 'provider_busy' });
});
it('hands Cal.com authority back without claiming free or writing', async () => {
  m.getEmployee.mockResolvedValue({ ...employee, calendarPolicy: { authority: 'calcom', eventType: 'sam/intro', bookingUrl: 'https://cal.com/sam/intro' } });
  expect(await checkEmployeeAvailability('workspace', input)).toEqual({ available: false, reason: 'calcom_authority', eventType: 'sam/intro', bookingUrl: 'https://cal.com/sam/intro' });
  expect(await bookEmployeeAppointment('workspace', { ...input, callerName: 'Caller' })).toEqual({ status: 'use_calcom', eventType: 'sam/intro', bookingUrl: 'https://cal.com/sam/intro' });
  expect(m.getCalendarCredential).not.toHaveBeenCalled(); expect(m.reserveEmployeeAppointment).not.toHaveBeenCalled();
});
it('requires explicit caller confirmation before a direct Google or Microsoft write', async () => {
  expect(await bookEmployeeAppointment('workspace', { ...input, callerName: 'Caller' })).toEqual({
    status: 'confirmation_required',
    reason: 'Ask the caller to explicitly confirm the employee, time, and contact details before booking.',
  });
  expect(m.reserveEmployeeAppointment).not.toHaveBeenCalled();
  expect(m.createProviderCalendarEvent).not.toHaveBeenCalled();
});
it('rechecks availability, reserves before one write, and confirms only after provider success', async () => {
  expect(await bookEmployeeAppointment('workspace', { ...input, callerName: 'Caller', callerPhone: '+14155550123', callerConfirmed: true, purpose: 'Private purpose' })).toEqual({ status: 'confirmed', appointmentId: 'reservation' });
  expect(m.fetchProviderBusyRanges).toHaveBeenCalledTimes(2);
  expect(m.reserveEmployeeAppointment).toHaveBeenCalledWith('workspace', expect.objectContaining({ expectedEmployeeUpdatedAt: employee.updatedAt }), undefined);
  expect(m.reserveEmployeeAppointment.mock.invocationCallOrder[0]).toBeLessThan(m.createProviderCalendarEvent.mock.invocationCallOrder[0]!);
  expect(m.createProviderCalendarEvent).toHaveBeenCalledExactlyOnceWith('google', 'SECRET', 'book', { summary: 'Appointment with Sam', startIso: input.start, endIso: input.end, timezone: 'UTC', description: 'Booked via DeskRoute' }, undefined);
  expect(m.finishEmployeeAppointment).toHaveBeenCalledWith('workspace', 'reservation', 'event', expect.any(Object));
});
it('does not write after losing the reservation race or report confirmation on provider failure', async () => {
  m.reserveEmployeeAppointment.mockResolvedValueOnce(null);
  expect(await bookEmployeeAppointment('workspace', { ...input, callerName: 'Caller', callerConfirmed: true })).toEqual({ status: 'unavailable' });
  expect(m.createProviderCalendarEvent).not.toHaveBeenCalled();
  m.createProviderCalendarEvent.mockRejectedValue(new Error('SECRET'));
  expect(await bookEmployeeAppointment('workspace', { ...input, callerName: 'Caller', callerConfirmed: true })).toEqual({ status: 'unknown' });
  expect(m.createProviderCalendarEvent).toHaveBeenCalledTimes(1);
  expect(m.finishEmployeeAppointment).not.toHaveBeenCalled();
});
it('does not reserve or dispatch a provider write when inspection consumes the safe write budget', async () => {
  vi.useFakeTimers();
  try {
    const startedAt = Date.now();
    m.listProviderCalendars.mockImplementation(async () => {
      vi.setSystemTime(startedAt + 31_000);
      return [{ id: 'book', writable: true }, { id: 'private', writable: false }, { id: 'work', writable: true }];
    });

    expect(await bookEmployeeAppointment('workspace', { ...input, callerName: 'Caller', callerConfirmed: true }, undefined, startedAt + 45_000)).toEqual({ status: 'unknown' });
    expect(m.listProviderCalendars).toHaveBeenCalledWith('google', 'SECRET', expect.any(AbortSignal));
    expect(m.fetchProviderBusyRanges).toHaveBeenCalledWith('google', 'SECRET', expect.any(Array), input.start, input.end, expect.any(AbortSignal));
    expect(m.reserveEmployeeAppointment).not.toHaveBeenCalled();
    expect(m.createProviderCalendarEvent).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it('requires a still-assigned connection when obtaining credentials', async () => {
  await checkEmployeeAvailability('workspace', input);
  expect(m.getCalendarCredential).toHaveBeenCalledWith('workspace', 'a', 'employee');
});
it('starts both reads on all connections concurrently', async () => {
  let releaseBusy!: (value: never[]) => void;
  let releaseCalendars!: (value: { id: string; writable: boolean }[]) => void;
  m.fetchProviderBusyRanges.mockReturnValue(new Promise<never[]>(resolve => { releaseBusy = resolve; }));
  m.listProviderCalendars.mockReturnValue(new Promise(resolve => { releaseCalendars = resolve; }));
  const result = checkEmployeeAvailability('workspace', input);
  await vi.waitFor(() => expect(m.fetchProviderBusyRanges).toHaveBeenCalledTimes(2));
  expect(m.listProviderCalendars).toHaveBeenCalledTimes(2);
  releaseBusy([]);
  releaseCalendars([{ id: 'book', writable: true }, { id: 'private', writable: false }, { id: 'work', writable: true }]);
  expect(await result).toMatchObject({ available: true });
});
it('rejects more than ten connections before provider access', async () => {
  m.listEmployeeConnections.mockResolvedValue([{ id: 'a', employeeId: 'employee' }, ...Array.from({ length: 11 }, (_, i) => ({ id: String(i), employeeId: 'employee' }))]);
  m.getEmployee.mockResolvedValue({ ...employee, calendarPolicy: { ...employee.calendarPolicy, conflicts: Array.from({ length: 11 }, (_, i) => ({ connectionId: String(i), calendarId: 'book' })) } });
  expect(await checkEmployeeAvailability('workspace', input)).toMatchObject({ reason: 'provider_unknown' });
  expect(m.getCalendarCredential).not.toHaveBeenCalled();
});
it('releases only definite provider rejection and holds ambiguous writes', async () => {
  const { ProviderWriteRejectedError } = await import('./provider-write-error.js');
  m.createProviderCalendarEvent.mockRejectedValueOnce(new ProviderWriteRejectedError());
  expect(await bookEmployeeAppointment('workspace', { ...input, callerName: 'Caller', callerConfirmed: true })).toEqual({ status: 'unknown' });
  expect(m.finishEmployeeAppointment).toHaveBeenCalledWith('workspace', 'reservation', null, expect.any(Object));
  m.finishEmployeeAppointment.mockClear();
  m.createProviderCalendarEvent.mockRejectedValueOnce(new Error('timeout'));
  await bookEmployeeAppointment('workspace', { ...input, callerName: 'Caller', callerConfirmed: true });
  expect(m.finishEmployeeAppointment).not.toHaveBeenCalled();
});

it.each(['transport', '5xx', 'empty', 'finalize-throw', 'finalize-null'])('marks explicit reconciliation required after %s uncertainty', async failure => {
  if (failure === 'transport' || failure === '5xx') m.createProviderCalendarEvent.mockRejectedValue(new Error(failure));
  if (failure === 'empty') m.createProviderCalendarEvent.mockResolvedValue(' ');
  if (failure === 'finalize-throw') m.finishEmployeeAppointment.mockRejectedValue(new Error('db unavailable'));
  if (failure === 'finalize-null') m.finishEmployeeAppointment.mockResolvedValue(null);
  expect(await bookEmployeeAppointment('workspace', { ...input, callerName: 'Caller', callerConfirmed: true })).toEqual({ status: 'unknown' });
  expect(m.markEmployeeAppointmentReconciliationRequired).toHaveBeenCalledExactlyOnceWith('workspace', 'reservation');
});
