import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { calcomConnections, calcomOauthStates, calcomWebhookReceipts } from '../src/db/schema.js';
import { createWorkspace, updateMember } from '../src/repositories/workspaces.js';
import { createEmployee, getEmployee } from '../src/repositories/employees.js';
import { connectCalcom, consumeCalcomOAuthState, getCalcomClient, getEmployeeCalcomSelf, listCalcomConnections, reconcileCalcomOAuthSetup, saveCalcomOAuthGrant, selectCalcomEventType, disconnectCalcom, ingestCalcomWebhook, startCalcomOAuthState } from '../src/repositories/calcom.js';
import { env } from '../src/env.js';
const originalKey = env.TOKEN_ENCRYPTION_KEY;
const originalWriteApproval = env.CALCOM_OAUTH_WRITE_APPROVED;
const originalWebhookSecret = env.CALCOM_WEBHOOK_SECRET;
const oauthSlug = (employeeId: string) => `deskroute-${createHash('sha256').update(`employee:${employeeId.toLowerCase()}`).digest('hex').slice(0, 20)}`;
beforeEach(() => { env.TOKEN_ENCRYPTION_KEY = '12'.repeat(32); env.CALCOM_OAUTH_WRITE_APPROVED = true; env.CALCOM_WEBHOOK_SECRET = 'w'.repeat(32); vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 'success', data: { id: 123, email: 'sam@example.test', username: 'sam' } })))); });
afterEach(() => { env.TOKEN_ENCRYPTION_KEY = originalKey; env.CALCOM_OAUTH_WRITE_APPROVED = originalWriteApproval; env.CALCOM_WEBHOOK_SECRET = originalWebhookSecret; vi.unstubAllGlobals(); });
async function fixture(owner = 'owner') { const a = (await createWorkspace(owner, `${owner}@example.test`, 'Test', 'UTC', 'team'))!.id; const e = await createEmployee(a, { displayName: 'Sam', timezone: 'UTC' }); return { a, e }; }
async function oauthStarting(agentId: string, employeeId: string, userId: string) {
 const stateHash = createHash('sha256').update(crypto.randomUUID()).digest('hex');
 const browserHash = createHash('sha256').update(crypto.randomUUID()).digest('hex');
 await startCalcomOAuthState(agentId, employeeId, userId, stateHash, browserHash);
 return (await consumeCalcomOAuthState(stateHash, browserHash))!;
}
async function oauthConnection(agentId: string, employeeId: string, userId: string, providerId = 900) {
 return saveCalcomOAuthGrant(agentId, employeeId, userId,
  { accessToken: `ACCESS-${providerId}`, refreshToken: `REFRESH-${providerId}`, expiresAt: Date.now() + 3600_000 },
  { id: providerId, email: `${userId}@cal.example`, username: userId }, await oauthStarting(agentId, employeeId, userId));
}
it('encrypts with tenant identity, never discloses credentials, and prevents cross-tenant access', async () => {
 const { a, e } = await fixture(), other = await fixture('other');
 const connection = await connectCalcom(a, e.id, 'PRIVATE_API_KEY');
 const [raw] = await db.select().from(calcomConnections).where(eq(calcomConnections.id, connection.id));
 expect(raw!.encryptedCredential).not.toContain('PRIVATE_API_KEY'); expect(raw!.encryptedCredential).toMatch(/\./);
 expect(JSON.stringify(await listCalcomConnections(a))).not.toMatch(/PRIVATE_API_KEY|encryptedCredential/);
 expect(await getCalcomClient(a, e.id, connection.id)).not.toBeNull();
 expect(await getCalcomClient(other.a, e.id, connection.id)).toBeNull();
 expect(await getCalcomClient(a, other.e.id, connection.id)).toBeNull();
 vi.mocked(fetch).mockClear(); await expect(connectCalcom(other.a, e.id, 'PRIVATE_API_KEY')).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});
it('denies client-role reads and writes on Cal.com credentials and receipts', async () => {
 const { a, e } = await fixture(); const connection = await connectCalcom(a, e.id, 'PRIVATE_API_KEY');
 for (const table of ['calcom_connections', 'calcom_webhook_receipts']) {
  await expect(db.transaction(async tx => {
   await tx.execute(sql`CREATE ROLE calcom_rls_test NOLOGIN`);
   await tx.execute(sql`GRANT USAGE ON SCHEMA public TO calcom_rls_test`);
   await tx.execute(sql.raw(`GRANT SELECT, INSERT ON ${table} TO calcom_rls_test`));
   await tx.execute(sql`SET LOCAL ROLE calcom_rls_test`);
   expect((await tx.execute(sql.raw(`SELECT * FROM ${table}`))).rows).toEqual([]);
   await tx.execute(sql.raw(table === 'calcom_connections'
    ? `INSERT INTO ${table} (agent_id, employee_id, encrypted_credential, provider_user_id, account_email, display_label) VALUES ('${a}', '${e.id}', 'denied', 'denied', 'denied@example.test', 'denied')`
    : `INSERT INTO ${table} (connection_id, digest, booking_uid, event_type) VALUES ('${connection.id}', '${'a'.repeat(64)}', 'denied', 'BOOKING_CREATED')`));
  })).rejects.toMatchObject({ cause: expect.objectContaining({ code: '42501' }) });
 }
});
it('cleans selected references on local disconnect and deduplicates durable receipts', async () => {
 const { a, e } = await fixture(); const c = await connectCalcom(a, e.id, 'PRIVATE_API_KEY');
 await selectCalcomEventType(a, e.id, c.id, { id: 12, slug: 'intro', title: 'Intro', lengthInMinutes: 30, bookingUrl: 'https://cal.com/sam/intro' });
 const event = { uid: 'booking', type: 'BOOKING_CREATED' as const, status: 'accepted' as const, digest: 'a'.repeat(64), eventTypeId: 12, start: '2026-09-14T10:00:00Z', end: '2026-09-14T10:30:00Z', metadata: {} };
 await Promise.all([ingestCalcomWebhook(c.id, event), ingestCalcomWebhook(c.id, event)]);
 expect(await db.select().from(calcomWebhookReceipts)).toHaveLength(1);
 vi.mocked(fetch).mockClear(); await disconnectCalcom(a, e.id, c.id); expect(fetch).not.toHaveBeenCalled();
 expect((await getEmployee(a, e.id))!.calendarPolicy).toEqual({ authority: 'direct', booking: null, conflicts: [] });
});
it('does not assign one provider identity to unrelated employees', async () => {
 const { a, e } = await fixture(); await connectCalcom(a, e.id, 'PRIVATE_API_KEY'); const other = await createEmployee(a, { displayName: 'Other', timezone: 'UTC' });
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 'success', data: { id: 123, email: 'sam@example.test', username: 'sam' } }))));
 await expect(connectCalcom(a, other.id, 'PRIVATE_API_KEY')).rejects.toThrow(); expect(await listCalcomConnections(a)).toHaveLength(1);
});
it('reconciles only a matching owned booking and retains an uncertain reservation', async () => {
 const { reserveEmployeeAppointment } = await import('../src/repositories/appointments.js');
 const { reconcileCalcomAppointment } = await import('../src/repositories/calcom.js');
 const { a, e } = await fixture(); const c = await connectCalcom(a, e.id, 'PRIVATE_API_KEY');
 const current = (await getEmployee(a, e.id))!;
 const input = { employeeId: e.id, expectedEmployeeUpdatedAt: current.updatedAt, callerName: 'Caller', startTime: new Date('2026-09-14T10:00:00Z'), endTime: new Date('2026-09-14T11:00:00Z'), externalCalendarId: 'calcom:12', externalCalendarConnectionId: c.id };
 const results = await Promise.all([reserveEmployeeAppointment(a, input), reserveEmployeeAppointment(a, input)]);
 expect(results.filter(Boolean)).toHaveLength(1); const appointment = results.find(Boolean)!;
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 'success', data: { id: 123, email: 'sam@example.test', username: 'sam' } }))));
 expect(await connectCalcom(a, e.id, 'ROTATED_PRIVATE_KEY')).toMatchObject({ id: c.id, status: 'active' });
 const data = { uid: 'uid', status: 'accepted', start: input.startTime.toISOString(), end: input.endTime.toISOString(), eventTypeId: 12, metadata: { agentId: a, employeeId: e.id, appointmentId: appointment.id } };
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 'success', data: { ...data, metadata: { ...data.metadata, employeeId: crypto.randomUUID() } } }))));
 expect(await reconcileCalcomAppointment(a, appointment.id, 'uid')).toBeNull();
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 'success', data }))));
 expect(await reconcileCalcomAppointment(a, appointment.id, 'uid')).toMatchObject({ status: 'confirmed', externalEventId: 'uid', providerWriteState: null });
 await expect(disconnectCalcom(a, e.id, c.id)).rejects.toThrow();
});

async function reserved() {
 const { reserveEmployeeAppointment } = await import('../src/repositories/appointments.js');
 const { a, e } = await fixture(); const c = await connectCalcom(a, e.id, 'PRIVATE_API_KEY');
 const current = (await getEmployee(a, e.id))!;
 const row = (await reserveEmployeeAppointment(a, { employeeId: e.id, expectedEmployeeUpdatedAt: current.updatedAt, callerName: 'Caller', startTime: new Date('2026-09-14T10:00:00Z'), endTime: new Date('2026-09-14T11:00:00Z'), externalCalendarId: 'calcom:12', externalCalendarConnectionId: c.id }))!;
 const event = { uid: 'first', type: 'BOOKING_CREATED' as const, status: 'accepted' as const, digest: 'b'.repeat(64), eventTypeId: 12, start: row.startTime!.toISOString(), end: row.endTime!.toISOString(), metadata: { agentId: a, employeeId: e.id, appointmentId: row.id } };
 return { a, e, c, row, event };
}
it('never replaces an established UID on late or different webhook delivery', async () => {
 const { appointments } = await import('../src/db/schema.js'); const { c, row, event } = await reserved();
 await ingestCalcomWebhook(c.id, event);
 await ingestCalcomWebhook(c.id, { ...event, uid: 'late', type: 'BOOKING_CANCELLED', status: 'cancelled', digest: 'c'.repeat(64) });
 const [saved] = await db.select().from(appointments).where(eq(appointments.id, row.id));
 expect(saved).toMatchObject({ externalEventId: 'first', status: 'requested', providerWriteState: 'reconciliation_required' });
});
it('records an official webhook without eventTypeId but does not mutate an appointment', async () => {
 const { appointments } = await import('../src/db/schema.js'); const { c, row, event } = await reserved();
 const standard = { ...event, eventTypeId: undefined };
 await ingestCalcomWebhook(c.id, standard);
 expect((await db.select().from(appointments).where(eq(appointments.id, row.id)))[0]).toMatchObject({ externalEventId: null, status: 'requested', providerWriteState: 'in_flight' });
 expect(await db.select().from(calcomWebhookReceipts)).toEqual([expect.objectContaining({ connectionId: c.id, digest: event.digest })]);
});
it.each(['agent', 'employee', 'start', 'end', 'eventType'])('ignores mismatched webhook %s', async mismatch => {
 const { appointments } = await import('../src/db/schema.js'); const { c, row, event } = await reserved();
 if (mismatch === 'agent') event.metadata.agentId = crypto.randomUUID();
 if (mismatch === 'employee') event.metadata.employeeId = crypto.randomUUID();
 if (mismatch === 'start') event.start = '2026-09-14T09:00:00Z';
 if (mismatch === 'end') event.end = '2026-09-14T12:00:00Z';
 if (mismatch === 'eventType') event.eventTypeId = 13;
 await ingestCalcomWebhook(c.id, event);
 expect((await db.select().from(appointments).where(eq(appointments.id, row.id)))[0]).toMatchObject({ externalEventId: null, providerWriteState: 'in_flight' });
});
it.each(['success', 'rejection'])('webhook wins against late provider %s finalization', async outcome => {
 const { finishEmployeeAppointment } = await import('../src/repositories/appointments.js'); const { a, c, row, event } = await reserved();
 await ingestCalcomWebhook(c.id, event);
 expect(await finishEmployeeAppointment(a, row.id, outcome === 'success' ? 'first' : null)).toBeNull();
});
it('uses validated supplied UID to repair a stale stored UID', async () => {
 const { reconcileCalcomAppointment } = await import('../src/repositories/calcom.js'); const { a, c, row, event } = await reserved();
 await ingestCalcomWebhook(c.id, event);
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 'success', data: { uid: 'correct', status: 'accepted', start: event.start, end: event.end, eventTypeId: 12, metadata: event.metadata } }))));
 expect(await reconcileCalcomAppointment(a, row.id, 'correct')).toMatchObject({ externalEventId: 'correct', status: 'confirmed' });
 expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain('/correct');
});
it('prunes receipts older than fourteen days during ingestion, retaining recent receipts', async () => {
 const { c, event } = await reserved();
 await db.insert(calcomWebhookReceipts).values([{ connectionId: c.id, digest: 'old', bookingUid: 'old', eventType: event.type, createdAt: new Date(Date.now() - 15 * 86400000) }, { connectionId: c.id, digest: 'recent', bookingUid: 'recent', eventType: event.type }]);
 await ingestCalcomWebhook(c.id, event);
 expect((await db.select().from(calcomWebhookReceipts)).map(r => r.digest).sort()).toEqual([event.digest, 'recent'].sort());
});
it('indexes receipt retention and requires completed setup before OAuth can become active', async () => {
 const { c } = await reserved();
 const indexes = await db.execute(sql`select indexdef from pg_indexes where tablename = 'calcom_webhook_receipts'`);
 expect(indexes.rows.map(r => r.indexdef).join(' ')).toContain('(connection_id, created_at)');
 await expect(db.update(calcomConnections).set({ authKind: 'oauth' }).where(eq(calcomConnections.id, c.id))).rejects.toThrow();
 await expect(db.update(calcomConnections).set({ authKind: 'oauth', status: 'setup_required' }).where(eq(calcomConnections.id, c.id))).resolves.toBeDefined();
});

it('encrypts OAuth bundles and serializes refresh-token rotation per connection', async () => {
 const { a, e } = await fixture('oauth-owner');
 await updateMember(a, 'oauth-owner', 'oauth-owner', { employeeId: e.id });
 const oldId = env.CALCOM_OAUTH_CLIENT_ID, oldSecret = env.CALCOM_OAUTH_CLIENT_SECRET;
 env.CALCOM_OAUTH_CLIENT_ID = 'client'; env.CALCOM_OAUTH_CLIENT_SECRET = 'secret';
 try {
  const connection = await saveCalcomOAuthGrant(a, e.id, 'oauth-owner',
   { accessToken: 'OLD_ACCESS', refreshToken: 'OLD_REFRESH', expiresAt: Date.now() - 1 },
   { id: 321, email: 'oauth@example.test', username: 'oauth-user' }, await oauthStarting(a, e.id, 'oauth-owner'));
  await db.update(calcomConnections).set({ status: 'active', eventTypeId: 12, webhookId: 'webhook',
   destinationCalendarIntegration: 'google_calendar', destinationCalendarExternalId: 'work@example.test' }).where(eq(calcomConnections.id, connection.id));
  let release!: () => void, announce!: () => void;
  const started = new Promise<void>(resolve => { announce = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetchMock = vi.fn().mockImplementation(async () => {
   announce(); await gate;
   return new Response(JSON.stringify({ access_token: 'NEW_ACCESS', token_type: 'bearer', refresh_token: 'NEW_REFRESH', expires_in: 1800 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  const pending = Promise.all([getCalcomClient(a, e.id, connection.id), getCalcomClient(a, e.id, connection.id)]);
  await started;
  const [refreshing] = await db.select().from(calcomConnections).where(eq(calcomConnections.id, connection.id));
  expect(refreshing!.credentialRefreshLeaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  expect(fetchMock).toHaveBeenCalledOnce();
  release();
  const clients = await pending;
  expect(clients.every(Boolean)).toBe(true); expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0]![0]).toBe('https://api.cal.com/v2/auth/oauth2/token');
  expect(Object.fromEntries((fetchMock.mock.calls[0]![1]!.body as URLSearchParams).entries())).toMatchObject({ refresh_token: 'OLD_REFRESH' });
  const [raw] = await db.select().from(calcomConnections).where(eq(calcomConnections.id, connection.id));
  expect(raw).toMatchObject({ credentialVersion: 2, credentialRefreshLeaseExpiresAt: null });
  expect(raw!.encryptedCredential).not.toMatch(/OLD_ACCESS|OLD_REFRESH|NEW_ACCESS|NEW_REFRESH/);
  expect(JSON.stringify(await getEmployeeCalcomSelf(a, 'oauth-owner'))).not.toMatch(/encryptedCredential|ACCESS|REFRESH/);
 } finally { env.CALCOM_OAUTH_CLIENT_ID = oldId; env.CALCOM_OAUTH_CLIENT_SECRET = oldSecret; }
});

it('reclaims an expired credential refresh lease without reusing a rotating refresh token concurrently', async () => {
 const { a, e } = await fixture('expired-refresh');
 await updateMember(a, 'expired-refresh', 'expired-refresh', { employeeId: e.id });
 const oldId = env.CALCOM_OAUTH_CLIENT_ID, oldSecret = env.CALCOM_OAUTH_CLIENT_SECRET;
 env.CALCOM_OAUTH_CLIENT_ID = 'client'; env.CALCOM_OAUTH_CLIENT_SECRET = 'secret';
 try {
  const connection = await saveCalcomOAuthGrant(a, e.id, 'expired-refresh',
   { accessToken: 'EXPIRED_ACCESS', refreshToken: 'EXPIRING_REFRESH', expiresAt: Date.now() - 1 },
   { id: 323, email: 'expired-refresh@example.test', username: 'expired-refresh' }, await oauthStarting(a, e.id, 'expired-refresh'));
  await db.update(calcomConnections).set({ status: 'active', eventTypeId: 12, webhookId: 'webhook',
   destinationCalendarIntegration: 'google_calendar', destinationCalendarExternalId: 'work@example.test',
   credentialRefreshLeaseExpiresAt: new Date(Date.now() - 1) }).where(eq(calcomConnections.id, connection.id));
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'ROTATED_ACCESS', token_type: 'bearer', refresh_token: 'ROTATED_REFRESH', expires_in: 1800 })));
  vi.stubGlobal('fetch', fetchMock);
  const clients = await Promise.all([getCalcomClient(a, e.id, connection.id), getCalcomClient(a, e.id, connection.id)]);
  expect(clients.every(Boolean)).toBe(true);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect((await db.select().from(calcomConnections).where(eq(calcomConnections.id, connection.id)))[0])
   .toMatchObject({ credentialVersion: 2, credentialRefreshLeaseExpiresAt: null });
 } finally { env.CALCOM_OAUTH_CLIENT_ID = oldId; env.CALCOM_OAUTH_CLIENT_SECRET = oldSecret; }
});

it('does not hold the credential row lock while the provider rotates an OAuth refresh token', async () => {
 const { a, e } = await fixture('refresh-outside-tx');
 await updateMember(a, 'refresh-outside-tx', 'refresh-outside-tx', { employeeId: e.id });
 const oldId = env.CALCOM_OAUTH_CLIENT_ID, oldSecret = env.CALCOM_OAUTH_CLIENT_SECRET;
 env.CALCOM_OAUTH_CLIENT_ID = 'client'; env.CALCOM_OAUTH_CLIENT_SECRET = 'secret';
 try {
  const connection = await saveCalcomOAuthGrant(a, e.id, 'refresh-outside-tx',
   { accessToken: 'OLD_ACCESS', refreshToken: 'OLD_REFRESH', expiresAt: Date.now() - 1 },
   { id: 322, email: 'refresh-outside@example.test', username: 'refresh-outside' }, await oauthStarting(a, e.id, 'refresh-outside-tx'));
  await db.update(calcomConnections).set({ status: 'active', eventTypeId: 12, webhookId: 'webhook',
   destinationCalendarIntegration: 'google_calendar', destinationCalendarExternalId: 'work@example.test' }).where(eq(calcomConnections.id, connection.id));
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
   await db.transaction(async tx => {
    await tx.execute(sql`select id from calcom_connections where id = ${connection.id} for update nowait`);
   });
   return new Response(JSON.stringify({ access_token: 'NEW_ACCESS', token_type: 'bearer', refresh_token: 'NEW_REFRESH', expires_in: 1800 }));
  }));
  await expect(getCalcomClient(a, e.id, connection.id)).resolves.not.toBeNull();
 } finally { env.CALCOM_OAUTH_CLIENT_ID = oldId; env.CALCOM_OAUTH_CLIENT_SECRET = oldSecret; }
});

it('durably consumes browser-bound OAuth state once and records connect versus reconnect intent', async () => {
 const { a, e } = await fixture('state-owner');
 await updateMember(a, 'state-owner', 'state-owner', { employeeId: e.id });
 const stateHash = 'a'.repeat(64), browserHash = 'b'.repeat(64);
 const started = await startCalcomOAuthState(a, e.id, 'state-owner', stateHash, browserHash);
 expect(started).toMatchObject({ intent: 'connect', startingConnectionId: null, startingLifecycleGeneration: null });
 expect(await db.select().from(calcomOauthStates).where(eq(calcomOauthStates.stateHash, stateHash))).toHaveLength(1);
 expect(await consumeCalcomOAuthState(stateHash, 'c'.repeat(64))).toBeNull();
 expect(await consumeCalcomOAuthState(stateHash, browserHash)).toMatchObject({ agentId: a, employeeId: e.id, userId: 'state-owner', intent: 'connect' });
 expect(await consumeCalcomOAuthState(stateHash, browserHash)).toBeNull();
 await startCalcomOAuthState(a, e.id, 'state-owner', 'f'.repeat(64), '0'.repeat(64));
 await db.update(calcomOauthStates).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(calcomOauthStates.stateHash, 'f'.repeat(64)));
 expect(await consumeCalcomOAuthState('f'.repeat(64), '0'.repeat(64))).toBeNull();
 expect(await db.select().from(calcomOauthStates).where(eq(calcomOauthStates.stateHash, 'f'.repeat(64)))).toEqual([]);
 const connection = await oauthConnection(a, e.id, 'state-owner', 901);
 const reconnect = await startCalcomOAuthState(a, e.id, 'state-owner', 'd'.repeat(64), 'e'.repeat(64));
 expect(reconnect).toMatchObject({ intent: 'reconnect', startingConnectionId: connection.id, startingProviderUserId: '901',
  startingLifecycleGeneration: connection.lifecycleGeneration });
});

it('rejects a consumed reconnect callback after disconnect instead of recreating local state', async () => {
 const { a, e } = await fixture('stale-state-owner');
 await updateMember(a, 'stale-state-owner', 'stale-state-owner', { employeeId: e.id });
 const connection = await oauthConnection(a, e.id, 'stale-state-owner', 902);
 const starting = await oauthStarting(a, e.id, 'stale-state-owner');
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 'success', data: [] }))));
 await disconnectCalcom(a, e.id, connection.id, `https://api.example/api/calcom/webhooks/${connection.id}`);
 await expect(saveCalcomOAuthGrant(a, e.id, 'stale-state-owner',
  { accessToken: 'LATE', refreshToken: 'LATE-REFRESH', expiresAt: Date.now() + 3600_000 },
  { id: 902, email: 'late@example.test', username: 'late' }, starting)).rejects.toThrow('changed');
 expect(await db.select().from(calcomConnections).where(eq(calcomConnections.id, connection.id))).toEqual([]);
});

it('uses exact credential-version CAS for stale API-key and OAuth unauthorized responses', async () => {
 const api = await fixture('api-cas');
 const apiConnection = await connectCalcom(api.a, api.e.id, 'OLD-API');
 const staleApiClient = await getCalcomClient(api.a, api.e.id, apiConnection.id);
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'success', data: { id: 123, email: 'sam@example.test', username: 'sam' } }))));
 await connectCalcom(api.a, api.e.id, 'NEW-API');
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
 await expect(staleApiClient!.me()).rejects.toThrow();
 expect((await db.select().from(calcomConnections).where(eq(calcomConnections.id, apiConnection.id)))[0]).toMatchObject({ status: 'active', credentialVersion: 2 });

 const oauth = await fixture('oauth-cas');
 await updateMember(oauth.a, 'oauth-cas', 'oauth-cas', { employeeId: oauth.e.id });
 const old = await oauthConnection(oauth.a, oauth.e.id, 'oauth-cas', 903);
 await db.update(calcomConnections).set({ status: 'active', eventTypeId: 10, webhookId: 'webhook',
  destinationCalendarIntegration: 'google_calendar', destinationCalendarExternalId: 'work@example.test' }).where(eq(calcomConnections.id, old.id));
 const staleOauthClient = await getCalcomClient(oauth.a, oauth.e.id, old.id);
 const reconnect = await oauthStarting(oauth.a, oauth.e.id, 'oauth-cas');
 await saveCalcomOAuthGrant(oauth.a, oauth.e.id, 'oauth-cas',
  { accessToken: 'NEW', refreshToken: 'NEW-REFRESH', expiresAt: Date.now() + 3600_000 },
  { id: 903, email: 'oauth-cas@cal.example', username: 'oauth-cas' }, reconnect);
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
 await expect(staleOauthClient!.me()).rejects.toThrow();
 expect((await db.select().from(calcomConnections).where(eq(calcomConnections.id, old.id)))[0]).toMatchObject({ status: 'setup_required', credentialVersion: 2 });
});

it('makes zero automatic provider writes when Cal.com OAuth write approval is false', async () => {
 const { a, e } = await fixture('unapproved-owner');
 await updateMember(a, 'unapproved-owner', 'unapproved-owner', { employeeId: e.id });
 const connection = await oauthConnection(a, e.id, 'unapproved-owner', 904);
 env.CALCOM_OAUTH_WRITE_APPROVED = false;
 const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'success', data: [] })));
 vi.stubGlobal('fetch', fetchMock);
 await expect(reconcileCalcomOAuthSetup(a, e.id, connection.id, `https://api.example/api/calcom/webhooks/${connection.id}`))
  .resolves.toEqual({ ready: false, status: 'setup_required' });
 expect(fetchMock.mock.calls.filter(call => ['POST', 'DELETE'].includes(call[1]!.method))).toHaveLength(0);
});

it('keeps OAuth setup non-ready when the official event type output has no destination calendar', async () => {
 const { a, e } = await fixture('no-destination-owner');
 await updateMember(a, 'no-destination-owner', 'no-destination-owner', { employeeId: e.id });
 const connection = await oauthConnection(a, e.id, 'no-destination-owner', 905);
 const event = { id: 79, title: 'DeskRoute appointment', slug: oauthSlug(e.id), lengthInMinutes: 30,
  bookingUrl: `https://cal.com/no-destination/${oauthSlug(e.id)}`, recurrence: null, price: 0, isInstantEvent: false,
  seats: { disabled: true }, bookingFields: [], locations: [{ type: 'integration' }] };
 const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'success', data: [event] })));
 vi.stubGlobal('fetch', fetchMock);
 await expect(reconcileCalcomOAuthSetup(a, e.id, connection.id, `https://api.example/api/calcom/webhooks/${connection.id}`))
  .resolves.toEqual({ ready: false, status: 'setup_required' });
 expect(fetchMock).toHaveBeenCalledOnce();
 expect((await db.select().from(calcomConnections).where(eq(calcomConnections.id, connection.id)))[0]).toMatchObject({
  status: 'setup_required', eventTypeId: 79, webhookId: null, destinationCalendarIntegration: null, destinationCalendarExternalId: null,
 });
});

it('fences OAuth use, removes and confirms the provider webhook, then deletes local credentials', async () => {
 const { a, e } = await fixture('disconnect-owner');
 await updateMember(a, 'disconnect-owner', 'disconnect-owner', { employeeId: e.id });
 const connection = await oauthConnection(a, e.id, 'disconnect-owner', 906);
 const url = `https://api.example/api/calcom/webhooks/${connection.id}`;
 await db.update(calcomConnections).set({ status: 'active', eventTypeId: 12, webhookId: 'known-webhook',
  destinationCalendarIntegration: 'google_calendar', destinationCalendarExternalId: 'work@example.test' }).where(eq(calcomConnections.id, connection.id));
 const webhook = { id: 'known-webhook', subscriberUrl: url, active: true, triggers: ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'] };
 const fetchMock = vi.fn()
  .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: [webhook] })))
  .mockResolvedValueOnce(new Response(null, { status: 204 }))
  .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: [] })));
 vi.stubGlobal('fetch', fetchMock);
 await disconnectCalcom(a, e.id, connection.id, url);
 expect(fetchMock.mock.calls.map(call => call[1]!.method)).toEqual(['GET', 'DELETE', 'GET']);
 expect(await db.select().from(calcomConnections).where(eq(calcomConnections.id, connection.id))).toEqual([]);
});

it('does not hold lifecycle, workspace, or connection locks during disconnect provider I/O', async () => {
 const { a, e } = await fixture('disconnect-outside-tx');
 await updateMember(a, 'disconnect-outside-tx', 'disconnect-outside-tx', { employeeId: e.id });
 const connection = await oauthConnection(a, e.id, 'disconnect-outside-tx', 912);
 const url = `https://api.example/api/calcom/webhooks/${connection.id}`;
 await db.update(calcomConnections).set({ status: 'active', eventTypeId: 12, webhookId: 'known-webhook',
  destinationCalendarIntegration: 'google_calendar', destinationCalendarExternalId: 'work@example.test' }).where(eq(calcomConnections.id, connection.id));
 const webhook = { id: 'known-webhook', subscriberUrl: url, active: true,
  triggers: ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'] };
 let exists = true, checked = false;
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
  if (!checked) {
   checked = true;
   await db.transaction(async tx => {
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${'calcom-lifecycle:' + a + ':' + e.id})) as acquired`);
    expect(lock.rows[0]!.acquired).toBe(true);
    await tx.execute(sql`select agent_id from workspaces where agent_id = ${a} for update nowait`);
    await tx.execute(sql`select id from calcom_connections where id = ${connection.id} for update nowait`);
   });
   const [claim] = await db.select().from(calcomConnections).where(eq(calcomConnections.id, connection.id));
   expect(claim).toMatchObject({ status: 'disconnecting' });
   expect(claim!.lifecycleLeaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  }
  const requestUrl = String(input), method = init?.method ?? 'GET';
  if (requestUrl.endsWith('/webhooks') && method === 'GET') return new Response(JSON.stringify({ status: 'success', data: exists ? [webhook] : [] }));
  if (requestUrl.endsWith('/webhooks/known-webhook') && method === 'DELETE') { exists = false; return new Response(null, { status: 204 }); }
  throw new Error('Unexpected mocked provider request');
 }));
 await expect(disconnectCalcom(a, e.id, connection.id, url)).resolves.toBeUndefined();
 expect(checked).toBe(true);
});

it('retains recoverable fenced credentials when provider webhook cleanup remains ambiguous', async () => {
 const { a, e } = await fixture('ambiguous-disconnect');
 await updateMember(a, 'ambiguous-disconnect', 'ambiguous-disconnect', { employeeId: e.id });
 const connection = await oauthConnection(a, e.id, 'ambiguous-disconnect', 907);
 const url = `https://api.example/api/calcom/webhooks/${connection.id}`;
 await db.update(calcomConnections).set({ status: 'active', eventTypeId: 12, webhookId: 'known-webhook',
  destinationCalendarIntegration: 'google_calendar', destinationCalendarExternalId: 'work@example.test' }).where(eq(calcomConnections.id, connection.id));
 const webhook = { id: 'known-webhook', subscriberUrl: url, active: true, triggers: ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'] };
 vi.stubGlobal('fetch', vi.fn()
  .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: [webhook] })))
  .mockResolvedValueOnce(new Response('{}', { status: 503 }))
  .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: [webhook] }))));
 await expect(disconnectCalcom(a, e.id, connection.id, url)).rejects.toThrow('confirmed');
 const [saved] = await db.select().from(calcomConnections).where(eq(calcomConnections.id, connection.id));
 expect(saved).toMatchObject({ status: 'disconnecting', webhookId: 'known-webhook' });
 expect(saved!.encryptedCredential).toBeTruthy();
 expect(await getCalcomClient(a, e.id, connection.id)).toBeNull();
});

it('makes zero provider mutation requests during disconnect when OAuth write approval is false', async () => {
 const { a, e } = await fixture('unapproved-disconnect');
 await updateMember(a, 'unapproved-disconnect', 'unapproved-disconnect', { employeeId: e.id });
 const connection = await oauthConnection(a, e.id, 'unapproved-disconnect', 909);
 const url = `https://api.example/api/calcom/webhooks/${connection.id}`;
 await db.update(calcomConnections).set({ status: 'active', eventTypeId: 12, webhookId: 'known-webhook',
  destinationCalendarIntegration: 'google_calendar', destinationCalendarExternalId: 'work@example.test' }).where(eq(calcomConnections.id, connection.id));
 const webhook = { id: 'known-webhook', subscriberUrl: url, active: true, triggers: ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'] };
 env.CALCOM_OAUTH_WRITE_APPROVED = false;
 const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 'success', data: [webhook] })));
 vi.stubGlobal('fetch', fetchMock);
 await expect(disconnectCalcom(a, e.id, connection.id, url)).rejects.toThrow('confirmed');
 expect(fetchMock.mock.calls.map(call => call[1]!.method)).toEqual(['GET', 'GET']);
 expect((await db.select().from(calcomConnections).where(eq(calcomConnections.id, connection.id)))[0]).toMatchObject({ status: 'disconnecting' });
});

it('serializes concurrent setup and disconnect so no signed webhook is orphaned', async () => {
 const { a, e } = await fixture('setup-disconnect-race');
 await updateMember(a, 'setup-disconnect-race', 'setup-disconnect-race', { employeeId: e.id });
 const connection = await oauthConnection(a, e.id, 'setup-disconnect-race', 908);
 const reconnect = await oauthStarting(a, e.id, 'setup-disconnect-race');
 const url = `https://api.example/api/calcom/webhooks/${connection.id}`;
 const event = { id: 88, title: 'DeskRoute appointment', slug: oauthSlug(e.id), lengthInMinutes: 30,
  bookingUrl: `https://cal.com/race/${oauthSlug(e.id)}`, recurrence: null, price: 0, isInstantEvent: false,
  seats: { disabled: true }, bookingFields: [], locations: [{ type: 'integration' }],
  destinationCalendar: { integration: 'google_calendar', externalId: 'race@example.test' } };
 const webhook = { id: 'race-webhook', subscriberUrl: url, active: true,
  triggers: ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'] };
 let webhookExists = false, release!: () => void, announce!: () => void;
 const firstRead = new Promise<void>(resolve => { announce = resolve; });
 const gate = new Promise<void>(resolve => { release = resolve; });
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
  const requestUrl = String(input), method = init?.method ?? 'GET';
  if (requestUrl.endsWith('/event-types')) { announce(); await gate; return new Response(JSON.stringify({ status: 'success', data: [event] })); }
  if (requestUrl.endsWith('/webhooks') && method === 'GET') return new Response(JSON.stringify({ status: 'success', data: webhookExists ? [webhook] : [] }));
  if (requestUrl.endsWith('/webhooks') && method === 'POST') { webhookExists = true; return new Response(JSON.stringify({ status: 'success', data: webhook })); }
  if (requestUrl.endsWith('/webhooks/race-webhook') && method === 'DELETE') { webhookExists = false; return new Response(null, { status: 204 }); }
  throw new Error('Unexpected mocked provider request');
 }));
 const setup = reconcileCalcomOAuthSetup(a, e.id, connection.id, url);
 await firstRead;
 const [claimed] = await db.select().from(calcomConnections).where(eq(calcomConnections.id, connection.id));
 expect(claimed).toMatchObject({ status: 'setup_required' });
 expect(claimed!.lifecycleLeaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
 await expect(startCalcomOAuthState(a, e.id, 'setup-disconnect-race', '1'.repeat(64), '2'.repeat(64))).rejects.toThrow('in progress');
 await expect(saveCalcomOAuthGrant(a, e.id, 'setup-disconnect-race',
  { accessToken: 'OVERTAKE', refreshToken: 'OVERTAKE_REFRESH', expiresAt: Date.now() + 3600_000 },
  { id: 908, email: 'overtake@example.test', username: 'overtake' }, reconnect)).rejects.toThrow('in progress');
 await expect(disconnectCalcom(a, e.id, connection.id, url)).rejects.toThrow('in progress');
 release();
 await expect(setup).resolves.toEqual({ ready: true, status: 'active' });
 await expect(disconnectCalcom(a, e.id, connection.id, url)).resolves.toBeUndefined();
 expect(webhookExists).toBe(false);
 expect(await db.select().from(calcomConnections).where(eq(calcomConnections.id, connection.id))).toEqual([]);
});

it('does not let an old failed setup demote a newer active reconnect after lease expiry', async () => {
 const { a, e } = await fixture('stale-setup-failure');
 await updateMember(a, 'stale-setup-failure', 'stale-setup-failure', { employeeId: e.id });
 const connection = await oauthConnection(a, e.id, 'stale-setup-failure', 911);
 const url = `https://api.example/api/calcom/webhooks/${connection.id}`;
 const event = { id: 92, title: 'DeskRoute appointment', slug: oauthSlug(e.id), lengthInMinutes: 30,
  bookingUrl: `https://cal.com/stale-setup/${oauthSlug(e.id)}`, recurrence: null, price: 0, isInstantEvent: false,
  seats: { disabled: true }, bookingFields: [], locations: [{ type: 'integration' }],
  destinationCalendar: { integration: 'google_calendar', externalId: 'new-work@example.test' } };
 const webhook = { id: 'webhook-92', subscriberUrl: url, active: true,
  triggers: ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'] };
 let releaseOld!: () => void, announceOld!: () => void, eventReads = 0;
 const oldStarted = new Promise<void>(resolve => { announceOld = resolve; });
 const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
  const requestUrl = String(input), method = init?.method ?? 'GET';
  if (requestUrl.endsWith('/event-types')) {
   eventReads += 1;
   if (eventReads === 1) { announceOld(); await oldGate; return new Response('{}', { status: 503 }); }
   return new Response(JSON.stringify({ status: 'success', data: [event] }));
  }
  if (requestUrl.endsWith('/webhooks') && method === 'GET') return new Response(JSON.stringify({ status: 'success', data: [] }));
  if (requestUrl.endsWith('/webhooks') && method === 'POST') return new Response(JSON.stringify({ status: 'success', data: webhook }));
  throw new Error('Unexpected mocked provider request');
 }));
 const staleSetup = reconcileCalcomOAuthSetup(a, e.id, connection.id, url);
 await oldStarted;
 const [oldClaim] = await db.select().from(calcomConnections).where(eq(calcomConnections.id, connection.id));
 expect(oldClaim!.lifecycleGeneration).toBe(connection.lifecycleGeneration + 1);
 await db.update(calcomConnections).set({ lifecycleLeaseExpiresAt: new Date(Date.now() - 1) }).where(eq(calcomConnections.id, connection.id));
 const reconnect = await oauthStarting(a, e.id, 'stale-setup-failure');
 await saveCalcomOAuthGrant(a, e.id, 'stale-setup-failure',
  { accessToken: 'NEW_ACCESS', refreshToken: 'NEW_REFRESH', expiresAt: Date.now() + 3600_000 },
  { id: 911, email: 'new@example.test', username: 'new-user' }, reconnect);
 await expect(reconcileCalcomOAuthSetup(a, e.id, connection.id, url)).resolves.toEqual({ ready: true, status: 'active' });
 releaseOld();
 await expect(staleSetup).resolves.toEqual({ ready: false, status: 'setup_required' });
 expect((await db.select().from(calcomConnections).where(eq(calcomConnections.id, connection.id)))[0]).toMatchObject({
  status: 'active', credentialVersion: 2, webhookId: 'webhook-92', destinationCalendarExternalId: 'new-work@example.test', lifecycleLeaseExpiresAt: null,
 });
});

it('automatically creates the dedicated personal event type and signed webhook with mocked provider I/O', async () => {
 const { a, e } = await fixture('setup-owner');
 await updateMember(a, 'setup-owner', 'setup-owner', { employeeId: e.id });
 const previousRoot = env.CALCOM_WEBHOOK_SECRET;
 env.CALCOM_WEBHOOK_SECRET = 'w'.repeat(32);
 try {
  const connection = await saveCalcomOAuthGrant(a, e.id, 'setup-owner',
   { accessToken: 'ACCESS', refreshToken: 'REFRESH', expiresAt: Date.now() + 3600_000 },
   { id: 654, email: 'setup@example.test', username: 'setup-user' }, await oauthStarting(a, e.id, 'setup-owner'));
  const event = { id: 77, title: 'DeskRoute appointment', slug: oauthSlug(e.id), lengthInMinutes: 30,
   bookingUrl: `https://cal.com/setup/${oauthSlug(e.id)}`, recurrence: null, price: 0, isInstantEvent: false,
   seats: { disabled: true }, bookingFields: [], locations: [{ type: 'integration' }],
   destinationCalendar: { integration: 'google_calendar', externalId: 'work@example.test' } };
  const webhook = { id: 'webhook-77', subscriberUrl: `https://api.example/api/calcom/webhooks/${connection.id}`, active: true,
   triggers: ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'] };
  const fetchMock = vi.fn()
   .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: [] })))
   .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: event })))
   .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: [] })))
   .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: webhook })));
  vi.stubGlobal('fetch', fetchMock);
  await expect(reconcileCalcomOAuthSetup(a, e.id, connection.id, webhook.subscriberUrl)).resolves.toEqual({ ready: true, status: 'active' });
  const [saved] = await db.select().from(calcomConnections).where(eq(calcomConnections.id, connection.id));
  expect(saved).toMatchObject({ authKind: 'oauth', status: 'active', eventTypeId: 77, webhookId: 'webhook-77' });
  expect((await getEmployee(a, e.id))!.calendarPolicy).toMatchObject({ authority: 'calcom', connectionId: connection.id, eventTypeId: 77 });
  const webhookBody = JSON.parse(fetchMock.mock.calls[3]![1]!.body);
  expect(webhookBody).toMatchObject({ subscriberUrl: webhook.subscriberUrl, active: true, version: '2021-10-20', triggers: webhook.triggers });
  expect(webhookBody.secret).toMatch(/^[a-f0-9]{64}$/);
 } finally { env.CALCOM_WEBHOOK_SECRET = previousRoot; }
});

it('does not hold lifecycle, workspace, or connection locks during setup provider I/O', async () => {
 const { a, e } = await fixture('setup-outside-tx');
 await updateMember(a, 'setup-outside-tx', 'setup-outside-tx', { employeeId: e.id });
 const connection = await oauthConnection(a, e.id, 'setup-outside-tx', 910);
 const event = { id: 91, title: 'DeskRoute appointment', slug: oauthSlug(e.id), lengthInMinutes: 30,
  bookingUrl: `https://cal.com/setup-outside/${oauthSlug(e.id)}`, recurrence: null, price: 0, isInstantEvent: false,
  seats: { disabled: true }, bookingFields: [], locations: [{ type: 'integration' }],
  destinationCalendar: { integration: 'google_calendar', externalId: 'work@example.test' } };
 const webhook = { id: 'webhook-91', subscriberUrl: `https://api.example/api/calcom/webhooks/${connection.id}`, active: true,
  triggers: ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'] };
 let checked = false;
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
  if (!checked) {
   checked = true;
   await db.transaction(async tx => {
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${'calcom-lifecycle:' + a + ':' + e.id})) as acquired`);
    expect(lock.rows[0]!.acquired).toBe(true);
    await tx.execute(sql`select agent_id from workspaces where agent_id = ${a} for update nowait`);
    await tx.execute(sql`select id from calcom_connections where id = ${connection.id} for update nowait`);
   });
  }
  const requestUrl = String(input), method = init?.method ?? 'GET';
  if (requestUrl.endsWith('/event-types')) return new Response(JSON.stringify({ status: 'success', data: [event] }));
  if (requestUrl.endsWith('/webhooks') && method === 'GET') return new Response(JSON.stringify({ status: 'success', data: [] }));
  if (requestUrl.endsWith('/webhooks') && method === 'POST') return new Response(JSON.stringify({ status: 'success', data: webhook }));
  throw new Error('Unexpected mocked provider request');
 }));
 await expect(reconcileCalcomOAuthSetup(a, e.id, connection.id, webhook.subscriberUrl)).resolves.toEqual({ ready: true, status: 'active' });
 expect(checked).toBe(true);
});

it('reconciles ambiguous setup creates by deterministic slug and subscriber URL before retrying', async () => {
 const { a, e } = await fixture('ambiguous-owner');
 await updateMember(a, 'ambiguous-owner', 'ambiguous-owner', { employeeId: e.id });
 const previousRoot = env.CALCOM_WEBHOOK_SECRET; env.CALCOM_WEBHOOK_SECRET = 'w'.repeat(32);
 try {
  const connection = await saveCalcomOAuthGrant(a, e.id, 'ambiguous-owner',
   { accessToken: 'ACCESS', refreshToken: 'REFRESH', expiresAt: Date.now() + 3600_000 },
   { id: 777, email: 'ambiguous@example.test', username: 'ambiguous-user' }, await oauthStarting(a, e.id, 'ambiguous-owner'));
  const event = { id: 78, title: 'DeskRoute appointment', slug: oauthSlug(e.id), lengthInMinutes: 30,
   bookingUrl: `https://cal.com/ambiguous/${oauthSlug(e.id)}`, recurrence: null, price: 0, isInstantEvent: false,
   seats: { disabled: true }, bookingFields: [], locations: [{ type: 'integration' }],
   destinationCalendar: { integration: 'office365_calendar', externalId: 'calendar-id' } };
  const webhook = { id: 'webhook-78', subscriberUrl: `https://api.example/api/calcom/webhooks/${connection.id}`, active: true,
   triggers: ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'] };
  const fetchMock = vi.fn()
   .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: [] })))
   .mockResolvedValueOnce(new Response('{}', { status: 503 }))
   .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: [event] })))
   .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: [] })))
   .mockResolvedValueOnce(new Response('{}', { status: 503 }))
   .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: [webhook] })));
  vi.stubGlobal('fetch', fetchMock);
  await expect(reconcileCalcomOAuthSetup(a, e.id, connection.id, webhook.subscriberUrl)).resolves.toEqual({ ready: true, status: 'active' });
  expect(fetchMock.mock.calls.filter(call => call[1]!.method === 'POST')).toHaveLength(2);
 } finally { env.CALCOM_WEBHOOK_SECRET = previousRoot; }
});

it('fails closed as setup_required when Cal.com returns 401 or 403 during automatic setup', async () => {
 const previousRoot = env.CALCOM_WEBHOOK_SECRET; env.CALCOM_WEBHOOK_SECRET = 'w'.repeat(32);
 try { for (const status of [401, 403]) {
  const owner = `denied-${status}`, { a, e } = await fixture(owner);
  await updateMember(a, owner, owner, { employeeId: e.id });
  const connection = await saveCalcomOAuthGrant(a, e.id, owner,
   { accessToken: 'ACCESS', refreshToken: 'REFRESH', expiresAt: Date.now() + 3600_000 },
   { id: status, email: `${owner}@example.test`, username: owner }, await oauthStarting(a, e.id, owner));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
  await expect(reconcileCalcomOAuthSetup(a, e.id, connection.id, `https://api.example/api/calcom/webhooks/${connection.id}`))
   .resolves.toEqual({ ready: false, status: 'setup_required' });
  expect((await db.select().from(calcomConnections).where(eq(calcomConnections.id, connection.id)))[0]).toMatchObject({ status: 'setup_required', eventTypeId: null, webhookId: null });
 } } finally { env.CALCOM_WEBHOOK_SECRET = previousRoot; }
});
it.each(['status', 'uid', 'connection', 'employee', 'eventType', 'interval'])('reconciliation cannot overwrite concurrent %s changes', async changed => {
 const { appointments } = await import('../src/db/schema.js'); const { reconcileCalcomAppointment } = await import('../src/repositories/calcom.js');
 const { a, e, row, event } = await reserved();
 let resume!: () => void; let read!: () => void;
 const started = new Promise<void>(resolve => { read = resolve; });
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => { read(); await new Promise<void>(resolve => { resume = resolve; }); return new Response(JSON.stringify({ status: 'success', data: { uid: 'current', status: 'accepted', start: event.start, end: event.end, eventTypeId: 12, metadata: event.metadata } })); }));
 const pending = reconcileCalcomAppointment(a, row.id, 'current'); await started;
 const other = changed === 'employee' ? await createEmployee(a, { displayName: 'Other', timezone: 'UTC' }) : e;
 const update = changed === 'status' ? { status: 'cancelled' as const, providerWriteState: null } : changed === 'uid' ? { externalEventId: 'different' } : changed === 'connection' ? { externalCalendarConnectionId: crypto.randomUUID() } : changed === 'employee' ? { employeeId: other.id } : changed === 'eventType' ? { externalCalendarId: 'calcom:13' } : { endTime: new Date('2026-09-14T12:00:00Z') };
 await db.update(appointments).set(update).where(eq(appointments.id, row.id)); resume();
 expect(await pending).toBeNull();
 expect((await db.select().from(appointments).where(eq(appointments.id, row.id)))[0]).toMatchObject(update);
});
it('reconciliation detects even a concurrent update that preserves all visible values', async () => {
 const { appointments } = await import('../src/db/schema.js'); const { reconcileCalcomAppointment } = await import('../src/repositories/calcom.js');
 const { a, row, event } = await reserved();
 vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
  await db.update(appointments).set({ updatedAt: row.updatedAt }).where(eq(appointments.id, row.id));
  return new Response(JSON.stringify({ status: 'success', data: { uid: 'current', status: 'accepted', start: event.start, end: event.end, eventTypeId: 12, metadata: event.metadata } }));
 }));
 expect(await reconcileCalcomAppointment(a, row.id, 'current')).toBeNull();
});
it.each(['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'] as const)('out-of-order %s cannot change a confirmed or cancelled booking', async type => {
 const { appointments } = await import('../src/db/schema.js'); const { finishEmployeeAppointment } = await import('../src/repositories/appointments.js');
 const { a, c, row, event } = await reserved(); await finishEmployeeAppointment(a, row.id, 'established');
 for (const status of ['confirmed', 'cancelled'] as const) {
  await db.update(appointments).set({ status, providerWriteState: null }).where(eq(appointments.id, row.id));
  await ingestCalcomWebhook(c.id, { ...event, type, status: type === 'BOOKING_CANCELLED' ? 'cancelled' : 'accepted', uid: 'late-different', digest: `${status}-${type}` });
  expect((await db.select().from(appointments).where(eq(appointments.id, row.id)))[0]).toMatchObject({ status, externalEventId: 'established', providerWriteState: null });
 }
});
it('does not associate webhook receipts with another connection or incomplete metadata', async () => {
 const { appointments } = await import('../src/db/schema.js'); const { c, row, event } = await reserved();
 const other = await fixture('other'); const connection = await connectCalcom(other.a, other.e.id, 'OTHER_KEY');
 await ingestCalcomWebhook(connection.id, event);
 await ingestCalcomWebhook(c.id, { ...event, digest: 'missing-metadata', metadata: { appointmentId: row.id } });
 expect((await db.select().from(appointments).where(eq(appointments.id, row.id)))[0]).toMatchObject({ externalEventId: null, providerWriteState: 'in_flight' });
});
it('scheduled retention deletes idle-connection receipts without requiring new deliveries', async () => {
 const { pruneCalcomWebhookReceipts } = await import('../src/repositories/calcom.js'); const { c, event } = await reserved();
 await db.insert(calcomWebhookReceipts).values({ connectionId: c.id, digest: 'idle', bookingUid: 'old', eventType: event.type, createdAt: new Date(Date.now() - 15 * 86400000) });
 await pruneCalcomWebhookReceipts(); expect(await db.select().from(calcomWebhookReceipts)).toEqual([]);
});
