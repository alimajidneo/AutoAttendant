import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { calcomConnections, calcomWebhookReceipts } from '../src/db/schema.js';
import { createWorkspace } from '../src/repositories/workspaces.js';
import { createEmployee, getEmployee } from '../src/repositories/employees.js';
import { connectCalcom, getCalcomClient, listCalcomConnections, selectCalcomEventType, disconnectCalcom, ingestCalcomWebhook } from '../src/repositories/calcom.js';
import { env } from '../src/env.js';
const originalKey = env.TOKEN_ENCRYPTION_KEY;
beforeEach(() => { env.TOKEN_ENCRYPTION_KEY = '12'.repeat(32); vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 'success', data: { id: 123, email: 'sam@example.test', username: 'sam' } })))); });
afterEach(() => { env.TOKEN_ENCRYPTION_KEY = originalKey; vi.unstubAllGlobals(); });
async function fixture(owner = 'owner') { const a = (await createWorkspace(owner, `${owner}@example.test`, 'Test', 'UTC', 'team'))!.id; const e = await createEmployee(a, { displayName: 'Sam', timezone: 'UTC' }); return { a, e }; }
it('encrypts with tenant identity, never discloses credentials, and prevents cross-tenant access', async () => {
 const { a, e } = await fixture(), other = await fixture('other');
 const connection = await connectCalcom(a, e.id, 'PRIVATE_API_KEY');
 const [raw] = await db.select().from(calcomConnections).where(eq(calcomConnections.id, connection.id));
 expect(raw!.encryptedCredential).not.toContain('PRIVATE_API_KEY'); expect(raw!.encryptedCredential).toMatch(/\./);
 expect(JSON.stringify(await listCalcomConnections(a))).not.toMatch(/PRIVATE_API_KEY|encryptedCredential/);
 expect(await getCalcomClient(a, e.id, connection.id)).not.toBeNull();
 expect(await getCalcomClient(other.a, e.id, connection.id)).toBeNull();
 expect(await getCalcomClient(a, other.e.id, connection.id)).toBeNull();
 vi.mocked(fetch).mockClear(); await expect(connectCalcom(other.a, e.id, 'PRIVATE_API_KEY')).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});
it('denies client-role reads and writes on Cal.com credentials and receipts', async () => {
 const { a, e } = await fixture(); const connection = await connectCalcom(a, e.id, 'PRIVATE_API_KEY');
 for (const table of ['calcom_connections', 'calcom_webhook_receipts']) {
  await expect(db.transaction(async tx => {
   await tx.execute(sql`CREATE ROLE calcom_rls_test NOLOGIN`);
   await tx.execute(sql`GRANT USAGE ON SCHEMA public TO calcom_rls_test`);
   await tx.execute(sql.raw(`GRANT SELECT, INSERT ON ${table} TO calcom_rls_test`));
   await tx.execute(sql`SET LOCAL ROLE calcom_rls_test`);
   expect((await tx.execute(sql.raw(`SELECT * FROM ${table}`))).rows).toEqual([]);
   await tx.execute(sql.raw(table === 'calcom_connections'
    ? `INSERT INTO ${table} (agent_id, employee_id, encrypted_credential, provider_user_id, account_email, display_label) VALUES ('${a}', '${e.id}', 'denied', 'denied', 'denied@example.test', 'denied')`
    : `INSERT INTO ${table} (connection_id, digest, booking_uid, event_type) VALUES ('${connection.id}', '${'a'.repeat(64)}', 'denied', 'BOOKING_CREATED')`));
  })).rejects.toMatchObject({ cause: expect.objectContaining({ code: '42501' }) });
 }
});
it('cleans selected references on local disconnect and deduplicates durable receipts', async () => {
 const { a, e } = await fixture(); const c = await connectCalcom(a, e.id, 'PRIVATE_API_KEY');
 await selectCalcomEventType(a, e.id, c.id, { id: 12, slug: 'intro', title: 'Intro', lengthInMinutes: 30, bookingUrl: 'https://cal.com/sam/intro' });
 const event = { uid: 'booking', type: 'BOOKING_CREATED' as const, status: 'accepted' as const, digest: 'a'.repeat(64), eventTypeId: 12, start: '2026-09-14T10:00:00Z', end: '2026-09-14T10:30:00Z', metadata: {} };
 await Promise.all([ingestCalcomWebhook(c.id, event), ingestCalcomWebhook(c.id, event)]);
 expect(await db.select().from(calcomWebhookReceipts)).toHaveLength(1);
 vi.mocked(fetch).mockClear(); await disconnectCalcom(a, e.id, c.id); expect(fetch).not.toHaveBeenCalled();
 expect((await getEmployee(a, e.id))!.calendarPolicy).toEqual({ authority: 'direct', booking: null, conflicts: [] });
});
it('does not assign one provider identity to unrelated employees', async () => {
 const { a, e } = await fixture(); await connectCalcom(a, e.id, 'PRIVATE_API_KEY'); const other = await createEmployee(a, { displayName: 'Other', timezone: 'UTC' });
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 'success', data: { id: 123, email: 'sam@example.test', username: 'sam' } }))));
 await expect(connectCalcom(a, other.id, 'PRIVATE_API_KEY')).rejects.toThrow(); expect(await listCalcomConnections(a)).toHaveLength(1);
});
it('reconciles only a matching owned booking and retains an uncertain reservation', async () => {
 const { reserveEmployeeAppointment } = await import('../src/repositories/appointments.js');
 const { reconcileCalcomAppointment } = await import('../src/repositories/calcom.js');
 const { a, e } = await fixture(); const c = await connectCalcom(a, e.id, 'PRIVATE_API_KEY');
 const current = (await getEmployee(a, e.id))!;
 const input = { employeeId: e.id, expectedEmployeeUpdatedAt: current.updatedAt, callerName: 'Caller', startTime: new Date('2026-09-14T10:00:00Z'), endTime: new Date('2026-09-14T11:00:00Z'), externalCalendarId: 'calcom:12', externalCalendarConnectionId: c.id };
 const results = await Promise.all([reserveEmployeeAppointment(a, input), reserveEmployeeAppointment(a, input)]);
 expect(results.filter(Boolean)).toHaveLength(1); const appointment = results.find(Boolean)!;
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 'success', data: { id: 123, email: 'sam@example.test', username: 'sam' } }))));
 expect(await connectCalcom(a, e.id, 'ROTATED_PRIVATE_KEY')).toMatchObject({ id: c.id, status: 'active' });
 const data = { uid: 'uid', status: 'accepted', start: input.startTime.toISOString(), end: input.endTime.toISOString(), eventTypeId: 12, metadata: { agentId: a, employeeId: e.id, appointmentId: appointment.id } };
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 'success', data: { ...data, metadata: { ...data.metadata, employeeId: crypto.randomUUID() } } }))));
 expect(await reconcileCalcomAppointment(a, appointment.id, 'uid')).toBeNull();
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 'success', data }))));
 expect(await reconcileCalcomAppointment(a, appointment.id, 'uid')).toMatchObject({ status: 'confirmed', externalEventId: 'uid', providerWriteState: null });
 await expect(disconnectCalcom(a, e.id, c.id)).rejects.toThrow();
});

async function reserved() {
 const { reserveEmployeeAppointment } = await import('../src/repositories/appointments.js');
 const { a, e } = await fixture(); const c = await connectCalcom(a, e.id, 'PRIVATE_API_KEY');
 const current = (await getEmployee(a, e.id))!;
 const row = (await reserveEmployeeAppointment(a, { employeeId: e.id, expectedEmployeeUpdatedAt: current.updatedAt, callerName: 'Caller', startTime: new Date('2026-09-14T10:00:00Z'), endTime: new Date('2026-09-14T11:00:00Z'), externalCalendarId: 'calcom:12', externalCalendarConnectionId: c.id }))!;
 const event = { uid: 'first', type: 'BOOKING_CREATED' as const, status: 'accepted' as const, digest: 'b'.repeat(64), eventTypeId: 12, start: row.startTime!.toISOString(), end: row.endTime!.toISOString(), metadata: { agentId: a, employeeId: e.id, appointmentId: row.id } };
 return { a, e, c, row, event };
}
it('never replaces an established UID on late or different webhook delivery', async () => {
 const { appointments } = await import('../src/db/schema.js'); const { c, row, event } = await reserved();
 await ingestCalcomWebhook(c.id, event);
 await ingestCalcomWebhook(c.id, { ...event, uid: 'late', type: 'BOOKING_CANCELLED', status: 'cancelled', digest: 'c'.repeat(64) });
 const [saved] = await db.select().from(appointments).where(eq(appointments.id, row.id));
 expect(saved).toMatchObject({ externalEventId: 'first', status: 'requested', providerWriteState: 'reconciliation_required' });
});
it('records an official webhook without eventTypeId but does not mutate an appointment', async () => {
 const { appointments } = await import('../src/db/schema.js'); const { c, row, event } = await reserved();
 const standard = { ...event, eventTypeId: undefined };
 await ingestCalcomWebhook(c.id, standard);
 expect((await db.select().from(appointments).where(eq(appointments.id, row.id)))[0]).toMatchObject({ externalEventId: null, status: 'requested', providerWriteState: 'in_flight' });
 expect(await db.select().from(calcomWebhookReceipts)).toEqual([expect.objectContaining({ connectionId: c.id, digest: event.digest })]);
});
it.each(['agent', 'employee', 'start', 'end', 'eventType'])('ignores mismatched webhook %s', async mismatch => {
 const { appointments } = await import('../src/db/schema.js'); const { c, row, event } = await reserved();
 if (mismatch === 'agent') event.metadata.agentId = crypto.randomUUID();
 if (mismatch === 'employee') event.metadata.employeeId = crypto.randomUUID();
 if (mismatch === 'start') event.start = '2026-09-14T09:00:00Z';
 if (mismatch === 'end') event.end = '2026-09-14T12:00:00Z';
 if (mismatch === 'eventType') event.eventTypeId = 13;
 await ingestCalcomWebhook(c.id, event);
 expect((await db.select().from(appointments).where(eq(appointments.id, row.id)))[0]).toMatchObject({ externalEventId: null, providerWriteState: 'in_flight' });
});
it.each(['success', 'rejection'])('webhook wins against late provider %s finalization', async outcome => {
 const { finishEmployeeAppointment } = await import('../src/repositories/appointments.js'); const { a, c, row, event } = await reserved();
 await ingestCalcomWebhook(c.id, event);
 expect(await finishEmployeeAppointment(a, row.id, outcome === 'success' ? 'first' : null)).toBeNull();
});
it('uses validated supplied UID to repair a stale stored UID', async () => {
 const { reconcileCalcomAppointment } = await import('../src/repositories/calcom.js'); const { a, c, row, event } = await reserved();
 await ingestCalcomWebhook(c.id, event);
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 'success', data: { uid: 'correct', status: 'accepted', start: event.start, end: event.end, eventTypeId: 12, metadata: event.metadata } }))));
 expect(await reconcileCalcomAppointment(a, row.id, 'correct')).toMatchObject({ externalEventId: 'correct', status: 'confirmed' });
 expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain('/correct');
});
it('prunes receipts older than fourteen days during ingestion, retaining recent receipts', async () => {
 const { c, event } = await reserved();
 await db.insert(calcomWebhookReceipts).values([{ connectionId: c.id, digest: 'old', bookingUid: 'old', eventType: event.type, createdAt: new Date(Date.now() - 15 * 86400000) }, { connectionId: c.id, digest: 'recent', bookingUid: 'recent', eventType: event.type }]);
 await ingestCalcomWebhook(c.id, event);
 expect((await db.select().from(calcomWebhookReceipts)).map(r => r.digest).sort()).toEqual([event.digest, 'recent'].sort());
});
it('indexes receipt retention and forbids unused OAuth auth_kind', async () => {
 const { c } = await reserved();
 const indexes = await db.execute(sql`select indexdef from pg_indexes where tablename = 'calcom_webhook_receipts'`);
 expect(indexes.rows.map(r => r.indexdef).join(' ')).toContain('(connection_id, created_at)');
 await expect(db.update(calcomConnections).set({ authKind: 'oauth' as 'api_key' }).where(eq(calcomConnections.id, c.id))).rejects.toThrow();
});
it.each(['status', 'uid', 'connection', 'employee', 'eventType', 'interval'])('reconciliation cannot overwrite concurrent %s changes', async changed => {
 const { appointments } = await import('../src/db/schema.js'); const { reconcileCalcomAppointment } = await import('../src/repositories/calcom.js');
 const { a, e, row, event } = await reserved();
 let resume!: () => void; let read!: () => void;
 const started = new Promise<void>(resolve => { read = resolve; });
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => { read(); await new Promise<void>(resolve => { resume = resolve; }); return new Response(JSON.stringify({ status: 'success', data: { uid: 'current', status: 'accepted', start: event.start, end: event.end, eventTypeId: 12, metadata: event.metadata } })); }));
 const pending = reconcileCalcomAppointment(a, row.id, 'current'); await started;
 const other = changed === 'employee' ? await createEmployee(a, { displayName: 'Other', timezone: 'UTC' }) : e;
 const update = changed === 'status' ? { status: 'cancelled' as const, providerWriteState: null } : changed === 'uid' ? { externalEventId: 'different' } : changed === 'connection' ? { externalCalendarConnectionId: crypto.randomUUID() } : changed === 'employee' ? { employeeId: other.id } : changed === 'eventType' ? { externalCalendarId: 'calcom:13' } : { endTime: new Date('2026-09-14T12:00:00Z') };
 await db.update(appointments).set(update).where(eq(appointments.id, row.id)); resume();
 expect(await pending).toBeNull();
 expect((await db.select().from(appointments).where(eq(appointments.id, row.id)))[0]).toMatchObject(update);
});
it('reconciliation detects even a concurrent update that preserves all visible values', async () => {
 const { appointments } = await import('../src/db/schema.js'); const { reconcileCalcomAppointment } = await import('../src/repositories/calcom.js');
 const { a, row, event } = await reserved();
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
  await db.update(appointments).set({ updatedAt: row.updatedAt }).where(eq(appointments.id, row.id));
  return new Response(JSON.stringify({ status: 'success', data: { uid: 'current', status: 'accepted', start: event.start, end: event.end, eventTypeId: 12, metadata: event.metadata } }));
 }));
 expect(await reconcileCalcomAppointment(a, row.id, 'current')).toBeNull();
});
it.each(['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'] as const)('out-of-order %s cannot change a confirmed or cancelled booking', async type => {
 const { appointments } = await import('../src/db/schema.js'); const { finishEmployeeAppointment } = await import('../src/repositories/appointments.js');
 const { a, c, row, event } = await reserved(); await finishEmployeeAppointment(a, row.id, 'established');
 for (const status of ['confirmed', 'cancelled'] as const) {
  await db.update(appointments).set({ status, providerWriteState: null }).where(eq(appointments.id, row.id));
  await ingestCalcomWebhook(c.id, { ...event, type, status: type === 'BOOKING_CANCELLED' ? 'cancelled' : 'accepted', uid: 'late-different', digest: `${status}-${type}` });
  expect((await db.select().from(appointments).where(eq(appointments.id, row.id)))[0]).toMatchObject({ status, externalEventId: 'established', providerWriteState: null });
 }
});
it('does not associate webhook receipts with another connection or incomplete metadata', async () => {
 const { appointments } = await import('../src/db/schema.js'); const { c, row, event } = await reserved();
 const other = await fixture('other'); const connection = await connectCalcom(other.a, other.e.id, 'OTHER_KEY');
 await ingestCalcomWebhook(connection.id, event);
 await ingestCalcomWebhook(c.id, { ...event, digest: 'missing-metadata', metadata: { appointmentId: row.id } });
 expect((await db.select().from(appointments).where(eq(appointments.id, row.id)))[0]).toMatchObject({ externalEventId: null, providerWriteState: 'in_flight' });
});
it('scheduled retention deletes idle-connection receipts without requiring new deliveries', async () => {
 const { pruneCalcomWebhookReceipts } = await import('../src/repositories/calcom.js'); const { c, event } = await reserved();
 await db.insert(calcomWebhookReceipts).values({ connectionId: c.id, digest: 'idle', bookingUid: 'old', eventType: event.type, createdAt: new Date(Date.now() - 15 * 86400000) });
 await pruneCalcomWebhookReceipts(); expect(await db.select().from(calcomWebhookReceipts)).toEqual([]);
});
