import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { listNotifications, markNotificationsRead } from '../src/repositories/notifications.js';
import { cancelAppointmentById } from '../src/repositories/appointments.js';
import { makeAgent, makeAppointment, makeCall, makeEscalation } from './factories.js';

describe('notification ownership and persistence', () => {
  it('returns real bookings, pending questions and failed calls for this owner only', async () => {
    const owner = await makeAgent();
    const other = await makeAgent();
    await makeAppointment(owner.id);
    await makeEscalation(owner.id);
    const call = await makeCall(owner.id, { outcome: 'error', endedAt: new Date() });
    await makeAppointment(other.id, { serviceName: 'Other owner private appointment' });
    await makeEscalation(other.id, { question: 'Private question' });
    await makeCall(other.id, { outcome: 'error' });
    const feed = await listNotifications(owner.id);
    expect(feed).toHaveLength(3);
    expect(feed.map(item => item.kind).sort()).toEqual(['booking', 'call-error', 'question']);
    expect(feed.find(item => item.kind === 'call-error')?.href).toBe(`/calls/${call.id}`);
    expect(feed.every(item => !item.read)).toBe(true);
    expect(JSON.stringify(feed)).not.toContain('Private');
    expect(JSON.stringify(feed)).not.toContain('Other owner');
  });

  it('persists read receipts, isolates owners, and handles duplicate/repeated reads', async () => {
    const owner = await makeAgent(); const other = await makeAgent();
    await makeAppointment(owner.id);
    const [item] = await listNotifications(owner.id);
    await markNotificationsRead(other.id, [item, item]);
    expect((await listNotifications(owner.id))[0].read).toBe(false);
    await markNotificationsRead(owner.id, [item, item]);
    await markNotificationsRead(owner.id, [item]);
    expect((await listNotifications(owner.id))[0].read).toBe(true);
    const rows = await db.execute(sql`SELECT * FROM notification_reads`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].agent_id).toBe(owner.id);
  });

  it('makes a cancellation unread and prevents an old displayed version from marking it read', async () => {
    const owner = await makeAgent();
    const appointment = await makeAppointment(owner.id, { updatedAt: new Date(Date.now() - 60_000) });
    const [original] = await listNotifications(owner.id);
    await markNotificationsRead(owner.id, [original]);
    await cancelAppointmentById(appointment.id, owner.id);
    const [cancelled] = await listNotifications(owner.id);
    expect(cancelled.kind).toBe('cancellation');
    expect(cancelled.read).toBe(false);
    await markNotificationsRead(owner.id, [original]);
    expect((await listNotifications(owner.id))[0].read).toBe(false);
    await markNotificationsRead(owner.id, [cancelled]);
    expect((await listNotifications(owner.id))[0].read).toBe(true);
  });

  it('rejects invented IDs and future versions without inserting receipts', async () => {
    const owner = await makeAgent(); await makeAppointment(owner.id);
    const [item] = await listNotifications(owner.id);
    await markNotificationsRead(owner.id, [
      { ...item, occurredAt: new Date(Date.now() + 86_400_000).toISOString() },
      { ...item, id: 'appointment:00000000-0000-0000-0000-000000000000:confirmed' },
    ]);
    expect((await listNotifications(owner.id))[0].read).toBe(false);
    expect((await db.execute(sql`SELECT * FROM notification_reads`)).rows).toHaveLength(0);
  });

  it('limits history to 30 days, excludes resolved questions, and caps the feed at 50', async () => {
    const owner = await makeAgent();
    await makeAppointment(owner.id, { updatedAt: new Date(Date.now() - 31 * 86_400_000), serviceName: 'Old record' });
    await makeEscalation(owner.id, { status: 'resolved' });
    expect(await listNotifications(owner.id)).toEqual([]);
    for (let n = 0; n < 52; n++) await makeAppointment(owner.id);
    expect(await listNotifications(owner.id)).toHaveLength(50);
  });

  it('keeps a same-millisecond status change unread', async () => {
    const owner = await makeAgent(); await makeAppointment(owner.id);
    const [original] = await listNotifications(owner.id);
    await markNotificationsRead(owner.id, [original]);
    await db.execute(sql`UPDATE appointments SET status = 'cancelled' WHERE agent_id = ${owner.id}`);
    await markNotificationsRead(owner.id, [original]);
    const [cancelled] = await listNotifications(owner.id);
    expect(cancelled.read).toBe(false);
    expect(cancelled.kind).toBe('cancellation');
    expect(cancelled.id).not.toBe(original.id);
  });

  it('enables RLS on the backend-only read receipt table', async () => {
    const result = await db.execute(sql`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notification_reads'::regclass`);
    expect(result.rows[0].relrowsecurity).toBe(true);
  });
});
