import { env } from '../src/env.js';
import { expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { calls, appointments, retellWebhookReceipts } from '../src/db/schema.js';
import { createWorkspace } from '../src/repositories/workspaces.js';
import { createEmployee } from '../src/repositories/employees.js';
import * as repo from '../src/repositories/retell.js';
import { reserveEmployeeAppointment, finishEmployeeAppointment } from '../src/repositories/appointments.js';
import { createCall, listCalls, getCallById } from '../src/repositories/calls.js';
import { normalizeRetellEvent } from '../src/domain/retell.js';
const workspace = async () => { const id = (await createWorkspace(crypto.randomUUID(), 'test@example.test', 'Test', 'UTC', 'team'))!.id; return id; };
const approve = (id: string) => { env.RETELL_API_KEY = 'test-only'; env.RETELL_WORKSPACE_ID = id; env.RETELL_AGENT_ID = 'agent_a'; };
it('isolates mappings, enforces global uniqueness and ignores disabled or unknown agents', async () => {
  const a = await workspace(), b = await workspace(); approve(a);
  expect(await repo.saveRetellConnection(a, 'agent_a', true)).toBe(true);
  expect(await repo.saveRetellConnection(b, 'agent_a', true)).toBe(false);
  expect(await repo.getRetellConnection(b)).toBeNull();
  expect(await repo.resolveRetellWorkspace('agent_a')).toBe(a);
  await repo.saveRetellConnection(a, 'agent_a', false);
  expect(await repo.resolveRetellWorkspace('agent_a')).toBeNull();
  expect(await repo.resolveRetellWorkspace('missing')).toBeNull();
});
it('deduplicates concurrently and upserts one privacy-minimal call without touching legacy calls', async () => {
  const a = await workspace(); approve(a);
  await repo.saveRetellConnection(a, 'agent_a', true);
  const legacy = await createCall({ agentId: a, roomName: 'legacy', callerPhone: '+14155550123' });
  const event = normalizeRetellEvent({ event: 'call_ended', call: { agent_id: 'agent_a', call_id: 'call_a', call_status: 'ended', start_timestamp: 1789380000000, duration_ms: 60000, from_number: '+14155550123', transcript: 'SECRET', recording_url: 'SECRET', call_cost: { combined_cost: 12.5 } } })!;
  expect((await Promise.all(Array.from({ length: 6 }, () => repo.ingestRetellEvent(event)))).filter(Boolean)).toHaveLength(1);
  await repo.ingestRetellEvent({ ...event, values: { summary: 'duplicate must not win' } });
  await repo.ingestRetellEvent(normalizeRetellEvent({ event: 'call_analyzed', call: { agent_id: 'agent_a', call_id: 'call_a', call_analysis: { call_summary: 'Summary' }, duration_ms: 'bad' } })!);
  const rows = await db.select().from(calls);
  const row = rows.find(x => x.provider === 'retell')!;
  expect(row).toMatchObject({ callerPhone: '•••• 0123', durationMs: 60000, costCents: 12.5, summary: 'Summary', transcript: null, recordingKey: null, providerStatus: 'ended' });
  expect(rows.find(x => x.id === legacy.id)).toMatchObject({ provider: 'livekit', callerPhone: '+14155550123' });
  expect(await db.select().from(retellWebhookReceipts)).toHaveLength(2);
  expect(JSON.stringify(await db.select().from(retellWebhookReceipts))).not.toMatch(/SECRET|14155550123|Summary/);
  expect((await listCalls(a)).find(x => x.id === row.id)).toMatchObject({ provider: 'retell', durationMs: 60000, costCents: 12.5 });
  expect(await getCallById(row.id, await workspace())).toBeNull();
  expect(await getCallById(row.id, a)).toMatchObject({ provider: 'retell' });
});
it('does not persist unknown or disabled mappings', async () => {
  const event = normalizeRetellEvent({ event: 'call_started', call: { agent_id: 'absent', call_id: 'a' } })!;
  expect(await repo.ingestRetellEvent(event)).toBe(false);
  await repo.saveRetellConnection(await workspace(), 'absent', false);
  expect(await repo.ingestRetellEvent(event)).toBe(false);
  expect(await db.select().from(calls)).toEqual([]);
  expect(await db.select().from(retellWebhookReceipts)).toEqual([]);
});
it('denies client reads and writes on both Retell tables', async () => {
  const a = await workspace(); approve(a);
  await repo.saveRetellConnection(a, 'agent_a', true);
  for (const table of ['retell_connections', 'retell_webhook_receipts']) {
    await expect(db.transaction(async tx => {
      await tx.execute(sql`CREATE ROLE retell_rls_test NOLOGIN`);
      await tx.execute(sql`GRANT USAGE ON SCHEMA public TO retell_rls_test`);
      await tx.execute(sql.raw(`GRANT SELECT, INSERT ON ${table} TO retell_rls_test`));
      await tx.execute(sql`SET LOCAL ROLE retell_rls_test`);
      expect((await tx.execute(sql.raw(`SELECT * FROM ${table}`))).rows).toEqual([]);
      await tx.execute(sql.raw(table === 'retell_connections'
        ? `INSERT INTO ${table} (agent_id, retell_agent_id) VALUES ('${a}', 'denied')`
        : `INSERT INTO ${table} (agent_id, dedup_key, event, call_id) VALUES ('${a}', 'denied', 'call_started', 'call')`));
    })).rejects.toMatchObject({ cause: expect.objectContaining({ code: '42501' }) });
  }
});
it('atomically excludes overlapping employee reservations, permits adjacent and legacy bookings, and cancels failures', async () => {
  const a = await workspace(), b = await workspace(); approve(a);
  const employee = await createEmployee(a, { displayName: 'Sam', timezone: 'UTC' });
  const input = { employeeId: employee.id, expectedEmployeeUpdatedAt: employee.updatedAt, callerName: 'Caller', startTime: new Date('2026-09-14T10:00:00Z'), endTime: new Date('2026-09-14T11:00:00Z'), externalCalendarId: 'book', externalCalendarConnectionId: null };
  const results = await Promise.all(Array.from({ length: 8 }, () => reserveEmployeeAppointment(a, input)));
  expect(results.filter(Boolean)).toHaveLength(1);
  const winner = results.find(Boolean)!;
  await finishEmployeeAppointment(a, winner.id, null);
  expect((await db.select().from(appointments).where(eq(appointments.id, winner.id)))[0]).toMatchObject({ status: 'cancelled', externalEventId: null });
  const next = await reserveEmployeeAppointment(a, input);
  expect(next).toBeTruthy();
  await finishEmployeeAppointment(a, next!.id, 'event');
  expect(await reserveEmployeeAppointment(a, input)).toBeNull();
  expect(await reserveEmployeeAppointment(a, { ...input, startTime: input.endTime, endTime: new Date('2026-09-14T12:00:00Z') })).toBeTruthy();
  expect(await reserveEmployeeAppointment(b, input)).toBeNull();
  await db.insert(appointments).values({ agentId: a, serviceName: 'Legacy', status: 'confirmed', startTime: input.startTime, endTime: input.endTime });
  expect((await db.select().from(appointments)).filter(x => !x.employeeId)).toHaveLength(1);
});

it('does not regress a finished call when an earlier lifecycle event arrives late', async () => {
  const a = await workspace(); approve(a); await repo.saveRetellConnection(a, 'agent_a', true);
  for (const [event, status] of [['call_ended', 'ended'], ['call_started', 'ongoing']]) await repo.ingestRetellEvent(normalizeRetellEvent({ event, call: { agent_id: 'agent_a', call_id: 'late', call_status: status } })!);
  expect((await listCalls(a))[0]).toMatchObject({ providerStatus: 'ended' });
});
it('rejects stale environment bindings and cross-workspace claims on every ingestion', async () => {
  const a = await workspace(), b = await workspace(); approve(a);
  await repo.saveRetellConnection(a, 'agent_a', true);
  expect(await repo.saveRetellConnection(b, 'agent_a', true)).toBe(false);
  env.RETELL_WORKSPACE_ID = b;
  expect(await repo.resolveRetellWorkspace('agent_a')).toBeNull();
  expect(await repo.ingestRetellEvent(normalizeRetellEvent({ event: 'call_started', call: { agent_id: 'agent_a', call_id: 'stale' } })!)).toBe(false);
  expect(await db.select().from(calls)).toEqual([]);
});
it('orders two transfer attempts and preserves specific outcomes through duplicates and late delivery', async () => {
  const a = await workspace(); approve(a); await repo.saveRetellConnection(a, 'agent_a', true);
  const deliver = (event: string, start_timestamp: number) => repo.ingestRetellEvent(normalizeRetellEvent({ event, start_timestamp, call: { agent_id: 'agent_a', call_id: 'transfer' } })!);
  await deliver('transfer_bridged', 100);
  expect(await deliver('transfer_bridged', 100)).toBe(false);
  await deliver('transfer_started', 100);
  expect((await db.select().from(calls))[0]).toMatchObject({ transferStatus: 'bridged', outcome: 'answered', transferAttemptStartedAt: 100 });
  await deliver('transfer_cancelled', 100);
  expect((await db.select().from(calls))[0]).toMatchObject({ transferStatus: 'bridged' });
  await deliver('transfer_ended', 100);
  expect((await db.select().from(calls))[0]).toMatchObject({ transferStatus: 'ended' });
  await deliver('transfer_started', 200); await deliver('transfer_ended', 99);
  expect((await db.select().from(calls))[0]).toMatchObject({ transferStatus: 'started', transferAttemptStartedAt: 200 });
  await repo.markRetellCallOutcome(a, 'agent_a', 'transfer', 'booked');
  await deliver('transfer_bridged', 200);
  expect((await db.select().from(calls))[0]).toMatchObject({ outcome: 'booked', transferStatus: 'bridged' });
});
it('replays completed messages and stores no receipt payload', async () => {
  const a = await workspace(); approve(a); await repo.saveRetellConnection(a, 'agent_a', true);
  const result = await repo.saveRetellMessage(a, 'agent_a', 'message', { message: 'Please call back' });
  expect(result).toMatchObject({ saved: true, messageId: expect.any(String) });
  expect(await repo.saveRetellMessage(a, 'agent_a', 'message', { message: 'Please call back' })).toEqual(result);
  expect((await db.select().from(calls))[0]).toMatchObject({ providerCallId: 'message', outcome: 'escalated', transcript: null, callerId: null });
  expect(JSON.stringify(await db.select().from(retellWebhookReceipts))).not.toContain('Please call back');
});
