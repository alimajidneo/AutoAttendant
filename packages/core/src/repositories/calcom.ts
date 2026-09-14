import { randomUUID } from 'node:crypto';
import { getTableColumns, and, eq, sql, ne, or, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appointments, calcomConnections, calcomWebhookReceipts, employees, workspaces } from '../db/schema.js';
import { env } from '../env.js';
import { encryptToken, decryptToken } from '../providers/token-encryption.js';
import { CalcomClient, type CalcomEventType, type CalcomWebhook } from '../providers/calcom.js';
import { appointmentSnapshotMatches } from './appointments.js';
import { EmployeeBookingInProgressError } from './employees.js';
const scope = (agentId: string, employeeId: string) => and(eq(calcomConnections.agentId, agentId), eq(calcomConnections.employeeId, employeeId));
const owner = (agentId: string, id: string) => `calcom:${agentId}:${id}`;
function key() { if (!env.TOKEN_ENCRYPTION_KEY) throw new Error('Credential encryption unavailable'); return env.TOKEN_ENCRYPTION_KEY; }
export function calcomConnectionView(row: typeof calcomConnections.$inferSelect) {
 return { id: row.id, employeeId: row.employeeId, authKind: row.authKind, providerUserId: row.providerUserId,
  accountEmail: row.accountEmail, displayLabel: row.displayLabel, status: row.status };
}
export async function listCalcomConnections(agentId: string) {
 return (await db.select().from(calcomConnections).where(eq(calcomConnections.agentId, agentId)).limit(100)).map(calcomConnectionView);
}
export async function getCalcomClient(agentId: string, employeeId: string, connectionId: string) {
 const [row] = await db.select().from(calcomConnections).where(and(scope(agentId, employeeId), eq(calcomConnections.id, connectionId), eq(calcomConnections.status, 'active'))).limit(1);
 return row ? new CalcomClient(decryptToken(row.encryptedCredential, owner(agentId, row.id), key()), env.CALCOM_API_BASE_URL, async () => {
   await db.update(calcomConnections).set({ status: 'reconnect_required', updatedAt: new Date() }).where(and(scope(agentId, employeeId), eq(calcomConnections.id, connectionId), eq(calcomConnections.encryptedCredential, row.encryptedCredential)));
  }) : null;
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function lockEmployee(tx: Tx, agentId: string, employeeId: string, allowCredentialRefresh = false) {
 await tx.select().from(workspaces).where(eq(workspaces.agentId, agentId)).for('update');
 const [employee] = await tx.select().from(employees).where(and(eq(employees.agentId, agentId), eq(employees.id, employeeId))).limit(1);
 if (!employee) throw new Error('Employee unavailable');
 const [pending] = await tx.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.agentId, agentId), eq(appointments.employeeId, employeeId), eq(appointments.status, 'requested'))).limit(1);
 if (pending && !allowCredentialRefresh) throw new EmployeeBookingInProgressError();
 return employee;
}
const updatedAt = sql`greatest(clock_timestamp(), date_trunc('milliseconds', ${employees.updatedAt}) + interval '1 millisecond')`;
export async function connectCalcom(agentId: string, employeeId: string, credential: string) {
 // Ownership before provider I/O; check again under the mutation lock.
 const [employee] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.agentId, agentId), eq(employees.id, employeeId))).limit(1);
 if (!employee) throw new Error('Employee unavailable');
 key();
 const account = await new CalcomClient(credential, env.CALCOM_API_BASE_URL).me();
 return db.transaction(async tx => {
  await lockEmployee(tx, agentId, employeeId, true);
  const [existing] = await tx.select().from(calcomConnections).where(scope(agentId, employeeId)).for('update');
  if (existing && existing.providerUserId !== String(account.id)) throw new Error('Disconnect the existing identity first');
  const id = existing?.id ?? randomUUID();
  const values = { id, agentId, employeeId, encryptedCredential: encryptToken(credential, owner(agentId, id), key()),
   providerUserId: String(account.id), accountEmail: account.email, displayLabel: account.username, status: 'active' as const, updatedAt: new Date() };
  const [row] = await tx.insert(calcomConnections).values(values).onConflictDoUpdate({ target: [calcomConnections.agentId, calcomConnections.employeeId], set: values }).returning();
  await tx.update(employees).set({ updatedAt }).where(and(eq(employees.agentId, agentId), eq(employees.id, employeeId)));
  return calcomConnectionView(row!);
 });
}
export async function selectCalcomEventType(agentId: string, employeeId: string, connectionId: string, event: CalcomEventType) {
 return db.transaction(async tx => {
  await lockEmployee(tx, agentId, employeeId);
  const [connection] = await tx.select().from(calcomConnections).where(and(scope(agentId, employeeId), eq(calcomConnections.id, connectionId), eq(calcomConnections.status, 'active'))).for('update');
  if (!connection) throw new Error('Connection unavailable');
  await tx.update(employees).set({ calendarPolicy: { authority: 'calcom', eventType: null, connectionId, eventTypeId: event.id, eventTypeSlug: event.slug, eventTypeTitle: event.title, bookingUrl: event.bookingUrl }, updatedAt })
   .where(and(eq(employees.agentId, agentId), eq(employees.id, employeeId)));
 });
}
export async function disconnectCalcom(agentId: string, employeeId: string, connectionId: string) {
 return db.transaction(async tx => {
  const employee = await lockEmployee(tx, agentId, employeeId);
  // Keep credentials needed for active bookings, including future cancellation/reconciliation.
  const [active] = await tx.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.agentId, agentId), eq(appointments.externalCalendarConnectionId, connectionId), ne(appointments.status, 'cancelled'))).limit(1);
  if (active) throw new Error('Resolve or cancel existing Cal.com appointments before disconnecting');
  await tx.delete(calcomConnections).where(and(scope(agentId, employeeId), eq(calcomConnections.id, connectionId)));
  if (employee.calendarPolicy.authority === 'calcom' && employee.calendarPolicy.connectionId === connectionId) {
   await tx.update(employees).set({ calendarPolicy: { authority: 'direct', booking: null, conflicts: [] }, updatedAt }).where(and(eq(employees.agentId, agentId), eq(employees.id, employeeId)));
  }
 });
}
export async function ingestCalcomWebhook(connectionId: string, event: CalcomWebhook) {
 return db.transaction(async tx => {
  await tx.delete(calcomWebhookReceipts).where(sql`${calcomWebhookReceipts.createdAt} < now() - interval '14 days'`);
  const [connection] = await tx.select().from(calcomConnections).where(eq(calcomConnections.id, connectionId)).limit(1).for('share');
  if (!connection) return;
  const [receipt] = await tx.insert(calcomWebhookReceipts).values({ connectionId, digest: event.digest, bookingUid: event.uid, eventType: event.type }).onConflictDoNothing().returning();
  if (!receipt) return;
  // Standard BOOKING_CREATED/CANCELLED payloads generally omit DeskRoute request
  // metadata. This conditional association is not automatic recovery: absent any
  // identity below, receipt ingestion is an appointment no-op. The supported path
  // is operator-supplied UID + authenticated reconciliation, with all identity checks.
  // Never confirm or move appointments from unordered notifications.
  if (event.eventTypeId !== undefined && event.metadata.appointmentId && event.metadata.agentId && event.metadata.employeeId) {
   await tx.update(appointments).set({ externalEventId: event.uid, providerWriteState: 'reconciliation_required', updatedAt: new Date() }).where(and(
    eq(appointments.id, event.metadata.appointmentId), eq(appointments.agentId, connection.agentId), eq(appointments.employeeId, connection.employeeId),
    eq(appointments.externalCalendarConnectionId, connectionId), eq(appointments.externalCalendarId, `calcom:${event.eventTypeId}`), eq(appointments.status, 'requested'),
    eq(appointments.agentId, event.metadata.agentId), eq(appointments.employeeId, event.metadata.employeeId),
    eq(appointments.startTime, new Date(event.start)), eq(appointments.endTime, new Date(event.end)),
    or(isNull(appointments.externalEventId), eq(appointments.externalEventId, event.uid))));
  }
 });
}

export async function reconcileCalcomAppointment(agentId: string, appointmentId: string, bookingUid?: string, options?: { useStoredUid: boolean }) {
 const [row] = await db.select({ ...getTableColumns(appointments), revision: sql<string>`xmin::text` }).from(appointments).where(and(eq(appointments.agentId, agentId), eq(appointments.id, appointmentId))).limit(1);
 if (!row?.employeeId || !row.externalCalendarId?.startsWith('calcom:') || !row.externalCalendarConnectionId) return null;
 const uid = options?.useStoredUid ? row.externalEventId ?? bookingUid : bookingUid ?? row.externalEventId;
 if (row.status !== 'requested' && uid !== row.externalEventId) return null;
 if (!uid) return null;
 const client = await getCalcomClient(agentId, row.employeeId, row.externalCalendarConnectionId);
 if (!client) return null;
 const booking = await client.get(uid);
 if (booking.metadata?.appointmentId !== row.id || booking.metadata?.employeeId !== row.employeeId || booking.metadata?.agentId !== agentId
  || `calcom:${booking.eventType?.id ?? booking.eventTypeId}` !== row.externalCalendarId
  || Date.parse(booking.start) !== row.startTime?.getTime() || Date.parse(booking.end) !== row.endTime?.getTime()) return null;
 if (booking.status !== 'accepted' && booking.status !== 'cancelled' && booking.status !== 'rejected') return null;
 const [saved] = await db.update(appointments).set({ status: booking.status === 'accepted' ? 'confirmed' : 'cancelled', externalEventId: uid, providerWriteState: null, updatedAt: new Date() })
  .where(and(eq(appointments.agentId, agentId), eq(appointments.id, row.id), appointmentSnapshotMatches(row), ne(appointments.status, 'cancelled'), sql`exists (select 1 from ${calcomConnections} where ${calcomConnections.id} = ${row.externalCalendarConnectionId} and ${calcomConnections.agentId} = ${agentId} and ${calcomConnections.employeeId} = ${row.employeeId} and ${calcomConnections.status} = 'active')`)).returning();
 return saved ?? null;
}

export async function pruneCalcomWebhookReceipts() {
 await db.delete(calcomWebhookReceipts).where(sql`${calcomWebhookReceipts.createdAt} < now() - interval '14 days'`);
}
