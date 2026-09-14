import { requireCalendarOwner } from '../../middleware/calendar-owner.js';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { AppEnv } from '../../types.js';
import { requireManager } from '../../middleware/auth.js';
import * as repo from '@receptionist/core/repositories/calcom.js';
import { env } from '@receptionist/core/env.js';
import { deriveCalcomWebhookSecret, verifyCalcomWebhook } from '@receptionist/core/providers/calcom.js';
const uuid = z.string().uuid();
export const calcom = new Hono<AppEnv>()
 .onError((_error, c) => c.json({ error: 'Cal.com unavailable. Check the connection and unresolved appointments before retrying.' }, 503))
 .use('*', requireManager, requireCalendarOwner, bodyLimit({ maxSize: 8192 }))
 .use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); })
 .get('/', async c => c.json(await repo.listCalcomConnections(c.get('agentId'))))
 .use('/:employeeId/*', async (c, next) => {
  if (!uuid.safeParse(c.req.param('employeeId')).success) return c.json({ error: 'Invalid employee' }, 400);
  const id = c.req.param('connectionId');
  if (id && !uuid.safeParse(id).success) return c.json({ error: 'Invalid connection' }, 400);
  await next();
 })
 .post('/:employeeId/connect', async c => {
  const body = z.object({ apiKey: z.string().trim().min(1).max(4096).regex(/^[^\s\r\n]+$/) }).strict().safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Enter a valid API key' }, 400);
  return c.json(await repo.connectCalcom(c.get('agentId'), c.req.param('employeeId'), body.data.apiKey));
 })
 .get('/:employeeId/:connectionId/event-types', async c => {
  const client = await repo.getCalcomClient(c.get('agentId'), c.req.param('employeeId'), c.req.param('connectionId'));
  if (!client) return c.json({ error: 'Connection unavailable' }, 404);
  return c.json(await client.eventTypes());
 })
 .post('/:employeeId/:connectionId/select', async c => {
  const body = z.object({ eventTypeId: z.number().int().positive() }).strict().safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Select an event type' }, 400);
  const agentId = c.get('agentId'), employeeId = c.req.param('employeeId'), connectionId = c.req.param('connectionId');
  const client = await repo.getCalcomClient(agentId, employeeId, connectionId);
  if (!client) return c.json({ error: 'Connection unavailable' }, 404);
  const event = (await client.eventTypes()).find(event => event.id === body.data.eventTypeId);
  if (!event) return c.json({ error: 'Event type unavailable for this employee' }, 409);
  await repo.selectCalcomEventType(agentId, employeeId, connectionId, event);
  return c.json({ saved: true });
 })
 .delete('/:employeeId/:connectionId', async c => {
  await repo.disconnectCalcom(c.get('agentId'), c.req.param('employeeId'), c.req.param('connectionId'));
  return c.json({ disconnected: true });
 });
export const calcomWebhooks = new Hono()
 .onError((_error, c) => c.json({ error: 'Webhook unavailable' }, 503))
 .post('/:connectionId', async c => {
  const connectionId = c.req.param('connectionId');
  if (!uuid.safeParse(connectionId).success) return c.json({ error: 'Invalid connection' }, 400);
  const chunks: Uint8Array[] = []; let size = 0;
  const reader = c.req.raw.body?.getReader();
  if (reader) for (;;) {
   const { done, value } = await reader.read(); if (done) break;
   size += value.byteLength;
   if (size > 262144) { await reader.cancel(); return c.json({ error: 'Payload too large' }, 413); }
   chunks.push(value);
  }
  const raw = Buffer.concat(chunks, size);
  const version = c.req.header('X-Cal-Webhook-Version');
  if (version !== '2021-10-20') return c.json({ error: 'Unsupported webhook version' }, 400);
  let event;
  if (!env.CALCOM_WEBHOOK_SECRET) return c.json({ error: 'Webhook unavailable' }, 503);
  try { event = verifyCalcomWebhook(raw, c.req.header('X-Cal-Signature-256') ?? '', deriveCalcomWebhookSecret(env.CALCOM_WEBHOOK_SECRET, connectionId)); }
  catch (error) { return c.json({ error: 'Invalid webhook' }, error instanceof Error && error.message.includes('signature') ? 401 : 400); }
  await repo.ingestCalcomWebhook(connectionId, event);
  return c.body(null, 204);
 });

// Daily scheduler endpoint; no provider I/O and no tenant data in the response.
export const calcomMaintenance = new Hono().get('/receipts', async c => {
 if (!env.CRON_SECRET || c.req.header('Authorization') !== `Bearer ${env.CRON_SECRET}`) return c.body(null, 401);
 await repo.pruneCalcomWebhookReceipts();
 return c.body(null, 204);
});
