import { createHash } from 'node:crypto';
import { z } from 'zod';
import { env } from '../env.js';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appointments, calls, escalations, retellFunctionInvocations, retellConnections, retellWebhookReceipts } from '../db/schema.js';
import type { normalizeRetellEvent } from '../domain/retell.js';

export async function getRetellConnection(agentId: string) {
  const [row] = await db.select({ retellAgentId: retellConnections.retellAgentId, enabled: retellConnections.enabled })
    .from(retellConnections).where(eq(retellConnections.agentId, agentId)).limit(1);
  return row ?? null;
}
export async function saveRetellConnection(agentId: string, retellAgentId: string, enabled: boolean) {
  if (enabled && !retellBindingApproved(agentId, retellAgentId)) return false;
  try {
    await db.insert(retellConnections).values({ agentId, retellAgentId, enabled }).onConflictDoUpdate({
      target: retellConnections.agentId, set: { retellAgentId, enabled, updatedAt: new Date() },
    });
    return true;
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === '23505') return false;
    throw error;
  }
}
export function retellBindingApproved(agentId: string, retellAgentId: string) {
  return !!env.RETELL_API_KEY && agentId === env.RETELL_WORKSPACE_ID && retellAgentId === env.RETELL_AGENT_ID;
}
export async function resolveRetellWorkspace(retellAgentId: string, executor: Executor = db) {
  const [row] = await executor.select({ agentId: retellConnections.agentId }).from(retellConnections)
    .where(and(eq(retellConnections.retellAgentId, retellAgentId), eq(retellConnections.enabled, true))).limit(1);
  return row && retellBindingApproved(row.agentId, retellAgentId) ? row.agentId : null;
}
export async function ingestRetellEvent(event: NonNullable<ReturnType<typeof normalizeRetellEvent>>) {
  return db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout = '3000ms'`);
    await tx.execute(sql`SET LOCAL lock_timeout = '2000ms'`);
    const [mapping] = await tx.select().from(retellConnections).where(and(
      eq(retellConnections.retellAgentId, event.retellAgentId), eq(retellConnections.enabled, true))).for('share');
    if (!mapping || !retellBindingApproved(mapping.agentId, event.retellAgentId)) return false;
    const inserted = await tx.insert(retellWebhookReceipts).values({ agentId: mapping.agentId,
      dedupKey: event.dedupKey, callId: event.callId, event: event.event }).onConflictDoNothing().returning({ key: retellWebhookReceipts.dedupKey });
    if (!inserted.length) return false;
    const attempt = event.values.transferAttemptStartedAt;
    const advances = attempt === undefined ? sql`false` : sql`(
      ${calls.transferAttemptStartedAt} IS NULL
      OR ${attempt} > ${calls.transferAttemptStartedAt}
      OR (${attempt} = ${calls.transferAttemptStartedAt} AND (
        (${calls.transferStatus} = 'started' AND ${event.values.transferStatus} IN ('bridged', 'cancelled', 'ended'))
        OR (${calls.transferStatus} IN ('bridged', 'cancelled') AND ${event.values.transferStatus} = 'ended')
      ))
    )`;
    await tx.insert(calls).values({ agentId: mapping.agentId, provider: 'retell', providerCallId: event.callId,
      retellAgentId: event.retellAgentId, roomName: `retell:${event.callId}`, ...event.values })
      .onConflictDoUpdate({ target: calls.providerCallId, targetWhere: sql`${calls.provider} = 'retell'`,
        set: { ...event.values, providerCallId: event.callId,
          ...(attempt !== undefined ? {
            transferAttemptStartedAt: sql`CASE WHEN ${advances} THEN ${attempt} ELSE ${calls.transferAttemptStartedAt} END`,
            transferStatus: sql`CASE WHEN ${advances} THEN ${event.values.transferStatus} ELSE ${calls.transferStatus} END`,
          } : {}),
          ...(event.values.outcome ? { outcome: sql`CASE WHEN ${calls.outcome} IN ('booked', 'escalated') OR (${attempt !== undefined} AND NOT ${advances}) THEN ${calls.outcome} ELSE ${event.values.outcome} END` } : {}),
          ...(event.values.providerStatus ? { providerStatus: sql`CASE WHEN ${calls.providerStatus} IN ('ended', 'error', 'not_connected') AND ${event.values.providerStatus} IN ('registered', 'ongoing') THEN ${calls.providerStatus} ELSE ${event.values.providerStatus} END` } : {}),
        },
        setWhere: eq(calls.agentId, mapping.agentId) });
    return true;
  });
}

async function ensureRetellCall(agentId: string, retellAgentId: string, callId: string, executor: Executor = db) {
  if (await resolveRetellWorkspace(retellAgentId, executor) !== agentId) throw new Error('Binding unavailable');
  const [row] = await executor.insert(calls).values({ agentId, provider: 'retell', providerCallId: callId,
    retellAgentId, roomName: `retell:${callId}` }).onConflictDoUpdate({
    target: calls.providerCallId, targetWhere: sql`${calls.provider} = 'retell'`,
    set: { providerCallId: callId }, setWhere: eq(calls.agentId, agentId),
  }).returning({ id: calls.id });
  if (!row) throw new Error('Call unavailable');
  return row.id;
}
export async function markRetellCallOutcome(agentId: string, retellAgentId: string, callId: string, outcome: 'booked' | 'escalated') {
  const id = await ensureRetellCall(agentId, retellAgentId, callId);
  await db.update(calls).set({ outcome }).where(and(eq(calls.agentId, agentId), eq(calls.id, id)));
}
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
const uncertain = { status: 'unknown', reason: 'reconciliation_required' } as const;
const bookingResult = z.object({
 status: z.enum(['confirmed', 'unknown', 'unavailable', 'contact_required', 'confirmation_required', 'use_calcom']),
 appointmentId: z.string().uuid().optional(), reason: z.string().max(500).optional(),
 eventType: z.string().max(200).nullable().optional(), bookingUrl: z.string().url().max(2048).nullable().optional(),
}).strict();
function invocationKey(agentId: string, callId: string, name: string, hash: string, invocationId?: string) {
 if (!/^[a-f0-9]{64}$/.test(hash) || (invocationId !== undefined && !/^[a-zA-Z0-9_-]{1,200}$/.test(invocationId))) throw new Error('Invalid invocation identity');
 return createHash('sha256').update(JSON.stringify([agentId, callId, name, invocationId ? ['id', invocationId] : ['hash', hash]])).digest('hex');
}
async function claimInvocation(executor: Executor, agentId: string, callId: string, name: string, hash: string, invocationId?: string) {
 const key = invocationKey(agentId, callId, name, hash, invocationId);
 // Old claim-only receipts cannot prove success. Retain their no-retry boundary.
 const [legacy] = await executor.select().from(retellWebhookReceipts).where(and(eq(retellWebhookReceipts.agentId, agentId), eq(retellWebhookReceipts.callId, callId), eq(retellWebhookReceipts.event, name))).limit(1);
 const [inserted] = await executor.insert(retellFunctionInvocations).values({ key, agentId, callId, name, semanticHash: hash, state: legacy ? 'uncertain' : 'processing' }).onConflictDoNothing().returning();
 const [row] = inserted ? [inserted] : await executor.select().from(retellFunctionInvocations).where(eq(retellFunctionInvocations.key, key)).limit(1);
 return { key, fresh: !!inserted && !legacy, row: row! };
}
export async function runRetellFunction(agentId: string, retellAgentId: string, callId: string, name: 'book-appointment', hash: string, invocationId: string | undefined, execute: (key: string) => Promise<unknown>): Promise<Record<string, unknown>> {
 if (await resolveRetellWorkspace(retellAgentId) !== agentId) return uncertain;
 const claim = await claimInvocation(db, agentId, callId, name, hash, invocationId);
 if (!claim.fresh) {
  if (claim.row.semanticHash === hash && claim.row.state === 'completed') return claim.row.result!;
  // Never infer provider absence from age. After 24h, fence late finalization and
  // expose the existing reservation recovery workflow; never re-execute the tool.
  await db.transaction(async tx => {
   const [stale] = await tx.update(retellFunctionInvocations).set({ state: 'uncertain', updatedAt: new Date() }).where(and(
    eq(retellFunctionInvocations.key, claim.key), sql`${retellFunctionInvocations.state} <> 'completed'`,
    sql`${retellFunctionInvocations.updatedAt} < now() - interval '24 hours'`)).returning();
   if (stale?.appointmentId) await tx.update(appointments).set({ providerWriteState: 'reconciliation_required', updatedAt: new Date() }).where(and(
    eq(appointments.id, stale.appointmentId), eq(appointments.agentId, agentId), eq(appointments.status, 'requested')));
  });
  return uncertain;
 }
 try {
  const result = bookingResult.parse(await execute(claim.key));
  if (result.status === 'unknown') {
   await db.update(retellFunctionInvocations).set({ state: 'uncertain', updatedAt: new Date() }).where(eq(retellFunctionInvocations.key, claim.key));
   return uncertain;
  }
  await db.update(retellFunctionInvocations).set({ state: 'completed', result, updatedAt: new Date() }).where(eq(retellFunctionInvocations.key, claim.key));
  return result;
 } catch {
  await db.update(retellFunctionInvocations).set({ state: 'uncertain', updatedAt: new Date() }).where(eq(retellFunctionInvocations.key, claim.key));
  return uncertain;
 }
}
export async function saveRetellMessage(agentId: string, retellAgentId: string, callId: string, args: { message: string; callerName?: string; callerPhone?: string }, hash?: string, invocationId?: string): Promise<Record<string, unknown>> {
 if (await resolveRetellWorkspace(retellAgentId) !== agentId) throw new Error('Binding unavailable');
 const semanticHash = hash ?? createHash('sha256').update(JSON.stringify(args)).digest('hex');
 return db.transaction(async tx => {
  const claim = await claimInvocation(tx, agentId, callId, 'save-message', semanticHash, invocationId);
  if (!claim.fresh) return claim.row.semanticHash === semanticHash && claim.row.state === 'completed' ? claim.row.result! : uncertain;
  const id = await ensureRetellCall(agentId, retellAgentId, callId, tx);
  const [inserted] = await tx.insert(escalations).values({ agentId, callId: id, question: args.message,
   callerName: args.callerName, callerPhone: args.callerPhone ?? null, transcriptExcerpt: null }).onConflictDoNothing().returning();
  const [existing] = inserted ? [inserted] : await tx.select().from(escalations).where(and(eq(escalations.agentId, agentId), eq(escalations.callId, id), sql`lower(${escalations.question}) = lower(${args.message})`)).limit(1);
  if (!existing) throw new Error('Message unavailable');
  await tx.update(calls).set({ outcome: sql`CASE WHEN ${calls.outcome} = 'booked' THEN ${calls.outcome} ELSE 'escalated' END` }).where(and(eq(calls.agentId, agentId), eq(calls.id, id)));
  const result = { saved: true, messageId: existing.id };
  await tx.update(retellFunctionInvocations).set({ state: 'completed', result, updatedAt: new Date() }).where(eq(retellFunctionInvocations.key, claim.key));
  return result;
 });
}
