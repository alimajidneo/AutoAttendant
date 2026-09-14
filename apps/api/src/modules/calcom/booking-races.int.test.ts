import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@receptionist/core/db/client.js';
import { appointments } from '@receptionist/core/db/schema.js';
import { env } from '@receptionist/core/env.js';
import { createWorkspace } from '@receptionist/core/repositories/workspaces.js';
import { createEmployee } from '@receptionist/core/repositories/employees.js';
import { connectCalcom, selectCalcomEventType, ingestCalcomWebhook } from '@receptionist/core/repositories/calcom.js';
import { saveRetellConnection } from '@receptionist/core/repositories/retell.js';
import { bookEmployeeAppointment } from '@receptionist/core/providers/employee-calendar.js';
import { retell } from '../retell/route.js';
const start = '2026-09-14T10:00:00Z', end = '2026-09-14T11:00:00Z';
const eventType = { id: 12, title: 'Intro', slug: 'intro', lengthInMinutes: 60, bookingUrl: 'https://cal.com/sam/intro', recurrence: null, price: 0, isInstantEvent: false, seats: { disabled: true }, bookingFields: [], locations: [] };
const response = (data: unknown) => new Response(JSON.stringify({ status: 'success', data }));
let create: (input: Record<string, unknown>) => Promise<Response>;
const old = { ...env };
beforeEach(() => {
 env.TOKEN_ENCRYPTION_KEY = '12'.repeat(32); env.RETELL_API_KEY = 'test-only'; env.RETELL_AGENT_ID = 'agent_a';
 vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
  if (url.endsWith('/me')) return response({ id: 123, email: 'sam@example.test', username: 'sam' });
  if (url.endsWith('/event-types')) return response([eventType]);
  if (url.includes('/slots?')) return response({ '2026-09-14': [{ start, end }] });
  if (url.endsWith('/bookings') && init?.method === 'POST') return create(JSON.parse(String(init.body)));
  throw new Error('Unexpected mocked provider route');
 }));
});
afterEach(() => { Object.assign(env, old); vi.unstubAllGlobals(); });
async function fixture() {
 const a = (await createWorkspace(crypto.randomUUID(), 'test@example.test', 'Test', 'UTC', 'team'))!.id;
 const e = await createEmployee(a, { displayName: 'Sam', timezone: 'UTC', routingEnabled: true, manualAvailability: 'available' });
 const c = await connectCalcom(a, e.id, 'PRIVATE_API_KEY'); await selectCalcomEventType(a, e.id, c.id, eventType);
 return { a, e, c, input: { employeeId: e.id, start, end, callerName: 'José', callerEmail: 'caller@example.test', callerConfirmed: true } };
}
it('real PostgreSQL claims prevent duplicate provider writes across JSON formatting and aliases, even after cancellation', async () => {
 const { a, input } = await fixture(); env.RETELL_WORKSPACE_ID = a; await saveRetellConnection(a, 'agent_a', true);
 const writes = vi.fn(async (body: Record<string, unknown>) => response({ uid: 'current', status: 'accepted', start, end, eventTypeId: 12, metadata: body.metadata })); create = writes;
 const call = { agent_id: 'agent_a', call_id: 'call_a' };
 const send = (raw: string) => { const time = Date.now(); return retell.request('/functions/book-appointment', { method: 'POST', body: raw, headers: { 'x-retell-signature': `v=${time},d=${createHmac('sha256', 'test-only').update(raw + time).digest('hex')}` } }); };
 const aliases = { employeeId: input.employeeId, start: '2026-09-14T10:00:00.000Z', end, callerName: ' José '.normalize('NFD'), caller_email: input.callerEmail, caller_confirmed: true };
 const results = await Promise.all([send(JSON.stringify({ call, args: input })), send(JSON.stringify({ args: aliases, call }, null, 2))]);
 const normalized = await Promise.all(results.map(r => r.json()));
 const confirmed = normalized.find(r => r.status === 'confirmed'); expect(confirmed).toBeTruthy();
 const [row] = await db.select().from(appointments); await db.update(appointments).set({ status: 'cancelled', providerWriteState: null }).where(eq(appointments.id, row!.id));
 expect(await (await send(JSON.stringify({ args: aliases, call }))).json()).toEqual(confirmed);
 expect(writes).toHaveBeenCalledOnce(); expect(await db.select().from(appointments)).toHaveLength(1);
});
it.each(['accepted', 'rejected'])('webhook and authenticated cancellation beat an older %s POST response', async outcome => {
 const { a, c, input } = await fixture();
 let release!: () => void; let entered!: () => void; const started = new Promise<void>(r => { entered = r; });
 let metadata: Record<string, string>;
 create = async body => { metadata = body.metadata as Record<string, string>; entered(); await new Promise<void>(r => { release = r; }); return outcome === 'accepted' ? response({ uid: 'current', status: 'accepted', start, end, eventTypeId: 12, metadata }) : new Response('{}', { status: 422 }); };
 const pending = bookEmployeeAppointment(a, input); await started;
 await ingestCalcomWebhook(c.id, { uid: 'current', type: 'BOOKING_CANCELLED', status: 'cancelled', digest: 'f'.repeat(64), start, end, eventTypeId: 12, metadata: metadata! });
 const prior = vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation(async (...args) => String(args[0]).endsWith('/bookings/current') ? response({ uid: 'current', status: 'cancelled', start, end, eventTypeId: 12, metadata: metadata! }) : prior(...args));
 release(); expect(await pending).toEqual({ status: 'unknown' });
 expect((await db.select().from(appointments))[0]).toMatchObject({ status: 'cancelled', externalEventId: 'current', providerWriteState: null });
 expect(vi.mocked(fetch).mock.calls.some(args => String(args[0]).endsWith('/bookings/current'))).toBe(true);
});
