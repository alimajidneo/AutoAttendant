import { beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createHmac } from 'node:crypto';
const m = vi.hoisted(() => ({ pruneCalcomWebhookReceipts: vi.fn(), listCalcomConnections: vi.fn(), connectCalcom: vi.fn(), getCalcomClient: vi.fn(), selectCalcomEventType: vi.fn(), disconnectCalcom: vi.fn(), ingestCalcomWebhook: vi.fn() }));
vi.mock('@receptionist/core/repositories/calcom.js', () => m);
vi.mock('@receptionist/core/env.js', async importOriginal => { const original = await importOriginal<typeof import('@receptionist/core/env.js')>(); return { env: { ...original.env, CALCOM_WEBHOOK_SECRET: 'w'.repeat(32), CRON_SECRET: 'c'.repeat(32) } }; });
vi.mock('../../env.js', () => ({ env: { PUBLIC_API_URL: 'https://api.deskroute.example', DASHBOARD_ORIGINS: ['https://deskroute.example'] } }));
import { deriveCalcomWebhookSecret } from '@receptionist/core/providers/calcom.js';
import { calcom, calcomWebhooks } from './route.js';
import type { AppEnv } from '../../types.js';
const employee = '00000000-0000-4000-8000-000000000001', connection = '00000000-0000-4000-8000-000000000002';
function app(role = 'manager', owner = true) { return new Hono<AppEnv>().use('*', async (c, next) => { c.set('agentId', 'tenant'); c.set('workspaceOwner', owner); c.set('workspaceRole', role as 'manager'); await next(); }).route('/', calcom); }
beforeEach(() => vi.resetAllMocks());
it('manager only', async () => { expect((await app('member').request('/')).status).toBe(403); expect(m.listCalcomConnections).not.toHaveBeenCalled(); });
it('connect scopes tenant and employee without echoing credentials', async () => {
 m.connectCalcom.mockResolvedValue({ id: connection, status: 'active' });
 const r = await app().request(`/${employee}/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: 'SECRET' }) });
 expect(r.status).toBe(200); expect(await r.text()).not.toContain('SECRET'); expect(m.connectCalcom).toHaveBeenCalledWith('tenant', employee, 'SECRET');
});
it('rejects unowned connection without provider call', async () => { m.getCalcomClient.mockResolvedValue(null); expect((await app().request(`/${employee}/${connection}/event-types`)).status).toBe(404); });
it('never discloses provider errors', async () => { m.getCalcomClient.mockRejectedValue(new Error('SECRET')); const r = await app().request(`/${employee}/${connection}/event-types`); expect(r.status).toBe(503); expect(await r.text()).not.toContain('SECRET'); });
it('invalid raw signature is rejected before ingestion', async () => { const r = await calcomWebhooks.request(`/${connection}`, { method: 'POST', headers: { 'X-Cal-Webhook-Version': '2021-10-20' }, body: '{' }); expect(r.status).toBe(401); expect(m.ingestCalcomWebhook).not.toHaveBeenCalled(); });
it('rejects a valid delivery signature when replayed to a different connection', async () => {
 const otherConnection = '00000000-0000-4000-8000-000000000003';
 const body = JSON.stringify({ triggerEvent: 'BOOKING_CANCELLED', payload: { uid: 'uid', eventTypeId: 1, startTime: '2026-09-14T10:00:00Z', endTime: '2026-09-14T11:00:00Z' } });
 const signature = createHmac('sha256', deriveCalcomWebhookSecret('w'.repeat(32), connection)).update(body).digest('hex');
 const replay = await calcomWebhooks.request(`/${otherConnection}`, { method: 'POST', body, headers: { 'X-Cal-Signature-256': signature, 'X-Cal-Webhook-Version': '2021-10-20' } });
 expect(replay.status).toBe(401); expect(m.ingestCalcomWebhook).not.toHaveBeenCalled();
});
it('requires the supported webhook version even when the raw signature is valid', async () => {
 const body = JSON.stringify({ triggerEvent: 'BOOKING_CANCELLED', payload: { uid: 'uid', eventTypeId: 1, startTime: '2026-09-14T10:00:00Z', endTime: '2026-09-14T11:00:00Z' } });
 const signature = createHmac('sha256', deriveCalcomWebhookSecret('w'.repeat(32), connection)).update(body).digest('hex');
 const missing = await calcomWebhooks.request(`/${connection}`, { method: 'POST', body, headers: { 'X-Cal-Signature-256': signature } });
 const unsupported = await calcomWebhooks.request(`/${connection}`, { method: 'POST', body, headers: { 'X-Cal-Signature-256': signature, 'X-Cal-Webhook-Version': '2099-01-01' } });
 expect(missing.status).toBe(400); expect(unsupported.status).toBe(400); expect(m.ingestCalcomWebhook).not.toHaveBeenCalled();
});
it('valid duplicate deliveries receive idempotent success', async () => {
 const body = JSON.stringify({ triggerEvent: 'BOOKING_CANCELLED', payload: { uid: 'uid', eventTypeId: 1, startTime: '2026-09-14T10:00:00Z', endTime: '2026-09-14T11:00:00Z' } });
 const headers = { 'X-Cal-Signature-256': createHmac('sha256', deriveCalcomWebhookSecret('w'.repeat(32), connection)).update(body).digest('hex'), 'X-Cal-Webhook-Version': '2021-10-20' };
 for (let i = 0; i < 2; i++) expect((await calcomWebhooks.request(`/${connection}`, { method: 'POST', body, headers })).status).toBe(204);
 expect(m.ingestCalcomWebhook.mock.calls[0]).toEqual(m.ingestCalcomWebhook.mock.calls[1]);
});
it('accepts a signed standard delivery that omits eventTypeId', async () => {
 const body = JSON.stringify({ triggerEvent: 'BOOKING_CANCELLED', payload: { uid: 'uid', startTime: '2026-09-14T10:00:00Z', endTime: '2026-09-14T11:00:00Z' } });
 const headers = { 'X-Cal-Signature-256': createHmac('sha256', deriveCalcomWebhookSecret('w'.repeat(32), connection)).update(body).digest('hex'), 'X-Cal-Webhook-Version': '2021-10-20' };
 expect((await calcomWebhooks.request(`/${connection}`, { method: 'POST', body, headers })).status).toBe(204);
 expect(m.ingestCalcomWebhook).toHaveBeenCalledOnce();
});
it('selection uses only an event discovered for the owned connection', async () => {
 const eventTypes = vi.fn().mockResolvedValue([{ id: 12, title: 'Intro' }]); m.getCalcomClient.mockResolvedValue({ eventTypes });
 const request = (eventTypeId: number) => app().request(`/${employee}/${connection}/select`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventTypeId }) });
 expect((await request(13)).status).toBe(409); expect(m.selectCalcomEventType).not.toHaveBeenCalled();
 expect((await request(12)).status).toBe(200); expect(m.selectCalcomEventType).toHaveBeenCalledWith('tenant', employee, connection, { id: 12, title: 'Intro' });
});

it('denies non-owner managers on every credential route', async () => {
 m.listCalcomConnections.mockResolvedValue([{ id: connection, ready: false, status: 'setup_required' }]);
 const list = await app('manager', false).request('/'); expect(list.status).toBe(200); expect(await list.text()).not.toContain('encryptedCredential');
 for (const [path, method] of [[`/${employee}/connect`, 'POST'], [`/${employee}/${connection}/event-types`, 'GET'], [`/${employee}/${connection}/select`, 'POST'], [`/${employee}/${connection}`, 'DELETE']]) {
  expect((await app('manager', false).request(path!, { method })).status).toBe(403);
 }
 expect(m.listCalcomConnections).toHaveBeenCalledOnce(); expect(m.connectCalcom).not.toHaveBeenCalled(); expect(m.getCalcomClient).not.toHaveBeenCalled(); expect(m.disconnectCalcom).not.toHaveBeenCalled();
});
it.each([undefined, '1', '262145'])('bounds actual streamed webhook bytes with Content-Length %s', async length => {
 const headers: Record<string, string> = { 'X-Cal-Webhook-Version': '2021-10-20' };
 if (length) headers['Content-Length'] = length;
 const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(150000)); c.enqueue(new Uint8Array(150000)); c.close(); } });
 const request = new Request(`http://localhost/${connection}`, { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
 expect((await calcomWebhooks.request(request)).status).toBe(413); expect(m.ingestCalcomWebhook).not.toHaveBeenCalled();
});
it('requires configured scheduler authentication before retention cleanup', async () => {
 const { calcomMaintenance } = await import('./route.js');
 expect((await calcomMaintenance.request('/receipts')).status).toBe(401);
 expect((await calcomMaintenance.request('/receipts', { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
});

it('runs daily retention only for the authenticated scheduler', async () => {
 const { calcomMaintenance } = await import('./route.js');
 expect((await calcomMaintenance.request('/receipts', { headers: { Authorization: `Bearer ${'c'.repeat(32)}` } })).status).toBe(204);
 expect(m.pruneCalcomWebhookReceipts).toHaveBeenCalledOnce();
});
it('owner can list and disconnect credentials', async () => {
 m.listCalcomConnections.mockResolvedValue([]);
 expect((await app().request('/')).status).toBe(200);
 expect((await app().request(`/${employee}/${connection}`, { method: 'DELETE' })).status).toBe(200);
 expect(m.disconnectCalcom).toHaveBeenCalledWith('tenant', employee, connection, `https://api.deskroute.example/api/calcom/webhooks/${connection}`);
});
