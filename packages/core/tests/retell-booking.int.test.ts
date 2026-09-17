import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ getCalendarCredential: vi.fn(), listProviderCalendars: vi.fn(), fetchProviderBusyRanges: vi.fn(), createProviderCalendarEvent: vi.fn() }));
vi.mock('../src/providers/calendarAccess.js', () => m);
vi.mock('../src/providers/calendarProvider.js', () => m);
import { db } from '../src/db/client.js';
import { appointments } from '../src/db/schema.js';
import { createWorkspace } from '../src/repositories/workspaces.js';
import { createEmployee, assignEmployeeConnection, saveEmployeePolicy, updateEmployee, deactivateEmployee, getEmployee, EmployeeBookingInProgressError } from '../src/repositories/employees.js';
import { saveCalendarConnection } from '../src/repositories/calendar-connections.js';
import * as appointmentRepo from '../src/repositories/appointments.js';
import { sql } from 'drizzle-orm';
import { reserveEmployeeAppointment, finishEmployeeAppointment } from '../src/repositories/appointments.js';
import { bookEmployeeAppointment } from '../src/providers/employee-calendar.js';
beforeEach(() => { vi.resetAllMocks(); m.getCalendarCredential.mockResolvedValue({ provider: 'google', token: 'mock', connectionId: 'unused' }); m.listProviderCalendars.mockResolvedValue([{ id: 'book', writable: true }]); m.fetchProviderBusyRanges.mockResolvedValue([]); });
async function fixture() {
  const a = (await createWorkspace(crypto.randomUUID(), 'test@example.test', 'Test', 'UTC', 'team'))!.id;
  const e = await createEmployee(a, { displayName: 'Sam', timezone: 'UTC', routingEnabled: true, manualAvailability: 'available' });
  const c = await saveCalendarConnection({ id: crypto.randomUUID(), agentId: a, provider: 'google', providerAccountId: 'mock', accountEmail: 'test@example.test', accountName: null, encryptedRefreshToken: 'mock', encryptionOwner: 'mock' });
  await assignEmployeeConnection(a, e.id, c.id, true);
  const ref = { connectionId: c.id, calendarId: 'book' };
  await saveEmployeePolicy(a, e.id, { authority: 'direct', booking: ref, conflicts: [ref] });
  m.getCalendarCredential.mockResolvedValue({ provider: 'google', token: 'mock', connectionId: c.id });
  return { a, input: { employeeId: e.id, start: '2026-09-14T10:00:00Z', end: '2026-09-14T11:00:00Z', callerName: 'Caller', callerConfirmed: true } };
}
it('keeps ambiguous failures unconfirmed and blocks a repeated write to the same slot', async () => {
  const { a, input } = await fixture(); m.createProviderCalendarEvent.mockRejectedValue(new Error('MOCK PROVIDER ERROR'));
  expect(await bookEmployeeAppointment(a, input)).toEqual({ status: 'unknown' });
  expect(await bookEmployeeAppointment(a, input)).toEqual({ status: 'unavailable' });
  expect(m.createProviderCalendarEvent).toHaveBeenCalledTimes(1);
  expect(await db.select().from(appointments)).toEqual([expect.objectContaining({ status: 'requested', providerWriteState: 'reconciliation_required', externalEventId: null })]);
});
it('concurrent overlapping calls write only one provider event and confirm only its reservation', async () => {
  const { a, input } = await fixture(); m.createProviderCalendarEvent.mockResolvedValue('mock-event');
  const results = await Promise.all(Array.from({ length: 5 }, () => bookEmployeeAppointment(a, input)));
  expect(results.filter(result => result.status === 'confirmed')).toHaveLength(1);
  expect(m.createProviderCalendarEvent).toHaveBeenCalledTimes(1);
  expect(await db.select().from(appointments)).toEqual([expect.objectContaining({ status: 'confirmed', providerWriteState: null, externalEventId: 'mock-event' })]);
});
it('releases a definite rejection so a later distinct request can reserve', async () => {
  const { ProviderWriteRejectedError } = await import('../src/providers/provider-write-error.js');
  const { a, input } = await fixture();
  m.createProviderCalendarEvent.mockRejectedValueOnce(new ProviderWriteRejectedError()).mockResolvedValueOnce('event');
  expect(await bookEmployeeAppointment(a, input)).toEqual({ status: 'unknown' });
  expect((await db.select().from(appointments))[0]).toMatchObject({ status: 'cancelled', providerWriteState: null, externalEventId: null });
  expect(await bookEmployeeAppointment(a, input)).toMatchObject({ status: 'confirmed' });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
it('rejects a stale employee snapshot after mutation and a missing employee', async () => {
  const { a, input } = await fixture();
  const employee = (await getEmployee(a, input.employeeId))!;
  const reservation = { employeeId: employee.id, expectedEmployeeUpdatedAt: employee.updatedAt,
    callerName: 'Caller', startTime: new Date(input.start), endTime: new Date(input.end),
    externalCalendarId: 'book', externalCalendarConnectionId: null };
  await updateEmployee(a, employee.id, { routingEnabled: false });
  expect(await reserveEmployeeAppointment(a, reservation)).toBeNull();
  expect(await reserveEmployeeAppointment(a, { ...reservation, employeeId: crypto.randomUUID() })).toBeNull();
  expect(await db.select().from(appointments)).toEqual([]);
});
it('fences a mutation completed while provider availability reads are pending', async () => {
  const { a, input } = await fixture();
  const entered = deferred<void>(), release = deferred<never[]>();
  m.fetchProviderBusyRanges.mockImplementation(() => { entered.resolve(); return release.promise; });
  const booking = bookEmployeeAppointment(a, input);
  await entered.promise;
  try {
    await deactivateEmployee(a, input.employeeId);
  } finally { release.resolve([]); }
  expect(await booking).toEqual({ status: 'unavailable' });
  expect(m.createProviderCalendarEvent).not.toHaveBeenCalled();
  expect(await db.select().from(appointments)).toEqual([]);
});
it.each([null, 'event'])('blocks employee mutations during a requested write and permits them after finish %s', async eventId => {
  const { a, input } = await fixture();
  const employee = (await getEmployee(a, input.employeeId))!;
  const connectionId = employee.calendarPolicy.authority === 'direct' ? employee.calendarPolicy.booking!.connectionId : '';
  const entered = deferred<void>(), release = deferred<string>();
  m.createProviderCalendarEvent.mockImplementation(() => { entered.resolve(); return release.promise; });
  const booking = bookEmployeeAppointment(a, input);
  await entered.promise;
  const policy = { authority: 'calcom' as const, eventType: 'sam/intro', bookingUrl: null };
  try {
    await expect(updateEmployee(a, employee.id, { workingHours: { ...employee.workingHours, weekly: { ...employee.workingHours.weekly, mon: [] } } })).rejects.toBeInstanceOf(EmployeeBookingInProgressError);
    await expect(deactivateEmployee(a, employee.id)).rejects.toBeInstanceOf(EmployeeBookingInProgressError);
    await expect(saveEmployeePolicy(a, employee.id, policy)).rejects.toBeInstanceOf(EmployeeBookingInProgressError);
    await expect(assignEmployeeConnection(a, employee.id, connectionId, false)).rejects.toBeInstanceOf(EmployeeBookingInProgressError);
    expect(await getEmployee(a, employee.id)).toEqual(employee);
    // An unrelated edit can complete while provider I/O is held open: no workspace lock spans it.
    const other = await createEmployee(a, { displayName: 'Other', timezone: 'UTC' });
    expect(await updateEmployee(a, other.id, { department: 'Sales' })).toMatchObject({ department: 'Sales' });
    const extra = await saveCalendarConnection({ id: crypto.randomUUID(), agentId: a, provider: 'google', providerAccountId: 'extra', accountEmail: 'extra@example.test', accountName: null, encryptedRefreshToken: 'mock', encryptionOwner: 'mock' });
    expect(await assignEmployeeConnection(a, employee.id, extra.id, true)).toBe(true);
  } finally { release.resolve(''); }
  expect(await booking).toEqual({ status: 'unknown' });
  const [held] = await db.select().from(appointments);
  expect(held!.status).toBe('requested');
  await expect(deactivateEmployee(a, employee.id)).rejects.toBeInstanceOf(EmployeeBookingInProgressError);
  if (eventId) expect(await finishEmployeeAppointment(a, held!.id, eventId)).toBeNull();
  expect(await appointmentRepo.reconcileEmployeeAppointmentNotCreated(a, held!.id)).toMatchObject({ status: 'cancelled' });
  expect(await updateEmployee(a, employee.id, { displayName: 'Updated' })).toMatchObject({ displayName: 'Updated' });
  expect(await deactivateEmployee(a, employee.id)).toMatchObject({ routingEnabled: false });
  expect(await saveEmployeePolicy(a, employee.id, policy)).toMatchObject({ calendarPolicy: policy });
  expect(await assignEmployeeConnection(a, employee.id, connectionId, false)).toBe(true);
});

it('holds the reservation against repository bypasses while provider create is pending', async () => {
  const { a, input } = await fixture();
  const entered = deferred<void>(), release = deferred<string>();
  m.createProviderCalendarEvent.mockImplementation(() => { entered.resolve(); return release.promise; });
  const booking = bookEmployeeAppointment(a, input);
  await entered.promise;
  try {
    const [row] = await db.select().from(appointments);
    expect.soft(row).toMatchObject({ status: 'requested', providerWriteState: 'in_flight' });
    // Make the history predicate eligible without sleeps or a real provider.
    await db.execute(sql`UPDATE appointments SET start_time = now() - interval '2 hours', end_time = now() - interval '1 hour' WHERE id = ${row!.id}`);
    expect.soft(await appointmentRepo.cancelAppointmentById(row!.id, a)).toBeNull();
    expect.soft(await appointmentRepo.deletePastAppointment(a, row!.id)).toBe(false);
    expect(await appointmentRepo.reconcileEmployeeAppointmentNotCreated(a, row!.id)).toBeNull();
  } finally { release.resolve('event'); }
  expect(await booking).toMatchObject({ status: 'unknown' });
});
it('reconciles only eligible workspace reservations atomically, releases overlap, and preserves confirmed/legacy behavior', async () => {
  const { a, input } = await fixture();
  m.createProviderCalendarEvent.mockRejectedValue(new Error('timeout'));
  await bookEmployeeAppointment(a, input);
  const [row] = await db.select().from(appointments);
  expect.soft(await appointmentRepo.cancelAppointmentById(row!.id, a)).toBeNull();
  expect(await finishEmployeeAppointment(a, row!.id, null)).toBeNull();
  await db.execute(sql`UPDATE appointments SET start_time = now() - interval '2 hours', end_time = now() - interval '1 hour' WHERE id = ${row!.id}`);
  expect(await appointmentRepo.deletePastAppointment(a, row!.id)).toBe(false);
  expect((await appointmentRepo.listAppointments(a))[0]).toMatchObject({ providerWriteState: 'reconciliation_required' });
  expect(await appointmentRepo.reconcileEmployeeAppointmentNotCreated(crypto.randomUUID(), row!.id)).toBeNull();
  await db.execute(sql`UPDATE appointments SET start_time = ${input.start}::timestamptz, end_time = ${input.end}::timestamptz WHERE id = ${row!.id}`);
  expect(await appointmentRepo.reconcileEmployeeAppointmentNotCreated(a, row!.id)).toMatchObject({ status: 'cancelled', providerWriteState: null });
  expect(await appointmentRepo.reconcileEmployeeAppointmentNotCreated(a, row!.id)).toBeNull();
  m.createProviderCalendarEvent.mockResolvedValue('event');
  expect(await bookEmployeeAppointment(a, input)).toMatchObject({ status: 'confirmed' });
  const confirmed = (await db.select().from(appointments)).find(item => item.status === 'confirmed')!;
  expect(await appointmentRepo.reconcileEmployeeAppointmentNotCreated(a, confirmed.id)).toBeNull();
  expect(await appointmentRepo.cancelAppointmentById(confirmed.id, a)).toMatchObject({ status: 'cancelled', providerWriteState: null });
  const legacy = await appointmentRepo.createAppointment({ agentId: a, callerId: null, callerPhone: null, serviceName: 'Legacy', startTime: new Date(0), endTime: new Date(1), status: 'requested' });
  expect(await appointmentRepo.cancelAppointmentById(legacy.id, a)).toMatchObject({ status: 'cancelled' });
  expect(await appointmentRepo.deletePastAppointment(a, legacy.id)).toBe(true);
});
it('allows stale in-flight recovery only beyond 24 hours', async () => {
  const { a, input } = await fixture();
  const e = (await getEmployee(a, input.employeeId))!;
  const row = (await reserveEmployeeAppointment(a, { employeeId: e.id, expectedEmployeeUpdatedAt: e.updatedAt, callerName: 'Caller', startTime: new Date(input.start), endTime: new Date(input.end), externalCalendarId: 'book', externalCalendarConnectionId: null }))!;
  expect(await appointmentRepo.reconcileEmployeeAppointmentNotCreated(a, row.id)).toBeNull();
  await db.execute(sql`UPDATE appointments SET updated_at = now() - interval '23 hours' WHERE id = ${row.id}`);
  expect(await appointmentRepo.reconcileEmployeeAppointmentNotCreated(a, row.id)).toBeNull();
  await db.execute(sql`UPDATE appointments SET updated_at = now() - interval '25 hours' WHERE id = ${row.id}`);
  expect(await appointmentRepo.reconcileEmployeeAppointmentNotCreated(a, row.id)).toMatchObject({ status: 'cancelled', providerWriteState: null });
  expect(await finishEmployeeAppointment(a, row.id, 'late-event')).toBeNull();
});

it('links invocation and booking intent before provider I/O and replays NFC results after cancellation', async () => {
 const { createHmac } = await import('node:crypto');
 const { createApp } = await import('../../../apps/api/src/app.js');
 const { env } = await import('../src/env.js');
 const repo = await import('../src/repositories/retell.js');
 const { a, input } = await fixture();
 env.RETELL_API_KEY = 'local-test'; env.RETELL_WORKSPACE_ID = a; env.RETELL_AGENT_ID = 'agent';
 await repo.saveRetellConnection(a, 'agent', true);
 const app = createApp({ allowedOrigins: [] });
 const invoke = async (callerName: string) => {
  const raw = JSON.stringify({ call: { agent_id: 'agent', call_id: 'call' }, args: { ...input, callerName, purpose: 'Résumé'.normalize(callerName === 'José' ? 'NFC' : 'NFD') } });
  const time = Date.now();
  return (await app.request('/api/retell/functions/book-appointment', { method: 'POST', body: raw,
   headers: { 'x-retell-signature': `v=${time},d=${createHmac('sha256', 'local-test').update(raw + time).digest('hex')}` } })).json();
 };
 m.createProviderCalendarEvent.mockImplementation(async () => {
  const rows = (await db.execute(sql`SELECT i.state, i.appointment_id, a.id FROM retell_function_invocations i JOIN appointments a ON a.id=i.appointment_id`)).rows;
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ state: 'uncertain', appointment_id: rows[0]!.id });
  return 'event';
 });
 const first = await invoke('José');
 expect(first).toMatchObject({ status: 'confirmed' });
 const [row] = await db.select().from(appointments);
 await appointmentRepo.cancelAppointmentById(row!.id, a);
 expect(await invoke('José'.normalize('NFD'))).toEqual(first);
 expect(m.createProviderCalendarEvent).toHaveBeenCalledTimes(1);
 expect(await db.select().from(appointments)).toHaveLength(1);
});

it('blocks a distinct booking invocation for the same call while the first write is unresolved', async () => {
 const { env } = await import('../src/env.js'); const repo = await import('../src/repositories/retell.js');
 const { a, input } = await fixture();
 env.RETELL_API_KEY = 'test'; env.RETELL_WORKSPACE_ID = a; env.RETELL_AGENT_ID = 'agent';
 await repo.saveRetellConnection(a, 'agent', true);
 m.createProviderCalendarEvent.mockRejectedValue(new Error('timeout'));
 expect(await repo.runRetellFunction(a, 'agent', 'call', 'book-appointment', 'a'.repeat(64), 'one', key => bookEmployeeAppointment(a, input, key))).toEqual({ status: 'unknown', reason: 'reconciliation_required' });
 const later = { ...input, start: '2026-09-14T12:00:00Z', end: '2026-09-14T13:00:00Z' };
 expect(await repo.runRetellFunction(a, 'agent', 'call', 'book-appointment', 'b'.repeat(64), 'two', key => bookEmployeeAppointment(a, later, key))).toEqual({ status: 'unknown', reason: 'reconciliation_required' });
 expect(m.createProviderCalendarEvent).toHaveBeenCalledTimes(1);
 expect(await db.select().from(appointments)).toHaveLength(1);
});
it('blocks a distinct invocation after confirmation and permits one only after definite cancellation', async () => {
 const { env } = await import('../src/env.js'); const repo = await import('../src/repositories/retell.js');
 const { a, input } = await fixture();
 env.RETELL_API_KEY = 'test'; env.RETELL_WORKSPACE_ID = a; env.RETELL_AGENT_ID = 'agent';
 await repo.saveRetellConnection(a, 'agent', true); m.createProviderCalendarEvent.mockResolvedValue('event');
 expect(await repo.runRetellFunction(a, 'agent', 'call', 'book-appointment', 'a'.repeat(64), 'one', key => bookEmployeeAppointment(a, input, key))).toMatchObject({ status: 'confirmed' });
 const later = { ...input, start: '2026-09-14T12:00:00Z', end: '2026-09-14T13:00:00Z' };
 expect(await repo.runRetellFunction(a, 'agent', 'call', 'book-appointment', 'b'.repeat(64), 'two', key => bookEmployeeAppointment(a, later, key))).toEqual({ status: 'unknown', reason: 'reconciliation_required' });
 const [first] = await db.select().from(appointments); await appointmentRepo.cancelAppointmentById(first!.id, a);
 expect(await repo.runRetellFunction(a, 'agent', 'call', 'book-appointment', 'c'.repeat(64), 'three', key => bookEmployeeAppointment(a, later, key))).toMatchObject({ status: 'confirmed' });
 expect(m.createProviderCalendarEvent).toHaveBeenCalledTimes(2);
});

it('rolls back reservation creation when linking the invocation fails before the network', async () => {
 const { env } = await import('../src/env.js'); const repo = await import('../src/repositories/retell.js');
 const { a, input } = await fixture();
 env.RETELL_API_KEY = 'test'; env.RETELL_WORKSPACE_ID = a; env.RETELL_AGENT_ID = 'agent';
 await repo.saveRetellConnection(a, 'agent', true);
 await db.execute(sql`CREATE OR REPLACE FUNCTION reject_intent_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.appointment_id IS NOT NULL THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$`);
 await db.execute(sql`CREATE TRIGGER reject_intent_link BEFORE UPDATE ON retell_function_invocations FOR EACH ROW EXECUTE FUNCTION reject_intent_link()`);
 try {
  expect(await repo.runRetellFunction(a, 'agent', 'call', 'book-appointment', 'a'.repeat(64), undefined, key => bookEmployeeAppointment(a, input, key))).toMatchObject({ status: 'unknown' });
  expect(m.createProviderCalendarEvent).not.toHaveBeenCalled();
  expect(await db.select().from(appointments)).toEqual([]);
 } finally {
  await db.execute(sql`DROP TRIGGER reject_intent_link ON retell_function_invocations`);
  await db.execute(sql`DROP FUNCTION reject_intent_link()`);
 }
});
it('a lost result after successful external booking stays uncertain and never recreates after cancellation', async () => {
 const { env } = await import('../src/env.js'); const repo = await import('../src/repositories/retell.js');
 const { a, input } = await fixture();
 env.RETELL_API_KEY = 'test'; env.RETELL_WORKSPACE_ID = a; env.RETELL_AGENT_ID = 'agent';
 await repo.saveRetellConnection(a, 'agent', true);
 m.createProviderCalendarEvent.mockResolvedValue('event');
 await db.execute(sql`CREATE OR REPLACE FUNCTION reject_completed_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state = 'completed' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$`);
 await db.execute(sql`CREATE TRIGGER reject_completed_result BEFORE UPDATE ON retell_function_invocations FOR EACH ROW EXECUTE FUNCTION reject_completed_result()`);
 const invoke = () => repo.runRetellFunction(a, 'agent', 'call', 'book-appointment', 'b'.repeat(64), 'tool', key => bookEmployeeAppointment(a, input, key));
 try { expect(await invoke()).toMatchObject({ status: 'unknown', reason: 'reconciliation_required' }); }
 finally {
  await db.execute(sql`DROP TRIGGER reject_completed_result ON retell_function_invocations`);
  await db.execute(sql`DROP FUNCTION reject_completed_result()`);
 }
 const [row] = await db.select().from(appointments); expect(row).toMatchObject({ status: 'confirmed', externalEventId: 'event' });
 await appointmentRepo.cancelAppointmentById(row!.id, a);
 expect(await invoke()).toMatchObject({ status: 'unknown', reason: 'reconciliation_required' });
 expect(m.createProviderCalendarEvent).toHaveBeenCalledTimes(1);
});
it('a crash at the durable network checkpoint fences stale intent and enters existing reconciliation', async () => {
 const { env } = await import('../src/env.js'); const repo = await import('../src/repositories/retell.js');
 const { a, input } = await fixture();
 env.RETELL_API_KEY = 'test'; env.RETELL_WORKSPACE_ID = a; env.RETELL_AGENT_ID = 'agent';
 await repo.saveRetellConnection(a, 'agent', true);
 // Simulate process termination after committing intent, before a provider response.
 await repo.runRetellFunction(a, 'agent', 'call', 'book-appointment', 'c'.repeat(64), undefined, async key => {
  const employee = (await getEmployee(a, input.employeeId))!;
  await reserveEmployeeAppointment(a, { employeeId: employee.id, expectedEmployeeUpdatedAt: employee.updatedAt,
   callerName: input.callerName, startTime: new Date(input.start), endTime: new Date(input.end), externalCalendarId: 'book', externalCalendarConnectionId: null }, key);
  throw new Error('crash');
 });
 await db.execute(sql`UPDATE retell_function_invocations SET updated_at=now()-interval '25 hours'`);
 expect(await repo.runRetellFunction(a, 'agent', 'call', 'book-appointment', 'c'.repeat(64), undefined, key => bookEmployeeAppointment(a, input, key))).toMatchObject({ status: 'unknown' });
 expect(m.createProviderCalendarEvent).not.toHaveBeenCalled();
 const [row] = await db.select().from(appointments);
 expect(row).toMatchObject({ status: 'requested', providerWriteState: 'reconciliation_required' });
 expect(await appointmentRepo.reconcileEmployeeAppointmentNotCreated(a, row!.id)).toMatchObject({ status: 'cancelled' });
});
