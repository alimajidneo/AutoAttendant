import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ProviderWriteRejectedError } from './provider-write-error.js';
const date = z.string().datetime({ offset: true });
const uid = z.string().min(1).max(200);
const metadata = z.object({ appointmentId: z.string().uuid().optional(), employeeId: z.string().uuid().optional(), agentId: z.string().uuid().optional() });
const range = z.object({ start: date, end: date }).refine(v => Date.parse(v.end) > Date.parse(v.start));
const bookingSchema = z.object({ uid, status: z.enum(['accepted', 'pending', 'rejected', 'cancelled']), start: date, end: date,
  eventTypeId: z.number().int().positive().optional(), eventType: z.object({ id: z.number().int().positive() }).optional(), metadata: metadata.optional() })
  .refine(v => !!(v.eventTypeId || v.eventType?.id) && Date.parse(v.end) > Date.parse(v.start));
export const calcomEventTypeSchema = z.object({ id: z.number().int().positive(), slug: z.string().min(1).max(200), title: z.string().min(1).max(200),
  lengthInMinutes: z.number().int().positive(), bookingUrl: z.string().url().refine(v => new URL(v).protocol === 'https:' && !new URL(v).username && !new URL(v).password) });
// Bounded scheduling facts only; provider metadata, attendees and app payloads are discarded.
const schedulingSchema = calcomEventTypeSchema.extend({
 bookingUrl: calcomEventTypeSchema.shape.bookingUrl.pipe(z.string().max(2048)),
 metadata: z.object({ apps: z.unknown().optional() }).optional().transform(v => ({
  hasAppConfiguration: v?.apps != null && (typeof v.apps !== 'object' || Object.keys(v.apps).length > 0),
 })),
 recurrence: z.object({}).nullable(), price: z.number().nonnegative(), isInstantEvent: z.boolean(),
 seatsPerTimeSlot: z.number().int().nullable().optional(), seats: z.object({ disabled: z.boolean().optional(), seatsPerTimeSlot: z.number().int().optional() }).optional(),
 confirmationPolicy: z.object({ disabled: z.boolean().optional(), type: z.string().max(30).optional() }).optional(),
 lengthInMinutesOptions: z.array(z.number().int().positive()).max(100).optional(),
 bookingRequiresAuthentication: z.boolean().optional(), requiresBookerEmailVerification: z.boolean().optional(),
 teamId: z.number().int().positive().optional(), schedulingType: z.enum(['roundRobin', 'collective', 'managed']).nullable().optional(),
 bookingFields: z.array(z.object({ slug: z.string().max(200), type: z.string().max(100), required: z.boolean(), isDefault: z.boolean() })).max(100),
 locations: z.array(z.object({ type: z.string().max(100) })).max(20),
});
export type CalcomSchedulingType = z.infer<typeof schedulingSchema>;
export function trustedCalcomBase(base: string) {
 if (!/^https:\/\/api\.cal\.com\/v2\/?$/.test(base)) throw new Error('Untrusted Cal.com API base');
 return 'https://api.cal.com/v2';
}
export function deriveCalcomWebhookSecret(rootSecret: string, connectionId: string) {
 const root = z.string().min(32).parse(rootSecret);
 const id = z.string().uuid().parse(connectionId);
 return createHmac('sha256', root).update(`deskroute-calcom-webhook:${id}`).digest('hex');
}
export type CalcomEventType = z.infer<typeof calcomEventTypeSchema>;
export function calcomContact(email?: string, phone?: string) {
 const validEmail = z.string().trim().email().max(254).safeParse(email);
 const validPhone = z.string().regex(/^\+[1-9]\d{7,14}$/).safeParse(phone);
 return validEmail.success || validPhone.success ? { ...(validEmail.success ? { email: validEmail.data } : {}), ...(validPhone.success ? { phoneNumber: validPhone.data } : {}) } : null;
}
const unavailable = () => new Error('Cal.com response unavailable');
export class CalcomClient {
 constructor(private readonly token: string, private readonly base = 'https://api.cal.com/v2', private readonly onUnauthorized?: () => void | Promise<void>) { this.base = trustedCalcomBase(base); }
 private async request(path: string, version: string, body?: unknown): Promise<unknown> {
  try {
   const response = await fetch(`${this.base.replace(/\/$/, '')}${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${this.token}`, 'cal-api-version': version, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
   if (!response.ok) {
    if (response.status === 401 || response.status === 403) await Promise.resolve(this.onUnauthorized?.()).catch(() => undefined);
    if (body !== undefined && [400, 401, 403, 404, 405, 410, 422].includes(response.status)) throw new ProviderWriteRejectedError();
    throw unavailable();
   }
   const parsed = z.object({ status: z.literal('success'), data: z.unknown() }).safeParse(await response.json());
   if (!parsed.success || parsed.data.data === undefined) throw unavailable();
   return parsed.data.data;
  } catch (error) { if (error instanceof ProviderWriteRejectedError) throw error; throw unavailable(); }
 }
 async me() {
  const value = z.object({ id: z.number().int().positive(), email: z.string().email().max(254), username: z.string().min(1).max(200) }).safeParse(await this.request('/me', '2024-06-14'));
  if (!value.success) throw unavailable(); return value.data;
 }
 async eventTypes() {
  const value = z.array(calcomEventTypeSchema.passthrough()).max(1000).safeParse(await this.request('/event-types', '2024-06-14'));
  if (!value.success) throw unavailable();
  return value.data.flatMap(raw => {
   const parsed = schedulingSchema.safeParse(raw);
   if (!parsed.success) return [];
   const t = parsed.data;
   if (t.metadata.hasAppConfiguration || t.recurrence !== null || t.price !== 0 || t.isInstantEvent || t.teamId != null || t.schedulingType != null
    || t.seatsPerTimeSlot != null || (t.seats && t.seats.disabled !== true)
    || (t.confirmationPolicy && t.confirmationPolicy.disabled !== true) || t.lengthInMinutesOptions?.length
    || t.bookingRequiresAuthentication || t.requiresBookerEmailVerification
    || t.bookingFields.some(f => f.required && !(f.isDefault && ((f.slug === 'name' && f.type === 'name') || (f.slug === 'email' && f.type === 'email') || (f.slug === 'attendeePhoneNumber' && f.type === 'phone'))))
    || t.locations.length > 1 || t.locations.some(l => !['address', 'link', 'phone', 'integration', 'conferencing', 'organizersDefaultApp'].includes(l.type))) return [];
   return [t];
  });
 }
 async slots(eventTypeId: number, start: string, end: string, timeZone: string) {
  const query = new URLSearchParams({ eventTypeId: String(eventTypeId), start, end, timeZone, format: 'range' });
  const parsed = z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.array(range)).safeParse(await this.request(`/slots?${query}`, '2024-09-04'));
  if (!parsed.success) throw unavailable(); return Object.values(parsed.data).flat();
 }
 async book(input: { start: string; eventTypeId: number; attendee: { name: string; timeZone: string; email?: string; phoneNumber?: string }; metadata: z.infer<typeof metadata> }) {
  const contact = calcomContact(input.attendee.email, input.attendee.phoneNumber);
  if (!contact) throw new Error('Valid caller contact required');
  const body = { start: new Date(input.start).toISOString(), eventTypeId: input.eventTypeId,
   attendee: { name: input.attendee.name, timeZone: input.attendee.timeZone, ...contact }, metadata: metadata.parse(input.metadata) };
  const parsed = bookingSchema.safeParse(await this.request('/bookings', '2024-08-13', body));
  if (!parsed.success || Date.parse(parsed.data.start) !== Date.parse(body.start) || (parsed.data.eventType?.id ?? parsed.data.eventTypeId) !== body.eventTypeId) throw unavailable();
  return parsed.data;
 }
 async get(bookingUid: string) {
  const parsed = bookingSchema.safeParse(await this.request(`/bookings/${encodeURIComponent(uid.parse(bookingUid))}`, '2024-08-13'));
  if (!parsed.success || parsed.data.uid !== bookingUid) throw unavailable(); return parsed.data;
 }
 async cancel(bookingUid: string) {
  // 404/410 are not proof of absence: require a parsed cancelled booking.
  const parsed = bookingSchema.safeParse(await this.request(`/bookings/${encodeURIComponent(uid.parse(bookingUid))}/cancel`, '2024-08-13', { cancellationReason: 'Cancelled by DeskRoute manager' }));
  if (!parsed.success || parsed.data.uid !== bookingUid || parsed.data.status !== 'cancelled') throw unavailable();
 }
}
export function verifyCalcomWebhook(raw: Buffer, signature: string, secret: string) {
 if (!secret || !/^[a-fA-F0-9]{64}$/.test(signature) || !timingSafeEqual(createHmac('sha256', secret).update(raw).digest(), Buffer.from(signature, 'hex'))) throw new Error('Invalid Cal.com signature');
 try {
  const value = z.object({ triggerEvent: z.enum(['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED']), payload: z.object({ uid,
   startTime: date, endTime: date, eventTypeId: z.number().int().positive().optional(), metadata: metadata.optional() }) }).parse(JSON.parse(raw.toString('utf8')));
  if (Date.parse(value.payload.endTime) <= Date.parse(value.payload.startTime)) throw unavailable();
  const event = { type: value.triggerEvent, status: value.triggerEvent === 'BOOKING_CANCELLED' ? 'cancelled' as const : 'accepted' as const, uid: value.payload.uid, start: value.payload.startTime, end: value.payload.endTime,
   eventTypeId: value.payload.eventTypeId, metadata: value.payload.metadata ?? {} };
  return { ...event, digest: createHash('sha256').update(JSON.stringify(event)).digest('hex') };
 } catch { throw new Error('Invalid Cal.com webhook'); }
}
export type CalcomWebhook = ReturnType<typeof verifyCalcomWebhook>;
