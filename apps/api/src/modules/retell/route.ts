import { createHash } from 'node:crypto';
import { requireCalendarOwner } from '../../middleware/calendar-owner.js';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../types.js';
import { env } from '@receptionist/core/env.js';
import { verifyRetellSignature, normalizeRetellEvent } from '@receptionist/core/domain/retell.js';
import * as repo from '@receptionist/core/repositories/retell.js';
import { lookupEmployees, getEmployee, resolveEmployeeTransferDestination } from '@receptionist/core/repositories/employees.js';
import { checkEmployeeAvailability, bookEmployeeAppointment } from '@receptionist/core/providers/employee-calendar.js';

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);
const connection = z.object({ retellAgentId: identifier, enabled: z.boolean() }).strict();
const selectedEmployee = z.object({ employeeId: z.string().uuid() }).strict();
const interval = selectedEmployee.extend({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }) });
const bounded = (input: { start: string; end: string }) => {
  const duration = Date.parse(input.end) - Date.parse(input.start);
  return duration >= 300000 && duration <= 28800000;
};
const booking = interval.extend({ caller_confirmed: z.boolean().optional(), callerConfirmed: z.boolean().optional(), caller_email: z.string().max(254).optional(), caller_phone: z.string().max(30).optional(), callerEmail: z.string().max(254).optional(), callerName: z.string().trim().min(1).max(100),
  callerPhone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(), purpose: z.string().trim().min(1).max(300).optional() }).strict().refine(bounded).refine(v =>
 (v.caller_confirmed === undefined || v.callerConfirmed === undefined || v.caller_confirmed === v.callerConfirmed)
 && (v.caller_email === undefined || v.callerEmail === undefined || v.caller_email.trim().toLowerCase() === v.callerEmail.trim().toLowerCase())
 && (v.caller_phone === undefined || v.callerPhone === undefined || v.caller_phone.trim() === v.callerPhone.trim())
).transform(v => ({ employeeId: v.employeeId.toLowerCase(), start: new Date(v.start).toISOString(), end: new Date(v.end).toISOString(),
 callerName: v.callerName.replace(/\s+/g, ' '), callerEmail: (v.caller_email ?? v.callerEmail)?.trim().toLowerCase() || undefined,
 callerPhone: (v.caller_phone ?? v.callerPhone)?.trim() || undefined, purpose: v.purpose?.replace(/\s+/g, ' '),
 callerConfirmed: v.caller_confirmed ?? v.callerConfirmed ?? false }));
const lookup = z.object({ name: z.string().trim().min(1).max(80).optional(), department: z.string().trim().min(1).max(80).optional() }).strict();
const message = z.object({
  message: z.string().trim().min(1).max(1000),
  callerName: z.string().trim().max(100).optional(),
  callerPhone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  caller_confirmed: z.boolean().optional(),
  callerConfirmed: z.boolean().optional(),
}).strict().refine(v => v.caller_confirmed === undefined || v.callerConfirmed === undefined || v.caller_confirmed === v.callerConfirmed)
  .transform(v => ({ message: v.message, callerName: v.callerName, callerPhone: v.callerPhone,
    callerConfirmed: v.caller_confirmed ?? v.callerConfirmed ?? false }));
const envelope = z.object({ call: z.object({ agent_id: identifier, call_id: identifier }), args: z.unknown(),
 tool_call_id: identifier.optional(), invocation_id: identifier.optional() })
 .refine(v => !v.tool_call_id || !v.invocation_id || v.tool_call_id === v.invocation_id);
function normalizeSemanticText(args: unknown) {
 if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
 return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, typeof value === 'string' ? value.normalize('NFC') : value]));
}
type RetellEnv = { Variables: { payload: unknown; args: unknown; agentId: string; retellAgentId: string; callId: string; invocationId: string | undefined; bookingDeadlineAt: number } };
const RETELL_BOOKING_BUDGET_MS = 45_000;
function parseJson(raw: string): unknown { try { return JSON.parse(raw); } catch { return undefined; } }
async function readBoundedBody(request: Request) {
 const reader = request.body?.getReader();
 if (!reader) return '';
 const chunks: Uint8Array[] = []; let size = 0;
 for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  size += value.byteLength;
  if (size > 262144) { await reader.cancel(); return null; }
  chunks.push(value);
 }
 return Buffer.concat(chunks, size).toString('utf8');
}
export const retell = new Hono<RetellEnv>()
  .onError((_error, c) => c.json({ error: 'Request unavailable' }, 503))
  .use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const bookingDeadlineAt = Date.now() + RETELL_BOOKING_BUDGET_MS;
    c.set('bookingDeadlineAt', bookingDeadlineAt);
    const handle = async () => {
      const raw = await readBoundedBody(c.req.raw);
      if (raw === null) return c.json({ error: 'Payload too large' }, 413);
      if (!verifyRetellSignature(raw, env.RETELL_API_KEY ?? '', c.req.header('x-retell-signature') ?? '', Date.now())) return c.json({ error: 'Unauthorized' }, 401);
      const payload = parseJson(raw);
      if (payload === undefined) return c.json({ error: 'Invalid payload' }, 400);
      c.set('payload', payload);
      await next();
    };
    if (!c.req.path.endsWith('/functions/book-appointment')) return handle();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        handle(),
        new Promise<Response>(resolve => { timer = setTimeout(() => resolve(c.json({ status: 'unknown', reason: 'request_deadline_exceeded' })), Math.max(1, bookingDeadlineAt - Date.now())); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  })
  .post('/webhook', async c => {
    const event = normalizeRetellEvent(c.get('payload'));
    if (event) await repo.ingestRetellEvent(event);
    return c.body(null, 204);
  })
  .use('/functions/*', async (c, next) => {
    const parsed = envelope.safeParse(c.get('payload'));
    if (!parsed.success) return c.json({ error: 'Invalid payload' }, 400);
    const agentId = await repo.resolveRetellWorkspace(parsed.data.call.agent_id);
    if (!agentId) return c.body(null, 204);
    c.set('retellAgentId', parsed.data.call.agent_id); c.set('callId', parsed.data.call.call_id);
    c.set('agentId', agentId); c.set('args', normalizeSemanticText(parsed.data.args));
    c.set('invocationId', parsed.data.tool_call_id ?? parsed.data.invocation_id);
    await next();
  })
  .post('/functions/lookup-employee', async c => {
    const args = lookup.safeParse(c.get('args'));
    if (!args.success) return c.json({ error: 'Invalid arguments' }, 400);
    return c.json({ candidates: await lookupEmployees(c.get('agentId'), args.data) });
  })
  .post('/functions/check-availability', async c => {
    const args = interval.strict().refine(bounded).safeParse(c.get('args'));
    if (!args.success) return c.json({ error: 'Invalid arguments' }, 400);
    return c.json(await checkEmployeeAvailability(c.get('agentId'), args.data));
  })
  .post('/functions/resolve-transfer', async c => {
    const args = selectedEmployee.safeParse(c.get('args'));
    if (!args.success) return c.json({ error: 'Invalid arguments' }, 400);
    const agentId = c.get('agentId'), employee = await getEmployee(agentId, args.data.employeeId);
    if (!employee?.routingEnabled || employee.manualAvailability !== 'available' || !employee.hasTransferDestination) return c.json({ destination: null });
    const now = Date.now();
    const decision = await checkEmployeeAvailability(agentId, { employeeId: args.data.employeeId, start: new Date(now).toISOString(), end: new Date(now + 300000).toISOString() });
    if (!decision.available && decision.reason !== 'calcom_authority') return c.json({ destination: null });
    return c.json({ destination: await resolveEmployeeTransferDestination(agentId, args.data.employeeId) });
  })
  .post('/functions/book-appointment', async c => {
    const args = booking.safeParse(c.get('args'));
    if (!args.success) return c.json({ error: 'Invalid arguments' }, 400);
    const result = await repo.runRetellFunction(c.get('agentId'), c.get('retellAgentId'), c.get('callId'), 'book-appointment',
      createHash('sha256').update(JSON.stringify(args.data)).digest('hex'), c.get('invocationId'),
      async key => {
        const result = await bookEmployeeAppointment(c.get('agentId'), args.data, key, c.get('bookingDeadlineAt'));
        if (result.status === 'confirmed') await repo.markRetellCallOutcome(c.get('agentId'), c.get('retellAgentId'), c.get('callId'), 'booked').catch(() => undefined);
        return result;
      });
    return c.json(result);
  })
  .post('/functions/save-message', async c => {
    const args = message.safeParse(c.get('args'));
    if (!args.success) return c.json({ error: 'Invalid arguments' }, 400);
    if (!args.data.callerConfirmed) return c.json({ saved: false, status: 'confirmation_required', reason: 'Read the message and callback details back, then ask the caller to confirm before saving.' });
    const { callerConfirmed: _confirmed, ...details } = args.data;
    return c.json(await repo.saveRetellMessage(c.get('agentId'), c.get('retellAgentId'), c.get('callId'), details,
      createHash('sha256').update(JSON.stringify(details)).digest('hex'), c.get('invocationId')));
  });

const approved = (workspace: string, id: string) => !!env.RETELL_API_KEY && workspace === env.RETELL_WORKSPACE_ID && id === env.RETELL_AGENT_ID;
export const retellSettings = new Hono<AppEnv>()
  .use('*', requireCalendarOwner)
  .get('/', async c => {
    const data = await repo.getRetellConnection(c.get('agentId')) ?? { retellAgentId: '', enabled: false };
    return c.json({ ...data, apiKeyConfigured: !!env.RETELL_API_KEY, operatorApproved: approved(c.get('agentId'), data.retellAgentId) });
  })
  .put('/', async c => {
    const parsed = connection.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Enter a valid Retell agent ID and enabled flag' }, 400);
    if (parsed.data.enabled && !approved(c.get('agentId'), parsed.data.retellAgentId)) return c.json({ error: 'Pending operator approval. Ask the workspace owner to arrange server configuration.' }, 409);
    const saved = await repo.saveRetellConnection(c.get('agentId'), parsed.data.retellAgentId, parsed.data.enabled);
    return saved ? c.json({ ...parsed.data, apiKeyConfigured: !!env.RETELL_API_KEY }) : c.json({ error: 'Retell agent ID unavailable' }, 409);
  });
