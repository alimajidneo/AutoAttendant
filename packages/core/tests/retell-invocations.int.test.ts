import { expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { calls, escalations } from '../src/db/schema.js';
import { createWorkspace } from '../src/repositories/workspaces.js';
import { env } from '../src/env.js';
import * as repo from '../src/repositories/retell.js';
async function fixture() {
 const a = (await createWorkspace(crypto.randomUUID(), 'test@example.test', 'Test', 'UTC', 'team'))!.id;
 env.RETELL_API_KEY = 'test'; env.RETELL_WORKSPACE_ID = a; env.RETELL_AGENT_ID = 'agent';
 await repo.saveRetellConnection(a, 'agent', true); return a;
}
it('durably returns the exact completed result and never repeats the callback', async () => {
 const a = await fixture(); let writes = 0;
 const execute = async () => { writes++; return { status: 'confirmed', appointmentId: crypto.randomUUID() }; };
 const first = await repo.runRetellFunction(a, 'agent', 'call', 'book-appointment', 'a'.repeat(64), 'tool-1', execute);
 expect(await repo.runRetellFunction(a, 'agent', 'call', 'book-appointment', 'a'.repeat(64), 'tool-1', execute)).toEqual(first);
 expect(writes).toBe(1);
 const rows = (await db.execute(sql`SELECT * FROM retell_function_invocations`)).rows;
 expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ state: 'completed', result: first });
});
it('atomically commits a message and result under concurrent replay', async () => {
 const a = await fixture();
 const results = await Promise.all(Array.from({ length: 4 }, () => repo.saveRetellMessage(a, 'agent', 'call', { message: 'Please call back' }, 'b'.repeat(64), 'message-1')));
 expect(results.every(r => JSON.stringify(r) === JSON.stringify(results[0]))).toBe(true);
 expect(await db.select().from(escalations)).toHaveLength(1);
 expect((await db.select().from(calls))[0]).toMatchObject({ outcome: 'escalated' });
 const rows = (await db.execute(sql`SELECT * FROM retell_function_invocations`)).rows;
 expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ state: 'completed', result: results[0] });
 expect(JSON.stringify(rows)).not.toContain('Please call back');
});
it('preserves booked outcome when a later message is saved', async () => {
 const a = await fixture();
 await repo.markRetellCallOutcome(a, 'agent', 'call', 'booked');
 expect(await repo.saveRetellMessage(a, 'agent', 'call', { message: 'Please send details' }, 'e'.repeat(64))).toMatchObject({ saved: true });
 expect((await db.select().from(calls).where(eq(calls.agentId, a)))[0]).toMatchObject({ outcome: 'booked' });
});
it('rolls back message mutation and claim together when final result storage fails', async () => {
 const a = await fixture();
 await db.execute(sql`CREATE OR REPLACE FUNCTION reject_invocation_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$`);
 await db.execute(sql`CREATE TRIGGER reject_invocation_result BEFORE UPDATE ON retell_function_invocations FOR EACH ROW EXECUTE FUNCTION reject_invocation_result()`);
 try {
  await expect(repo.saveRetellMessage(a, 'agent', 'call', { message: 'Rollback' }, 'c'.repeat(64))).rejects.toThrow();
  expect(await db.select().from(escalations)).toEqual([]);
  expect(await db.select().from(calls).where(eq(calls.agentId, a))).toEqual([]);
  expect((await db.execute(sql`SELECT * FROM retell_function_invocations`)).rows).toEqual([]);
 } finally {
  await db.execute(sql`DROP TRIGGER reject_invocation_result ON retell_function_invocations`);
  await db.execute(sql`DROP FUNCTION reject_invocation_result()`);
 }
 expect(await repo.saveRetellMessage(a, 'agent', 'call', { message: 'Rollback' }, 'c'.repeat(64))).toMatchObject({ saved: true });
});

it('never retries exceptions, unknown results, invalid/unbounded results or conflicting stable IDs', async () => {
 const a = await fixture();
 for (const outcome of ['throw', 'unknown', 'oversized', 'raw'] as const) {
  let writes = 0;
  const execute = async () => {
   writes++;
   if (outcome === 'throw') throw new Error('PRIVATE PROVIDER BODY');
   if (outcome === 'unknown') return { status: 'unknown' };
   if (outcome === 'raw') return { status: 'confirmed', transcript: 'PRIVATE' };
   return { status: 'contact_required', reason: 'PRIVATE'.repeat(2000) };
  };
  expect(await repo.runRetellFunction(a, 'agent', outcome, 'book-appointment', 'a'.repeat(64), 'tool', execute)).toEqual({ status: 'unknown', reason: 'reconciliation_required' });
  await repo.runRetellFunction(a, 'agent', outcome, 'book-appointment', 'b'.repeat(64), 'tool', execute);
  await repo.runRetellFunction(a, 'agent', outcome, 'book-appointment', 'a'.repeat(64), 'tool', execute);
  expect(writes).toBe(1);
 }
 const rows = (await db.execute(sql`SELECT * FROM retell_function_invocations`)).rows;
 expect(rows.every(r => r.state === 'uncertain' && r.result === null)).toBe(true);
 expect(JSON.stringify(rows)).not.toContain('PRIVATE');
});
it('a stale processing crash enters uncertain recovery without executing the callback', async () => {
 const a = await fixture(); let key = '';
 await repo.runRetellFunction(a, 'agent', 'call', 'book-appointment', 'a'.repeat(64), undefined, async k => { key = k; return { status: 'unavailable' }; });
 await db.execute(sql`UPDATE retell_function_invocations SET state='processing', result=NULL, updated_at=now()-interval '25 hours' WHERE key=${key}`);
 let writes = 0;
 expect(await repo.runRetellFunction(a, 'agent', 'call', 'book-appointment', 'a'.repeat(64), undefined, async () => { writes++; return { status: 'confirmed' }; })).toEqual({ status: 'unknown', reason: 'reconciliation_required' });
 expect(writes).toBe(0);
 expect((await db.execute(sql`SELECT state FROM retell_function_invocations WHERE key=${key}`)).rows[0]).toEqual({ state: 'uncertain' });
});
it('preserves old claim-only receipt boundaries even when newer canonicalization changes the hash', async () => {
 const a = await fixture(); let writes = 0;
 await db.execute(sql`INSERT INTO retell_webhook_receipts (dedup_key, agent_id, event, call_id) VALUES ('legacy-key', ${a}, 'book-appointment', 'legacy-call')`);
 expect(await repo.runRetellFunction(a, 'agent', 'legacy-call', 'book-appointment', 'd'.repeat(64), 'new-tool-id', async () => { writes++; return { status: 'confirmed' }; })).toEqual({ status: 'unknown', reason: 'reconciliation_required' });
 expect(writes).toBe(0);
});
it('isolates tenants, permits distinct tool IDs, and replays concurrently without a second callback', async () => {
 const a = await fixture(); let release!: () => void; let entered!: () => void;
 const started = new Promise<void>(r => { entered = r; });
 let writes = 0;
 const execute = async () => { writes++; entered(); await new Promise<void>(r => { release = r; }); return { status: 'unavailable' }; };
 const first = repo.runRetellFunction(a, 'agent', 'call', 'book-appointment', 'a'.repeat(64), 'one', execute);
 await started;
 try {
  expect(await repo.runRetellFunction(a, 'agent', 'call', 'book-appointment', 'a'.repeat(64), 'one', execute)).toMatchObject({ status: 'unknown' });
  expect(await repo.runRetellFunction(crypto.randomUUID(), 'agent', 'call', 'book-appointment', 'a'.repeat(64), 'one', execute)).toMatchObject({ status: 'unknown' });
 } finally { release(); }
 expect(await first).toEqual({ status: 'unavailable' }); expect(writes).toBe(1);
 expect(await repo.runRetellFunction(a, 'agent', 'call', 'book-appointment', 'b'.repeat(64), 'one', async () => { throw new Error('must not execute'); })).toMatchObject({ status: 'unknown' });
 expect(await repo.runRetellFunction(a, 'agent', 'call', 'book-appointment', 'a'.repeat(64), 'two', async () => ({ status: 'contact_required' }))).toEqual({ status: 'contact_required' });
});
it('enforces bounded result states and denies client access to invocations', async () => {
 const a = await fixture();
 await repo.runRetellFunction(a, 'agent', 'call', 'book-appointment', 'a'.repeat(64), undefined, async () => ({ status: 'unavailable' }));
 await expect(db.execute(sql`UPDATE retell_function_invocations SET state='invalid'`)).rejects.toThrow();
 await expect(db.execute(sql`UPDATE retell_function_invocations SET result=NULL`)).rejects.toThrow();
 await expect(db.execute(sql`UPDATE retell_function_invocations SET result=jsonb_build_object('value', repeat('x',8192))`)).rejects.toThrow();
 await expect(db.transaction(async tx => {
  await tx.execute(sql`CREATE ROLE invocation_reader NOLOGIN`);
  await tx.execute(sql`GRANT USAGE ON SCHEMA public TO invocation_reader`);
  await tx.execute(sql`GRANT SELECT, INSERT ON retell_function_invocations TO invocation_reader`);
  await tx.execute(sql`SET LOCAL ROLE invocation_reader`);
  expect((await tx.execute(sql`SELECT * FROM retell_function_invocations`)).rows).toEqual([]);
  await tx.execute(sql`INSERT INTO retell_function_invocations (key,agent_id,call_id,name,semantic_hash) VALUES (${'b'.repeat(64)},${a},'denied','save-message',${'b'.repeat(64)})`);
 })).rejects.toMatchObject({ cause: expect.objectContaining({ code: '42501' }) });
});
it('does not require an extra pool connection inside a message transaction', async () => {
 const a = await fixture();
 const results = await Promise.all(Array.from({ length: env.DATABASE_POOL_MAX + 2 }, (_, i) =>
  repo.saveRetellMessage(a, 'agent', `call-${i}`, { message: 'Independent message' }, 'a'.repeat(64))));
 expect(results.every(result => result.saved === true)).toBe(true);
}, 20_000);
