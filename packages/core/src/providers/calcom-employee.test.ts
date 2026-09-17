import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_BUSINESS_HOURS } from '@receptionist/shared';
import { ProviderWriteRejectedError } from './provider-write-error.js';
const m = vi.hoisted(() => ({ getEmployee: vi.fn(), getCalcomClient: vi.fn(), eventTypes: vi.fn(), slots: vi.fn(), book: vi.fn(), reserveEmployeeAppointment: vi.fn(), finishEmployeeAppointment: vi.fn(), reconcileCalcomAppointment: vi.fn().mockResolvedValue(null), markEmployeeAppointmentReconciliationRequired: vi.fn() }));
vi.mock('../repositories/employees.js', () => m);
vi.mock('../repositories/calcom.js', () => m);
vi.mock('../repositories/appointments.js', () => m);
import { bookEmployeeAppointment, checkEmployeeAvailability } from './employee-calendar.js';
const input = { employeeId: 'employee', start: '2026-09-14T10:00:00Z', end: '2026-09-14T11:00:00Z', callerName: 'Caller', callerEmail: 'caller@example.com', callerConfirmed: true };
beforeEach(() => {
 vi.resetAllMocks();
 m.getEmployee.mockResolvedValue({ id: 'employee', updatedAt: 'version', displayName: 'Sam', timezone: 'UTC', workingHours: DEFAULT_BUSINESS_HOURS, routingEnabled: true, manualAvailability: 'available', calendarPolicy: { authority: 'calcom', connectionId: 'connection', eventTypeId: 12 } });
 m.eventTypes.mockResolvedValue([{ id: 12, lengthInMinutes: 60, bookingFields: [] }]); m.reconcileCalcomAppointment.mockResolvedValue(null); m.getCalcomClient.mockResolvedValue(m); m.slots.mockResolvedValue([{ start: input.start, end: input.end }]); m.reserveEmployeeAppointment.mockResolvedValue({ id: 'reservation' });
 m.book.mockResolvedValue({ uid: 'uid', status: 'accepted', start: input.start, end: input.end }); m.finishEmployeeAppointment.mockResolvedValue({ status: 'confirmed' });
});
it('checks owned live slots and books exactly once after reservation', async () => {
 expect(await checkEmployeeAvailability('tenant', input)).toEqual({ available: true, reason: 'available' });
 expect(await bookEmployeeAppointment('tenant', input)).toEqual({ status: 'confirmed', appointmentId: 'reservation' });
 expect(m.getCalcomClient).toHaveBeenCalledWith('tenant', 'employee', 'connection'); expect(m.book).toHaveBeenCalledTimes(1);
 expect(m.reserveEmployeeAppointment.mock.invocationCallOrder[0]).toBeLessThan(m.book.mock.invocationCallOrder[0]);
});
it('propagates one aggregate deadline through Cal.com reads and the provider write', async () => {
 const deadlineAt = Date.now() + 45_000;
 expect(await bookEmployeeAppointment('tenant', input, undefined, deadlineAt)).toEqual({ status: 'confirmed', appointmentId: 'reservation' });
 expect(m.eventTypes).toHaveBeenCalledWith(expect.any(AbortSignal));
 expect(m.slots).toHaveBeenCalledWith(12, input.start, input.end, 'UTC', expect.any(AbortSignal));
 expect(m.book).toHaveBeenCalledWith(expect.any(Object), expect.any(AbortSignal));
});
it('no contact is actionable without reservation', async () => { expect(await bookEmployeeAppointment('tenant', { ...input, callerEmail: undefined })).toMatchObject({ status: 'contact_required' }); expect(m.reserveEmployeeAppointment).not.toHaveBeenCalled(); });
it('unowned connection fails closed', async () => { m.getCalcomClient.mockResolvedValue(null); expect(await checkEmployeeAvailability('tenant', input)).toEqual({ available: false, reason: 'provider_unknown' }); });
it('requires the exact provider interval', async () => { m.slots.mockResolvedValue([{ start: input.start, end: '2026-09-14T10:30:00Z' }]); expect(await checkEmployeeAvailability('tenant', input)).toMatchObject({ available: false }); });
it.each(['network', 'pending', 'malformed'])('retains ambiguous %s reservation', async failure => {
 if (failure === 'network') m.book.mockRejectedValue(new Error('private'));
 if (failure === 'pending') m.book.mockResolvedValue({ uid: 'uid', status: 'pending' });
 if (failure === 'malformed') m.book.mockResolvedValue({});
 expect(await bookEmployeeAppointment('tenant', input)).toEqual({ status: 'unknown' }); expect(m.markEmployeeAppointmentReconciliationRequired).toHaveBeenCalledWith('tenant', 'reservation'); expect(m.finishEmployeeAppointment).not.toHaveBeenCalled();
});
it('releases definite rejection', async () => { m.book.mockRejectedValue(new ProviderWriteRejectedError()); await bookEmployeeAppointment('tenant', input); expect(m.finishEmployeeAppointment).toHaveBeenCalledWith('tenant', 'reservation', null, expect.any(Object)); });
it('requires explicit caller confirmation before a Cal.com write', async () => { expect(await bookEmployeeAppointment('tenant', { ...input, callerConfirmed: false })).toMatchObject({ status: 'confirmation_required' }); expect(m.reserveEmployeeAppointment).not.toHaveBeenCalled(); });
it('asks for missing contact even when provider reads would fail', async () => { m.slots.mockRejectedValue(new Error('network')); expect(await bookEmployeeAppointment('tenant', { ...input, callerEmail: undefined })).toMatchObject({ status: 'contact_required' }); expect(m.slots).not.toHaveBeenCalled(); });

it('revalidates selected event compatibility before reserving or booking', async () => {
 m.eventTypes.mockResolvedValue([]);
 expect(await bookEmployeeAppointment('tenant', input)).toMatchObject({ status: 'unknown' });
 expect(m.reserveEmployeeAppointment).not.toHaveBeenCalled(); expect(m.book).not.toHaveBeenCalled();
});
it('requires event-specific contact fields before reservation', async () => {
 m.eventTypes.mockResolvedValue([{ id: 12, lengthInMinutes: 60, bookingFields: [{ slug: 'attendeePhoneNumber', required: true }] }]);
 expect(await bookEmployeeAppointment('tenant', input)).toMatchObject({ status: 'contact_required' }); expect(m.reserveEmployeeAppointment).not.toHaveBeenCalled();
});
it('reconciles authenticated current state after finalization loses the race and returns unknown', async () => {
 m.finishEmployeeAppointment.mockResolvedValue(null);
 expect(await bookEmployeeAppointment('tenant', input)).toEqual({ status: 'unknown' });
 expect(m.reconcileCalcomAppointment).toHaveBeenCalledWith('tenant', 'reservation', 'uid', { useStoredUid: true });
});
