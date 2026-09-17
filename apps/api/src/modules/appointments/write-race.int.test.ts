import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ getCalendarCredential: vi.fn(), listProviderCalendars: vi.fn(), fetchProviderBusyRanges: vi.fn(), createProviderCalendarEvent: vi.fn() }));
vi.mock('@receptionist/core/providers/slack.js', () => ({ notifySlack: vi.fn() }));
vi.mock('@receptionist/core/providers/calendarAccess.js', () => m);
vi.mock('@receptionist/core/providers/calendarProvider.js', () => m);
import { db } from '@receptionist/core/db/client.js';
import { appointments } from '@receptionist/core/db/schema.js';
import { createWorkspace } from '@receptionist/core/repositories/workspaces.js';
import { createEmployee, assignEmployeeConnection, saveEmployeePolicy } from '@receptionist/core/repositories/employees.js';
import { saveCalendarConnection } from '@receptionist/core/repositories/calendar-connections.js';
import { cancelAppointmentById, deletePastAppointment } from '@receptionist/core/repositories/appointments.js';
import { Hono } from 'hono';
import type { AppEnv } from '../../types.js';
import { appointments as appointmentRoutes } from './route.js';
import { sql } from 'drizzle-orm';
import { bookEmployeeAppointment } from '@receptionist/core/providers/employee-calendar.js';
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
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
it('holds the reservation across both DELETE routes and repository bypasses while provider create is pending', async () => {
  const { a, input } = await fixture();
  const entered = deferred<void>(), release = deferred<string>();
  m.createProviderCalendarEvent.mockImplementation(() => { entered.resolve(); return release.promise; });
  const booking = bookEmployeeAppointment(a, input);
  await entered.promise;
  const app = new Hono<AppEnv>().use('*', async (c, next) => {
    c.set('agentId', a); c.set('workspaceRole', 'manager'); await next();
  }).route('/appointments', appointmentRoutes);
  try {
    const [row] = await db.select().from(appointments);
    expect.soft(row).toMatchObject({ status: 'requested', providerWriteState: 'in_flight' });
    // Make the history predicate eligible without sleeps or a real provider.
    await db.execute(sql`UPDATE appointments SET start_time = now() - interval '2 hours', end_time = now() - interval '1 hour' WHERE id = ${row!.id}`);
    expect.soft(await cancelAppointmentById(row!.id, a)).toBeNull();
    expect.soft(await deletePastAppointment(a, row!.id)).toBe(false);
    for (const path of [`/appointments/${row!.id}`, `/appointments/history/${row!.id}`]) {
      expect.soft((await app.request(path, { method: 'DELETE' })).status).toBe(409);
    }
  } finally { release.resolve('event'); }
  expect(await booking).toMatchObject({ status: 'unknown' });
});
