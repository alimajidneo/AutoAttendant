import { beforeEach, describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../../types.js';
const mocks = vi.hoisted(() => ({ listNotifications: vi.fn(), markNotificationsRead: vi.fn() }));
vi.mock('@receptionist/core/repositories/notifications.js', () => mocks);
import { notifications } from './route.js';
const app = new Hono<AppEnv>().use('*', async (c, next) => { c.set('agentId', 'owner'); c.set('authUser', { id: 'reader' } as never); await next(); }).route('/notifications', notifications);
const item = { id: 'appointment:00000000-0000-0000-0000-000000000000:confirmed', occurredAt: '2026-09-10T12:00:00.000Z' };
beforeEach(() => { vi.resetAllMocks(); mocks.listNotifications.mockResolvedValue([]); });
const read = (body: unknown) => app.request('/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
describe('notifications API', () => {
  it('lists using the authenticated owner', async () => {
    expect((await app.request('/notifications')).status).toBe(200);
    expect(mocks.listNotifications).toHaveBeenCalledWith('owner', 'reader');
  });
  it('marks only the requested versions using the authenticated owner', async () => {
    expect((await read({ items: [item] })).status).toBe(200);
    expect(mocks.markNotificationsRead).toHaveBeenCalledWith('owner', 'reader', [item]);
  });
  it.each([{ items: [] }, { items: Array.from({ length: 51 }, () => item) }, { items: [item], agentId: 'other' }, { items: [{ ...item, occurredAt: 'invalid' }] }, { items: [{ ...item, id: '../../other' }] }])('rejects malformed or oversized writes: %s', async body => {
    expect((await read(body)).status).toBe(400);
    expect(mocks.markNotificationsRead).not.toHaveBeenCalled();
  });
});
