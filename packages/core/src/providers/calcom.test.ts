import { afterEach, expect, it, vi } from 'vitest';
import { CalcomClient, deriveCalcomWebhookSecret, verifyCalcomWebhook } from './calcom.js';
import { createHmac } from 'node:crypto';
import { ProviderWriteRejectedError } from './provider-write-error.js';
afterEach(() => vi.unstubAllGlobals());
const start = '2026-09-14T10:00:00.000Z';
const booking = { start, eventTypeId: 12, attendee: { name: 'Caller', timeZone: 'UTC', phoneNumber: '+14155550123' }, metadata: { appointmentId: '00000000-0000-4000-8000-000000000001' } };
function response(data: unknown, status = 200) { const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(data), { status })); vi.stubGlobal('fetch', fetch); return fetch; }
it('uses explicit authenticated slots and range format', async () => {
 const fetch = response({ status: 'success', data: { '2026-09-14': [{ start, end: '2026-09-14T11:00:00.000Z' }] } });
 expect(await new CalcomClient('SECRET').slots(12, start, '2026-09-14T11:00:00Z', 'UTC')).toHaveLength(1);
 expect(String(fetch.mock.calls[0][0])).toContain('format=range');
 expect(fetch.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer SECRET', 'cal-api-version': '2024-09-04' });
});
it.each([{}, { status: 'success' }, { status: 'error', data: {} }, { status: 'success', data: { day: [{ start }] } }])('fails closed for malformed slots %j', async data => {
 response(data); await expect(new CalcomClient('SECRET').slots(12, start, start, 'UTC')).rejects.toThrow('Cal.com response unavailable');
});
it.each([400, 401, 403, 422])('definite rejection %s', async status => { response({ secret: 'PRIVATE' }, status); await expect(new CalcomClient('SECRET').book(booking)).rejects.toBeInstanceOf(ProviderWriteRejectedError); });
it.each([500, 502, 503])('ambiguous %s is never retried', async status => { const fetch = response({}, status); await expect(new CalcomClient('SECRET').book(booking)).rejects.not.toBeInstanceOf(ProviderWriteRejectedError); expect(fetch).toHaveBeenCalledTimes(1); });
it('rejects missing contact before fetch', async () => { const fetch = response({}); await expect(new CalcomClient('SECRET').book({ ...booking, attendee: { name: 'Caller', timeZone: 'UTC' } })).rejects.toThrow('contact'); expect(fetch).not.toHaveBeenCalled(); });
it('malformed success and network timeout remain ambiguous', async () => { response({ status: 'success', data: { uid: 'x' } }); await expect(new CalcomClient('SECRET').book(booking)).rejects.not.toBeInstanceOf(ProviderWriteRejectedError); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('SECRET timeout'))); await expect(new CalcomClient('SECRET').book(booking)).rejects.toThrow('Cal.com response unavailable'); });
it('accepts the standard webhook shape without eventTypeId, verifies exact raw bytes, and strips private fields', () => {
 const raw = Buffer.from(JSON.stringify({ triggerEvent: 'BOOKING_CREATED', payload: { uid: 'uid', startTime: start, endTime: '2026-09-14T11:00:00Z', metadata: booking.metadata, attendees: [{ email: 'PRIVATE' }] } }));
 const signature = createHmac('sha256', 'secret').update(raw).digest('hex');
 const event = verifyCalcomWebhook(raw, signature, 'secret');
 expect(event.eventTypeId).toBeUndefined(); expect(JSON.stringify(event)).not.toContain('PRIVATE');
 expect(() => verifyCalcomWebhook(Buffer.concat([raw, Buffer.from(' ')]), signature, 'secret')).toThrow();
 expect(() => verifyCalcomWebhook(Buffer.from('{'), '', 'secret')).toThrow('signature');
});
it('derives independent webhook secrets for different connection IDs', () => {
 const root = 'w'.repeat(32);
 const first = deriveCalcomWebhookSecret(root, '00000000-0000-4000-8000-000000000001');
 const second = deriveCalcomWebhookSecret(root, '00000000-0000-4000-8000-000000000002');
 expect(first).toMatch(/^[a-f0-9]{64}$/); expect(second).not.toBe(first);
});
it('creates a phone-only booking with UTC start and bounded non-PII metadata', async () => {
 const fetch = response({ status: 'success', data: { uid: 'uid', status: 'accepted', start, end: '2026-09-14T11:00:00Z', eventType: { id: 12 } } });
 expect((await new CalcomClient('TOKEN', 'https://api.cal.com/v2').book(booking)).uid).toBe('uid');
 expect(fetch.mock.calls[0][0]).toBe('https://api.cal.com/v2/bookings');
 expect(fetch.mock.calls[0][1].headers['cal-api-version']).toBe('2024-08-13');
 const body = JSON.parse(fetch.mock.calls[0][1].body);
 expect(body.attendee).toEqual(booking.attendee); expect(body).not.toHaveProperty('attendee.email'); expect(body.metadata).toEqual(booking.metadata);
});
it('uses current UID get and cancel routes; requires explicit cancelled state', async () => {
 const value = { uid: 'booking-id', status: 'cancelled', start, end: '2026-09-14T11:00:00Z', eventTypeId: 12 };
 const fetch = response({ status: 'success', data: value }); const client = new CalcomClient('TOKEN');
 await client.get('booking-id'); await client.cancel('booking-id');
 expect(fetch.mock.calls.map(c => c[0])).toEqual(['https://api.cal.com/v2/bookings/booking-id', 'https://api.cal.com/v2/bookings/booking-id/cancel']);
 expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ cancellationReason: 'Cancelled by DeskRoute manager' });
});
it.each([404, 410])('does not infer cancellation or absence from %s', async status => { response({}, status); const client = new CalcomClient('TOKEN'); await expect(client.cancel('uid')).rejects.toThrow(); await expect(client.get('uid')).rejects.toThrow(); });
it('validates discovery and returns only selectable fields', async () => {
 response({ status: 'success', data: [{ id: 12, title: 'Intro', slug: 'intro', lengthInMinutes: 60, bookingUrl: 'https://cal.com/sam/intro', secret: 'PRIVATE' }] });
 const types = await new CalcomClient('TOKEN').eventTypes(); expect(JSON.stringify(types)).not.toContain('PRIVATE');
 response({ status: 'success', data: [{ id: 12 }] }); await expect(new CalcomClient('TOKEN').eventTypes()).rejects.toThrow('Cal.com response unavailable');
});
it('signals reconnect on expired credentials without leaking response data', async () => {
 response({ message: 'PRIVATE' }, 401); const reconnect = vi.fn();
 await expect(new CalcomClient('TOKEN', undefined, reconnect).me()).rejects.toThrow('Cal.com response unavailable'); expect(reconnect).toHaveBeenCalledOnce();
});

it('creates and discovers only a deterministic compatible DeskRoute event type', async () => {
 const created = { ...safeType, id: 99, title: 'DeskRoute appointment', slug: 'deskroute-employee', lengthInMinutes: 30,
  destinationCalendar: { integration: 'google_calendar', externalId: 'work@example.test' } };
 const fetch = vi.fn()
  .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: created })))
  .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: [created] })));
 vi.stubGlobal('fetch', fetch);
 const client = new CalcomClient('TOKEN', undefined, undefined, true);
 await client.createEventType({ title: created.title, slug: created.slug, lengthInMinutes: 30 });
 expect(JSON.parse(fetch.mock.calls[0]![1]!.body)).toEqual({ title: 'DeskRoute appointment', slug: 'deskroute-employee', lengthInMinutes: 30 });
 expect(fetch.mock.calls[0]![0]).toBe('https://api.cal.com/v2/event-types');
 const discovered = await client.eventTypes();
 expect(discovered.find(event => event.slug === created.slug)?.lengthInMinutes).toBe(30);
 expect(discovered.find(event => event.slug === created.slug)?.destinationCalendar).toEqual(created.destinationCalendar);
});

it('retains a bounded official destination calendar and distinguishes its absence', async () => {
 response({ status: 'success', data: [{ ...safeType, destinationCalendar: { integration: 'google_calendar', externalId: 'work@example.test' } }, { ...safeType, id: 13 }] });
 const types = await new CalcomClient('TOKEN').eventTypes();
 expect(types[0]!.destinationCalendar).toEqual({ integration: 'google_calendar', externalId: 'work@example.test' });
 expect(types[1]!.destinationCalendar).toBeUndefined();
});

it('creates, lists, and deletes signed booking webhooks without exposing the secret', async () => {
 const webhook = { id: 'webhook-1', subscriberUrl: 'https://api.example/api/calcom/webhooks/00000000-0000-4000-8000-000000000001', active: true,
  triggers: ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'] };
 const fetch = vi.fn()
  .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: webhook })))
  .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: [webhook] })))
  .mockResolvedValueOnce(new Response(null, { status: 204 }));
 vi.stubGlobal('fetch', fetch);
 const client = new CalcomClient('TOKEN', undefined, undefined, true);
 await client.createWebhook({ subscriberUrl: webhook.subscriberUrl, secret: 'PRIVATE_SECRET'.padEnd(32, '_') });
 expect(await client.webhooks()).toEqual([webhook]);
 await client.deleteWebhook(webhook.id);
 expect(fetch.mock.calls.map(call => [call[0], call[1]!.method])).toEqual([
  ['https://api.cal.com/v2/webhooks', 'POST'], ['https://api.cal.com/v2/webhooks', 'GET'], ['https://api.cal.com/v2/webhooks/webhook-1', 'DELETE'],
 ]);
 expect(fetch.mock.calls.every(call => call[1]!.headers['cal-api-version'] === '2024-06-14')).toBe(true);
 expect(JSON.parse(fetch.mock.calls[0]![1]!.body)).toMatchObject({ secret: 'PRIVATE_SECRET'.padEnd(32, '_'), triggers: webhook.triggers });
});

it('blocks automatic OAuth setup mutations before fetch unless explicitly approved', async () => {
 const fetch = response({ status: 'success', data: safeType });
 const client = new CalcomClient('TOKEN');
 await expect(client.createEventType({ title: 'DeskRoute appointment', slug: 'deskroute-employee', lengthInMinutes: 30 })).rejects.toThrow('not approved');
 await expect(client.createWebhook({ subscriberUrl: 'https://api.example/api/calcom/webhooks/00000000-0000-4000-8000-000000000001', secret: 's'.repeat(32) })).rejects.toThrow('not approved');
 await expect(client.deleteWebhook('webhook')).rejects.toThrow('not approved');
 expect(fetch).not.toHaveBeenCalled();
});

const safeType = { id: 12, title: 'Intro', slug: 'intro', lengthInMinutes: 60, bookingUrl: 'https://cal.com/sam/intro', recurrence: null, price: 0, isInstantEvent: false, seats: { disabled: true }, bookingFields: [], locations: [{ type: 'integration', integration: 'cal-video' }] };
it.each([
 { recurrence: { interval: 1, occurrences: 5, frequency: 'weekly' } }, { isInstantEvent: true }, { seats: { seatsPerTimeSlot: 2 } }, { seatsPerTimeSlot: 2 },
 { price: 100 }, { confirmationPolicy: { type: 'always' } }, { lengthInMinutesOptions: [30, 60] },
 { bookingRequiresAuthentication: true }, { requiresBookerEmailVerification: true },
 { teamId: 44, schedulingType: 'roundRobin' }, { teamId: 44, schedulingType: 'collective' }, { teamId: 44, schedulingType: 'managed' },
 { bookingFields: [{ slug: 'company', type: 'text', required: true, isDefault: false }] },
 ...['attendeeAddress', 'attendeePhone', 'attendeeDefined', 'unknown'].map(type => ({ locations: [{ type }] })),
])('filters incompatible event type %j', async incompatible => {
 response({ status: 'success', data: [{ ...safeType, ...incompatible }, { ...safeType, id: 13 }] });
 expect((await new CalcomClient('TOKEN').eventTypes()).map(t => t.id)).toEqual([13]);
});
it.each(['http://api.cal.com/v2', 'https://evil.test/v2', 'https://localhost/v2', 'https://api.cal.com/v2?x=1', 'https://api.cal.com/v2#x', 'https://user@api.cal.com/v2', 'https://api.cal.com/v2/other'])('rejects untrusted API base before fetch: %s', async base => {
 const fetch = response({});
 await expect(async () => new CalcomClient('SECRET', base).me()).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});
it('filters app-configured payment requirements even when the legacy price is zero', async () => {
 response({ status: 'success', data: [{ ...safeType, metadata: { apps: { stripe: { enabled: true, price: 100, secret: 'PRIVATE' } } } }] });
 expect(await new CalcomClient('TOKEN').eventTypes()).toEqual([]);
});
it('supports a fixed free type with only supplied default fields and retains no provider metadata', async () => {
 response({ status: 'success', data: [{ ...safeType, bookingFields: [{ slug: 'name', type: 'name', isDefault: true, required: true }, { slug: 'email', type: 'email', isDefault: true, required: true }], metadata: { private: 'PRIVATE' }, description: 'PRIVATE' }] });
 const types = await new CalcomClient('TOKEN').eventTypes(); expect(types).toHaveLength(1); expect(JSON.stringify(types)).not.toContain('PRIVATE');
});
it.each([
 { bookingUrl: `https://cal.com/${'x'.repeat(2048)}` },
 { bookingFields: [{ slug: 'name', type: 'address', isDefault: true, required: true }] },
])('filters unbounded or inconsistent scheduling facts %j', async fields => {
 response({ status: 'success', data: [{ ...safeType, ...fields }] });
 await expect(new CalcomClient('TOKEN').eventTypes()).resolves.toEqual([]);
});
