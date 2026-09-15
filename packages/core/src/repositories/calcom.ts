import { createHash, randomUUID } from 'node:crypto';
import { getTableColumns, and, eq, sql, ne, or, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { appointments, calcomConnections, calcomOauthStates, calcomWebhookReceipts, employees, workspaceMembers, workspaces } from '../db/schema.js';
import { env } from '../env.js';
import { encryptToken, decryptToken } from '../providers/token-encryption.js';
import { CalcomClient, deriveCalcomWebhookSecret, refreshCalcomOAuthTokens, type CalcomAccount, type CalcomEventType, type CalcomOAuthTokens, type CalcomWebhook } from '../providers/calcom.js';
import { appointmentSnapshotMatches } from './appointments.js';
import { EmployeeBookingInProgressError } from './employees.js';
const scope = (agentId: string, employeeId: string) => and(eq(calcomConnections.agentId, agentId), eq(calcomConnections.employeeId, employeeId));
const owner = (agentId: string, id: string) => `calcom:${agentId}:${id}`;
const oauthBundle = z.object({ accessToken: z.string().min(1).max(8192), refreshToken: z.string().min(1).max(8192), expiresAt: z.number().int().positive() }).strict();
const eventTitle = 'DeskRoute appointment';
const eventSlug = (employeeId: string) => `deskroute-${createHash('sha256').update(`employee:${employeeId.toLowerCase()}`).digest('hex').slice(0, 20)}`;
const bookingTriggers = ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'] as const;
function key() { if (!env.TOKEN_ENCRYPTION_KEY) throw new Error('Credential encryption unavailable'); return env.TOKEN_ENCRYPTION_KEY; }
export function calcomConnectionView(row: typeof calcomConnections.$inferSelect) {
 return { id: row.id, employeeId: row.employeeId, authKind: row.authKind, providerUserId: row.providerUserId,
  accountEmail: row.accountEmail, displayLabel: row.displayLabel, status: row.status,
  ready: row.status === 'active' && (row.authKind === 'api_key' || (!!row.eventTypeId && !!row.webhookId
   && !!row.destinationCalendarIntegration && !!row.destinationCalendarExternalId)) };
}
export async function listCalcomConnections(agentId: string) {
 return (await db.select().from(calcomConnections).where(eq(calcomConnections.agentId, agentId)).limit(100)).map(calcomConnectionView);
}
export async function getCalcomClient(agentId: string, employeeId: string, connectionId: string) {
 const [row] = await db.select().from(calcomConnections).where(and(scope(agentId, employeeId), eq(calcomConnections.id, connectionId), eq(calcomConnections.status, 'active'))).limit(1);
 if (!row) return null;
 if (row.authKind === 'api_key') return new CalcomClient(decryptToken(row.encryptedCredential, owner(agentId, row.id), key()), env.CALCOM_API_BASE_URL, async () => {
  await db.update(calcomConnections).set({ status: 'reconnect_required', updatedAt: new Date() }).where(and(scope(agentId, employeeId),
   eq(calcomConnections.id, connectionId), eq(calcomConnections.lifecycleGeneration, row.lifecycleGeneration),
   eq(calcomConnections.encryptedCredential, row.encryptedCredential), eq(calcomConnections.credentialVersion, row.credentialVersion),
   eq(calcomConnections.status, row.status), sameTimestamp(calcomConnections.lifecycleLeaseExpiresAt, row.lifecycleLeaseExpiresAt),
   sameTimestamp(calcomConnections.credentialRefreshLeaseExpiresAt, row.credentialRefreshLeaseExpiresAt)));
 });
 return oauthClient(agentId, employeeId, connectionId, 'reconnect_required', ['active']);
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Connection = typeof calcomConnections.$inferSelect;
type ConnectionStatus = Connection['status'];
const lifecycleLeaseMs = 5 * 60_000;
const refreshLeaseMs = 30_000;
const sameTimestamp = (column: typeof calcomConnections.lifecycleLeaseExpiresAt | typeof calcomConnections.credentialRefreshLeaseExpiresAt,
 value: Date | null) => value ? sql`${column} = ${value}` : isNull(column);
const leaseIsLive = (value: Date | null) => !!value && value.getTime() > Date.now();
const exactConnection = (agentId: string, employeeId: string, row: Connection) => and(scope(agentId, employeeId),
 eq(calcomConnections.id, row.id), eq(calcomConnections.lifecycleGeneration, row.lifecycleGeneration),
 eq(calcomConnections.credentialVersion, row.credentialVersion), eq(calcomConnections.encryptedCredential, row.encryptedCredential),
 eq(calcomConnections.status, row.status), sameTimestamp(calcomConnections.lifecycleLeaseExpiresAt, row.lifecycleLeaseExpiresAt),
 sameTimestamp(calcomConnections.credentialRefreshLeaseExpiresAt, row.credentialRefreshLeaseExpiresAt));
async function oauthClient(agentId: string, employeeId: string, connectionId: string,
 failureStatus: ConnectionStatus, statuses: ConnectionStatus[],
 oauthSetupWritesApproved = false) {
 type Credential = Pick<Connection, 'encryptedCredential' | 'credentialVersion' | 'lifecycleGeneration' | 'lifecycleLeaseExpiresAt' | 'credentialRefreshLeaseExpiresAt' | 'status'> & { accessToken: string };
 type RefreshClaim = { kind: 'refresh'; row: Connection; refreshToken: string };
 type CredentialAction = { kind: 'ready'; credential: Credential } | { kind: 'wait'; until: number } | RefreshClaim | { kind: 'unavailable' };
 let action: CredentialAction;
 const waitDeadline = Date.now() + refreshLeaseMs + 5_000;
 for (;;) {
  action = await db.transaction(async (tx: Tx): Promise<CredentialAction> => {
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'calcom-refresh:' + connectionId}))`);
   const [row] = await tx.select().from(calcomConnections).where(and(scope(agentId, employeeId), eq(calcomConnections.id, connectionId),
    or(...statuses.map(status => eq(calcomConnections.status, status))))).for('update');
   if (!row || row.authKind !== 'oauth') return { kind: 'unavailable' };
   let bundle: z.infer<typeof oauthBundle>;
   try { bundle = oauthBundle.parse(JSON.parse(decryptToken(row.encryptedCredential, owner(agentId, row.id), key()))); }
   catch {
    await tx.update(calcomConnections).set({ status: failureStatus, credentialRefreshLeaseExpiresAt: null, updatedAt: new Date() })
     .where(exactConnection(agentId, employeeId, row));
    return { kind: 'unavailable' };
   }
   if (leaseIsLive(row.credentialRefreshLeaseExpiresAt)) return { kind: 'wait', until: row.credentialRefreshLeaseExpiresAt!.getTime() };
   if (bundle.expiresAt > Date.now() + 60_000) {
    let ready = row;
    if (row.credentialRefreshLeaseExpiresAt) {
     [ready] = await tx.update(calcomConnections).set({ credentialRefreshLeaseExpiresAt: null, updatedAt: new Date() })
      .where(exactConnection(agentId, employeeId, row)).returning();
     if (!ready) return { kind: 'unavailable' };
    }
    return { kind: 'ready', credential: { accessToken: bundle.accessToken, encryptedCredential: ready.encryptedCredential,
     credentialVersion: ready.credentialVersion, lifecycleGeneration: ready.lifecycleGeneration, lifecycleLeaseExpiresAt: ready.lifecycleLeaseExpiresAt,
     credentialRefreshLeaseExpiresAt: ready.credentialRefreshLeaseExpiresAt, status: ready.status } };
   }
   const lease = new Date(Date.now() + refreshLeaseMs);
   const [claimed] = await tx.update(calcomConnections).set({ credentialRefreshLeaseExpiresAt: lease, updatedAt: new Date() })
    .where(exactConnection(agentId, employeeId, row)).returning();
   return claimed ? { kind: 'refresh', row: claimed, refreshToken: bundle.refreshToken } : { kind: 'unavailable' };
  });
  if (action.kind !== 'wait') break;
  if (Date.now() >= Math.min(action.until + 1_000, waitDeadline)) return null;
  await new Promise(resolve => setTimeout(resolve, 50));
 }
 if (action.kind === 'unavailable') return null;
 let credential: Credential;
 if (action.kind === 'ready') credential = action.credential;
 else {
  try {
   const rotated = await refreshCalcomOAuthTokens(action.refreshToken);
   const encryptedCredential = encryptToken(JSON.stringify(rotated), owner(agentId, action.row.id), key());
   const [saved] = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'calcom-refresh:' + connectionId}))`);
    return tx.update(calcomConnections).set({ encryptedCredential, credentialVersion: action.row.credentialVersion + 1,
     credentialRefreshLeaseExpiresAt: null, updatedAt: new Date() }).where(exactConnection(agentId, employeeId, action.row)).returning();
   });
   if (!saved) return null;
   credential = { accessToken: rotated.accessToken, encryptedCredential: saved.encryptedCredential,
    credentialVersion: saved.credentialVersion, lifecycleGeneration: saved.lifecycleGeneration, lifecycleLeaseExpiresAt: saved.lifecycleLeaseExpiresAt,
    credentialRefreshLeaseExpiresAt: saved.credentialRefreshLeaseExpiresAt, status: saved.status };
  } catch {
   await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'calcom-refresh:' + connectionId}))`);
    await tx.update(calcomConnections).set({ status: failureStatus, credentialRefreshLeaseExpiresAt: null, updatedAt: new Date() })
     .where(exactConnection(agentId, employeeId, action.row));
   });
   return null;
  }
 }
 if (!credential) return null;
 return new CalcomClient(credential.accessToken, env.CALCOM_API_BASE_URL, async () => {
  await db.update(calcomConnections).set({ status: failureStatus, updatedAt: new Date() }).where(and(scope(agentId, employeeId), eq(calcomConnections.id, connectionId),
   eq(calcomConnections.lifecycleGeneration, credential.lifecycleGeneration), eq(calcomConnections.encryptedCredential, credential.encryptedCredential),
   eq(calcomConnections.credentialVersion, credential.credentialVersion), eq(calcomConnections.status, credential.status),
   sameTimestamp(calcomConnections.lifecycleLeaseExpiresAt, credential.lifecycleLeaseExpiresAt),
   sameTimestamp(calcomConnections.credentialRefreshLeaseExpiresAt, credential.credentialRefreshLeaseExpiresAt)));
 }, oauthSetupWritesApproved);
}
async function lockMemberLinks(tx: Tx, agentId: string) {
 await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'member-employee-link:' + agentId}))`);
}
async function lockCalcomLifecycle(tx: Tx, agentId: string, employeeId: string) {
 await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'calcom-lifecycle:' + agentId + ':' + employeeId}))`);
}
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
 const [current] = await db.select().from(calcomConnections).where(scope(agentId, employeeId)).limit(1);
 if (current?.authKind === 'oauth') throw new Error('Disconnect the OAuth connection before using a legacy API key');
 if (current && (leaseIsLive(current.lifecycleLeaseExpiresAt) || leaseIsLive(current.credentialRefreshLeaseExpiresAt))) throw new Error('Cal.com connection operation is in progress');
 key();
 const account = await new CalcomClient(credential, env.CALCOM_API_BASE_URL).me();
 return db.transaction(async tx => {
  await lockCalcomLifecycle(tx, agentId, employeeId);
  await lockEmployee(tx, agentId, employeeId, true);
  const [existing] = await tx.select().from(calcomConnections).where(scope(agentId, employeeId)).for('update');
  if (existing?.authKind === 'oauth') throw new Error('Disconnect the OAuth connection before using a legacy API key');
  if (existing && (leaseIsLive(existing.lifecycleLeaseExpiresAt) || leaseIsLive(existing.credentialRefreshLeaseExpiresAt))) throw new Error('Cal.com connection operation is in progress');
  if (existing && existing.providerUserId !== String(account.id)) throw new Error('Disconnect the existing identity first');
  const id = existing?.id ?? randomUUID();
  const values = { id, agentId, employeeId, authKind: 'api_key' as const, encryptedCredential: encryptToken(credential, owner(agentId, id), key()),
   providerUserId: String(account.id), accountEmail: account.email, displayLabel: account.username, status: 'active' as const,
   credentialVersion: (existing?.credentialVersion ?? 0) + 1, lifecycleGeneration: (existing?.lifecycleGeneration ?? 0) + 1,
   lifecycleLeaseExpiresAt: null, credentialRefreshLeaseExpiresAt: null,
   eventTypeId: null, webhookId: null, destinationCalendarIntegration: null, destinationCalendarExternalId: null, updatedAt: new Date() };
  const [row] = await tx.insert(calcomConnections).values(values).onConflictDoUpdate({ target: [calcomConnections.agentId, calcomConnections.employeeId], set: values }).returning();
  await tx.update(employees).set({ updatedAt }).where(and(eq(employees.agentId, agentId), eq(employees.id, employeeId)));
  return calcomConnectionView(row!);
 });
}

export async function getLinkedEmployee(agentId: string, userId: string, employeeId: string) {
 const [row] = await db.select({ id: employees.id, displayName: employees.displayName, memberUserId: workspaceMembers.userId })
  .from(workspaceMembers).innerJoin(employees, and(eq(employees.agentId, workspaceMembers.agentId), eq(employees.id, workspaceMembers.employeeId)))
  .where(and(eq(workspaceMembers.agentId, agentId), eq(workspaceMembers.userId, userId), eq(workspaceMembers.employeeId, employeeId))).limit(1);
 return row ?? null;
}

export async function getEmployeeCalcomSelf(agentId: string, userId: string) {
 const [employee] = await db.select({ id: employees.id, displayName: employees.displayName, calendarPolicy: employees.calendarPolicy })
  .from(workspaceMembers).innerJoin(employees, and(eq(employees.agentId, workspaceMembers.agentId), eq(employees.id, workspaceMembers.employeeId)))
  .where(and(eq(workspaceMembers.agentId, agentId), eq(workspaceMembers.userId, userId))).limit(1);
 if (!employee) return null;
 const [connection] = await db.select().from(calcomConnections).where(scope(agentId, employee.id)).limit(1);
 const policy = employee.calendarPolicy.authority === 'calcom' ? employee.calendarPolicy : null;
 return { id: employee.id, displayName: employee.displayName,
  connection: connection ? { ...calcomConnectionView(connection), eventTypeTitle: policy?.eventTypeTitle ?? null } : null };
}

export type CalcomOAuthStartingState = Pick<typeof calcomOauthStates.$inferSelect, 'intent' | 'startingConnectionId' | 'startingProviderUserId' | 'startingLifecycleGeneration'>;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export async function startCalcomOAuthState(agentId: string, employeeId: string, userId: string, stateHash: string, browserChallengeHash: string) {
 return db.transaction(async tx => {
  await lockCalcomLifecycle(tx, agentId, employeeId);
  await lockMemberLinks(tx, agentId);
  const [linked] = await tx.select({ id: workspaceMembers.userId }).from(workspaceMembers).where(and(
   eq(workspaceMembers.agentId, agentId), eq(workspaceMembers.userId, userId), eq(workspaceMembers.employeeId, employeeId))).limit(1);
  if (!linked) throw new Error('Employee link unavailable');
  const [connection] = await tx.select().from(calcomConnections).where(scope(agentId, employeeId)).for('update');
  if (connection && (leaseIsLive(connection.lifecycleLeaseExpiresAt) || leaseIsLive(connection.credentialRefreshLeaseExpiresAt))) throw new Error('Cal.com connection operation is in progress');
  if (connection?.status === 'disconnecting') throw new Error('Cal.com disconnect is in progress');
  const values = { stateHash: hash.parse(stateHash), browserChallengeHash: hash.parse(browserChallengeHash), agentId, employeeId,
   userId: z.string().min(1).max(200).parse(userId), expiresAt: new Date(Date.now() + 10 * 60_000),
   intent: connection ? 'reconnect' as const : 'connect' as const,
   startingConnectionId: connection?.id ?? null, startingProviderUserId: connection?.providerUserId ?? null,
   startingLifecycleGeneration: connection?.lifecycleGeneration ?? null };
  const [saved] = await tx.insert(calcomOauthStates).values(values).returning();
  return saved!;
 });
}
export async function consumeCalcomOAuthState(stateHash: string, browserChallengeHash: string) {
 const state = hash.safeParse(stateHash), browser = hash.safeParse(browserChallengeHash);
 if (!state.success || !browser.success) return null;
 return db.transaction(async tx => {
  await tx.delete(calcomOauthStates).where(sql`${calcomOauthStates.expiresAt} <= now()`);
  const [consumed] = await tx.delete(calcomOauthStates).where(and(eq(calcomOauthStates.stateHash, state.data),
   eq(calcomOauthStates.browserChallengeHash, browser.data), sql`${calcomOauthStates.expiresAt} > now()`)).returning();
  return consumed ?? null;
 });
}
export async function invalidateCalcomOAuthStates(agentId: string, employeeId: string) {
 await db.delete(calcomOauthStates).where(and(eq(calcomOauthStates.agentId, agentId), eq(calcomOauthStates.employeeId, employeeId)));
}

export async function saveCalcomOAuthGrant(agentId: string, employeeId: string, userId: string, tokens: CalcomOAuthTokens, account: CalcomAccount,
 starting: CalcomOAuthStartingState) {
 key();
 return db.transaction(async tx => {
  await lockCalcomLifecycle(tx, agentId, employeeId);
  await lockMemberLinks(tx, agentId);
  await lockEmployee(tx, agentId, employeeId, true);
  const [linked] = await tx.select({ id: workspaceMembers.userId }).from(workspaceMembers).where(and(
   eq(workspaceMembers.agentId, agentId), eq(workspaceMembers.userId, userId), eq(workspaceMembers.employeeId, employeeId))).limit(1);
  if (!linked) throw new Error('Employee link unavailable');
  const [existing] = await tx.select().from(calcomConnections).where(scope(agentId, employeeId)).for('update');
  if (existing && (leaseIsLive(existing.lifecycleLeaseExpiresAt) || leaseIsLive(existing.credentialRefreshLeaseExpiresAt))) throw new Error('Cal.com connection operation is in progress');
  const unchanged = starting.intent === 'connect'
   ? !existing && starting.startingConnectionId === null && starting.startingProviderUserId === null && starting.startingLifecycleGeneration === null
   : !!existing && existing.status !== 'disconnecting' && existing.id === starting.startingConnectionId
    && existing.providerUserId === starting.startingProviderUserId && existing.lifecycleGeneration === starting.startingLifecycleGeneration;
  if (!unchanged) throw new Error('Cal.com connection changed after authorization started');
  if (starting.intent === 'reconnect' && starting.startingProviderUserId !== String(account.id)) throw new Error('Disconnect the existing identity first');
  const id = existing?.id ?? randomUUID();
  const preserveSetup = existing?.authKind === 'oauth' && existing.providerUserId === String(account.id);
  const values = { id, agentId, employeeId, authKind: 'oauth' as const,
   encryptedCredential: encryptToken(JSON.stringify(oauthBundle.parse(tokens)), owner(agentId, id), key()),
   providerUserId: String(account.id), accountEmail: account.email, displayLabel: account.username,
   credentialVersion: (existing?.credentialVersion ?? 0) + 1, lifecycleGeneration: (existing?.lifecycleGeneration ?? 0) + 1,
   lifecycleLeaseExpiresAt: null, credentialRefreshLeaseExpiresAt: null,
   status: 'setup_required' as const, eventTypeId: preserveSetup ? existing.eventTypeId : null,
   webhookId: preserveSetup ? existing.webhookId : null,
   destinationCalendarIntegration: preserveSetup ? existing.destinationCalendarIntegration : null,
   destinationCalendarExternalId: preserveSetup ? existing.destinationCalendarExternalId : null, updatedAt: new Date() };
  const [row] = await tx.insert(calcomConnections).values(values).onConflictDoUpdate({
   target: [calcomConnections.agentId, calcomConnections.employeeId], set: values,
  }).returning();
  await tx.delete(calcomOauthStates).where(and(eq(calcomOauthStates.agentId, agentId), eq(calcomOauthStates.employeeId, employeeId)));
  return { ...calcomConnectionView(row!), lifecycleGeneration: row!.lifecycleGeneration };
 });
}

export async function reconcileCalcomOAuthSetup(agentId: string, employeeId: string, connectionId: string, subscriberUrl: string, userId?: string) {
 const notReady = { ready: false, status: 'setup_required' as const };
 let parsedUrl: string;
 try {
  parsedUrl = z.string().url().max(2048).parse(subscriberUrl);
  const target = new URL(parsedUrl);
  if ((target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname)))
   || target.username || target.password || target.search || target.hash
   || target.pathname !== `/api/calcom/webhooks/${connectionId}`) return notReady;
  if (!env.CALCOM_WEBHOOK_SECRET) return notReady;
 } catch { return notReady; }

 let claimed: Connection;
 try {
  claimed = await db.transaction(async tx => {
   await lockCalcomLifecycle(tx, agentId, employeeId);
   if (userId) await lockMemberLinks(tx, agentId);
   await lockEmployee(tx, agentId, employeeId);
   if (userId) {
    const [linked] = await tx.select({ id: workspaceMembers.userId }).from(workspaceMembers).where(and(
     eq(workspaceMembers.agentId, agentId), eq(workspaceMembers.userId, userId), eq(workspaceMembers.employeeId, employeeId))).limit(1);
    if (!linked) throw new Error('Employee link unavailable');
   }
   const [connection] = await tx.select().from(calcomConnections).where(and(scope(agentId, employeeId), eq(calcomConnections.id, connectionId),
    eq(calcomConnections.authKind, 'oauth'), or(eq(calcomConnections.status, 'active'), eq(calcomConnections.status, 'setup_required')))).for('update');
   if (!connection) throw new Error('Connection unavailable');
   if (leaseIsLive(connection.lifecycleLeaseExpiresAt)) throw new Error('Cal.com lifecycle operation is in progress');
   if (leaseIsLive(connection.credentialRefreshLeaseExpiresAt)) throw new Error('Cal.com credential refresh is in progress');
   const lease = new Date(Date.now() + lifecycleLeaseMs);
   const [row] = await tx.update(calcomConnections).set({ status: 'setup_required', lifecycleGeneration: connection.lifecycleGeneration + 1,
    lifecycleLeaseExpiresAt: lease, credentialRefreshLeaseExpiresAt: null, updatedAt: new Date() })
    .where(exactConnection(agentId, employeeId, connection)).returning();
   if (!row) throw new Error('Cal.com connection changed while claiming setup');
   return row;
  });
 } catch { return notReady; }

 let operation = claimed;
 let event: CalcomEventType | undefined;
 let webhook: Awaited<ReturnType<CalcomClient['webhooks']>>[number] | undefined;
 let providerReady = false;
 try {
  if (!await oauthClient(agentId, employeeId, connectionId, 'setup_required', ['setup_required'])) throw new Error('Cal.com setup authorization unavailable');
  const [refreshed] = await db.select().from(calcomConnections).where(and(scope(agentId, employeeId), eq(calcomConnections.id, connectionId),
   eq(calcomConnections.status, 'setup_required'), eq(calcomConnections.lifecycleGeneration, claimed.lifecycleGeneration),
   sameTimestamp(calcomConnections.lifecycleLeaseExpiresAt, claimed.lifecycleLeaseExpiresAt), isNull(calcomConnections.credentialRefreshLeaseExpiresAt))).limit(1);
  if (!refreshed) throw new Error('Cal.com setup claim changed');
  operation = refreshed;
  const bundle = oauthBundle.parse(JSON.parse(decryptToken(operation.encryptedCredential, owner(agentId, operation.id), key())));
  if (bundle.expiresAt <= Date.now()) throw new Error('Cal.com setup authorization unavailable');
  const client = new CalcomClient(bundle.accessToken, env.CALCOM_API_BASE_URL, undefined, env.CALCOM_OAUTH_WRITE_APPROVED);
   const slug = eventSlug(employeeId);
   event = (await client.eventTypes()).find(item => item.slug === slug);
   if (!event) {
    try { event = await client.createEventType({ title: eventTitle, slug, lengthInMinutes: 30 }); }
    catch { event = (await client.eventTypes()).find(item => item.slug === slug); }
   }
   if (!event || event.title !== eventTitle || event.slug !== slug || event.lengthInMinutes !== 30 || !event.destinationCalendar) {
    throw new Error('Cal.com event type setup incomplete');
   }

   const expected = [...bookingTriggers];
   const matches = (item: Awaited<ReturnType<CalcomClient['webhooks']>>[number]) => item.subscriberUrl === parsedUrl
    && item.active && expected.every(trigger => item.triggers.includes(trigger)) && item.triggers.every(trigger => expected.includes(trigger));
   const existingWebhooks = await client.webhooks();
   webhook = existingWebhooks.find(item => matches(item) && item.id === operation.webhookId);
   if (!webhook) {
    const stale = existingWebhooks.find(item => item.subscriberUrl === parsedUrl);
    if (stale) {
     try { await client.deleteWebhook(stale.id); } catch { /* the next list is the proof of provider state */ }
    if ((await client.webhooks()).some(item => item.subscriberUrl === parsedUrl)) throw new Error('Cal.com webhook setup incomplete');
    }
    try { webhook = await client.createWebhook({ subscriberUrl: parsedUrl, secret: deriveSecret(connectionId) }); }
    catch { webhook = (await client.webhooks()).find(matches); }
   }
   if (!webhook || !matches(webhook)) throw new Error('Cal.com webhook setup incomplete');
   providerReady = true;
 } catch { /* finalize the exact claimed generation as retryable below */ }

 const saved = await db.transaction(async tx => {
  await lockCalcomLifecycle(tx, agentId, employeeId);
  if (userId) await lockMemberLinks(tx, agentId);
  if (providerReady) {
   await lockEmployee(tx, agentId, employeeId, true);
   const [pending] = await tx.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.agentId, agentId),
    eq(appointments.employeeId, employeeId), eq(appointments.status, 'requested'))).limit(1);
   if (pending) providerReady = false;
  }
  if (providerReady && userId) {
   const [linked] = await tx.select({ id: workspaceMembers.userId }).from(workspaceMembers).where(and(
    eq(workspaceMembers.agentId, agentId), eq(workspaceMembers.userId, userId), eq(workspaceMembers.employeeId, employeeId))).limit(1);
   if (!linked) providerReady = false;
  }
  if (!providerReady || !event?.destinationCalendar || !webhook) {
   await tx.update(calcomConnections).set({ status: 'setup_required', lifecycleLeaseExpiresAt: null,
    ...(event && !event.destinationCalendar ? { eventTypeId: event.id, webhookId: null,
     destinationCalendarIntegration: null, destinationCalendarExternalId: null } : {}), updatedAt: new Date() })
    .where(exactConnection(agentId, employeeId, operation));
   return false;
  }
  const [active] = await tx.update(calcomConnections).set({ eventTypeId: event.id, webhookId: webhook.id, status: 'active',
   destinationCalendarIntegration: event.destinationCalendar.integration, destinationCalendarExternalId: event.destinationCalendar.externalId,
   lifecycleLeaseExpiresAt: null, updatedAt: new Date() }).where(exactConnection(agentId, employeeId, operation)).returning({ id: calcomConnections.id });
  if (!active) return false;
  await tx.update(employees).set({ calendarPolicy: { authority: 'calcom', eventType: null, connectionId,
   eventTypeId: event.id, eventTypeSlug: event.slug, eventTypeTitle: event.title, bookingUrl: event.bookingUrl }, updatedAt })
   .where(and(eq(employees.agentId, agentId), eq(employees.id, employeeId)));
  return true;
 });
 return saved ? { ready: true, status: 'active' as const } : notReady;
}

function deriveSecret(connectionId: string) {
 if (!env.CALCOM_WEBHOOK_SECRET) throw new Error('Cal.com webhook setup unavailable');
 return deriveCalcomWebhookSecret(env.CALCOM_WEBHOOK_SECRET, connectionId);
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
export async function disconnectCalcom(agentId: string, employeeId: string, connectionId: string, subscriberUrl?: string, userId?: string) {
 const [starting] = await db.select({ authKind: calcomConnections.authKind }).from(calcomConnections)
  .where(and(scope(agentId, employeeId), eq(calcomConnections.id, connectionId))).limit(1);
 if (!starting) throw new Error('Connection unavailable');
 let parsedUrl: string | null = null;
 if (starting.authKind === 'oauth') {
  parsedUrl = z.string().url().max(2048).parse(subscriberUrl);
  const target = new URL(parsedUrl);
  if ((target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname)))
   || target.username || target.password || target.search || target.hash || target.pathname !== `/api/calcom/webhooks/${connectionId}`) {
   throw new Error('Cal.com webhook cleanup URL unavailable');
  }
 }
 const fenced = await db.transaction(async tx => {
  await lockCalcomLifecycle(tx, agentId, employeeId);
  if (userId) await lockMemberLinks(tx, agentId);
  const employee = await lockEmployee(tx, agentId, employeeId);
  if (userId) {
   const [linked] = await tx.select({ id: workspaceMembers.userId }).from(workspaceMembers).where(and(
    eq(workspaceMembers.agentId, agentId), eq(workspaceMembers.userId, userId), eq(workspaceMembers.employeeId, employeeId))).limit(1);
   if (!linked) throw new Error('Employee link unavailable');
  }
  const [active] = await tx.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.agentId, agentId),
   eq(appointments.externalCalendarConnectionId, connectionId), ne(appointments.status, 'cancelled'))).limit(1);
  if (active) throw new Error('Resolve or cancel existing Cal.com appointments before disconnecting');
  const [connection] = await tx.select().from(calcomConnections).where(and(scope(agentId, employeeId), eq(calcomConnections.id, connectionId))).for('update');
  if (!connection) throw new Error('Connection unavailable');
  if (leaseIsLive(connection.lifecycleLeaseExpiresAt)) throw new Error('Cal.com lifecycle operation is in progress');
  if (leaseIsLive(connection.credentialRefreshLeaseExpiresAt)) throw new Error('Cal.com credential refresh is in progress');
  const [claimed] = await tx.update(calcomConnections).set({ status: 'disconnecting', lifecycleGeneration: connection.lifecycleGeneration + 1,
   lifecycleLeaseExpiresAt: new Date(Date.now() + lifecycleLeaseMs), credentialRefreshLeaseExpiresAt: null, updatedAt: new Date() })
   .where(exactConnection(agentId, employeeId, connection)).returning();
  if (!claimed) throw new Error('Cal.com connection changed while claiming disconnect');
  if (employee.calendarPolicy.authority === 'calcom' && employee.calendarPolicy.connectionId === connectionId) {
   await tx.update(employees).set({ calendarPolicy: { authority: 'direct', booking: null, conflicts: [] }, updatedAt })
    .where(and(eq(employees.agentId, agentId), eq(employees.id, employeeId)));
  }
  await tx.delete(calcomOauthStates).where(and(eq(calcomOauthStates.agentId, agentId), eq(calcomOauthStates.employeeId, employeeId)));
  return claimed;
 });

 let operation = fenced;
 let providerConfirmed = fenced.authKind !== 'oauth';
 if (fenced.authKind === 'oauth') {
  try {
   if (!await oauthClient(agentId, employeeId, connectionId, 'disconnecting', ['disconnecting'])) throw new Error('Cal.com webhook cleanup authorization unavailable');
   const [refreshed] = await db.select().from(calcomConnections).where(and(scope(agentId, employeeId), eq(calcomConnections.id, connectionId),
    eq(calcomConnections.status, 'disconnecting'), eq(calcomConnections.lifecycleGeneration, fenced.lifecycleGeneration),
    sameTimestamp(calcomConnections.lifecycleLeaseExpiresAt, fenced.lifecycleLeaseExpiresAt), isNull(calcomConnections.credentialRefreshLeaseExpiresAt))).limit(1);
   if (!refreshed) throw new Error('Cal.com disconnect claim changed');
   operation = refreshed;
   const bundle = oauthBundle.parse(JSON.parse(decryptToken(operation.encryptedCredential, owner(agentId, operation.id), key())));
   if (bundle.expiresAt <= Date.now()) throw new Error('Cal.com webhook cleanup authorization unavailable');
   const client = new CalcomClient(bundle.accessToken, env.CALCOM_API_BASE_URL, undefined, env.CALCOM_OAUTH_WRITE_APPROVED);
   const before = await client.webhooks();
   const cleanup = [...new Map(before.filter(webhook => webhook.id === operation.webhookId || webhook.subscriberUrl === parsedUrl)
    .map(webhook => [webhook.id, webhook])).values()];
   await Promise.allSettled(cleanup.map(webhook => client.deleteWebhook(webhook.id)));
   const after = await client.webhooks();
   providerConfirmed = !after.some(webhook => webhook.id === operation.webhookId || webhook.subscriberUrl === parsedUrl);
  } catch {
   providerConfirmed = false;
  }
 }

 const deleted = await db.transaction(async tx => {
  await lockCalcomLifecycle(tx, agentId, employeeId);
  if (providerConfirmed) await lockEmployee(tx, agentId, employeeId, true);
  const [active] = await tx.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.agentId, agentId),
   eq(appointments.externalCalendarConnectionId, connectionId), ne(appointments.status, 'cancelled'))).limit(1);
  if (active || !providerConfirmed) {
   await tx.update(calcomConnections).set({ status: 'disconnecting', lifecycleLeaseExpiresAt: null, updatedAt: new Date() })
    .where(exactConnection(agentId, employeeId, operation));
   return false;
  }
  const [row] = await tx.delete(calcomConnections).where(exactConnection(agentId, employeeId, operation)).returning({ id: calcomConnections.id });
  return !!row;
 });
 if (!deleted) throw new Error(providerConfirmed ? 'Cal.com connection changed during cleanup' : 'Cal.com webhook cleanup could not be confirmed');
}
export async function disconnectEmployeeCalcom(agentId: string, userId: string, employeeId: string, connectionId: string, subscriberUrl: string) {
 await disconnectCalcom(agentId, employeeId, connectionId, subscriberUrl, userId);
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
