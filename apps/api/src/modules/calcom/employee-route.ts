import { randomBytes } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AppEnv } from '../../types.js';
import { env as apiEnv } from '../../env.js';
import { env as coreEnv } from '@receptionist/core/env.js';
import { calcomOAuthConfigured } from '@receptionist/core/providers/calcom.js';
import { googleConnectionConfigured } from '@receptionist/core/providers/googleAuth.js';
import { microsoftConnectionConfigured } from '@receptionist/core/providers/microsoftAuth.js';
import * as repo from '@receptionist/core/repositories/calcom.js';
import { CALCOM_OAUTH_COOKIE, CALCOM_OAUTH_COOKIE_PATH, createCalcomOAuthCapabilities } from './oauth-state.js';
import {
  createOAuthState,
  MICROSOFT_OAUTH_COOKIE,
  MICROSOFT_OAUTH_COOKIE_PATH,
  oauthChallenge,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
} from '../calendar/oauth-state.js';

function serverConfigured() {
  return calcomOAuthConfigured() && coreEnv.CALCOM_OAUTH_WRITE_APPROVED && !!coreEnv.TOKEN_ENCRYPTION_KEY
    && !!coreEnv.CALCOM_WEBHOOK_SECRET && !!apiEnv.PUBLIC_API_URL;
}
function callbackUrl(requestUrl: string) {
  return `${apiEnv.PUBLIC_API_URL ?? new URL(requestUrl).origin}/api/calcom/oauth/callback`;
}
function subscriberUrl(requestUrl: string, connectionId: string) {
  return `${apiEnv.PUBLIC_API_URL ?? new URL(requestUrl).origin}/api/calcom/webhooks/${connectionId}`;
}
function publicConnection(connection: NonNullable<Awaited<ReturnType<typeof repo.getEmployeeCalcomSelf>>>['connection']) {
  return connection ? { id: connection.id, authKind: connection.authKind, accountEmail: connection.accountEmail,
    displayLabel: connection.displayLabel, status: connection.status, ready: connection.ready,
    eventTypeTitle: connection.eventTypeTitle } : null;
}

const googleScopes = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
];

function directCallbackUrl(requestUrl: string, provider: 'google' | 'microsoft') {
  const path = provider === 'google' ? '/api/calendar/oauth/callback' : '/api/microsoft/oauth/callback';
  return `${apiEnv.PUBLIC_API_URL ?? new URL(requestUrl).origin}${path}`;
}

async function directCalendarAuthorization(c: Context<AppEnv>, provider: 'google' | 'microsoft') {
  if (Object.keys(c.req.query()).length) return c.json({ error: 'Employee selection is not accepted on self-service routes' }, 400);
  if (provider === 'google' ? !googleConnectionConfigured() : !microsoftConnectionConfigured()) {
    return c.json({ error: `${provider === 'google' ? 'Google' : 'Microsoft'} Calendar is not configured on the server` }, 503);
  }
  const employee = await repo.getEmployeeCalcomSelf(c.get('agentId'), c.get('authUser').id);
  if (!employee) return c.json({ error: 'Your workspace account is not linked to an employee' }, 404);
  const redirectUri = directCallbackUrl(c.req.url, provider);
  const verifier = randomBytes(32).toString('base64url');
  const cookie = provider === 'google' ? OAUTH_COOKIE : MICROSOFT_OAUTH_COOKIE;
  const cookiePath = provider === 'google' ? OAUTH_COOKIE_PATH : MICROSOFT_OAUTH_COOKIE_PATH;
  setCookie(c, cookie, verifier, { httpOnly: true, secure: new URL(redirectUri).protocol === 'https:',
    sameSite: 'Lax', path: cookiePath, maxAge: 600 });
  c.header('Cache-Control', 'no-store');
  const state = createOAuthState(c.get('agentId'), verifier, { employeeId: employee.id, userId: c.get('authUser').id });
  const params = provider === 'google'
    ? new URLSearchParams({ client_id: coreEnv.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri,
      response_type: 'code', access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true',
      scope: googleScopes.join(' '), state, code_challenge: oauthChallenge(verifier), code_challenge_method: 'S256' })
    : new URLSearchParams({ client_id: coreEnv.MICROSOFT_CLIENT_ID!, redirect_uri: redirectUri,
      response_type: 'code', response_mode: 'query', scope: 'openid profile email offline_access User.Read Calendars.ReadWrite',
      state, prompt: 'select_account', code_challenge: oauthChallenge(verifier), code_challenge_method: 'S256' });
  const origin = provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
  return c.json({ url: `${origin}?${params}` });
}

export const employeeCalcom = new Hono<AppEnv>()
  .onError((_error, c) => c.json({ error: 'Cal.com self-service is unavailable. Try again or ask a manager.' }, 503))
  .use('*', bodyLimit({ maxSize: 8192 }))
  .use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); })
  .get('/', async c => {
    const row = await repo.getEmployeeCalcomSelf(c.get('agentId'), c.get('authUser').id);
    const directConnections = row?.directConnections ?? [];
    return c.json({ configured: serverConfigured(), employee: row ? { id: row.id, displayName: row.displayName,
      department: row.department, bookingConfigured: row.bookingConfigured } : null,
      connection: publicConnection(row?.connection ?? null),
      directCalendars: {
        providers: { google: googleConnectionConfigured(), microsoft: microsoftConnectionConfigured() },
        connections: directConnections.map(connection => ({ id: connection.id, provider: connection.provider,
          accountEmail: connection.accountEmail, accountName: connection.accountName })),
      } });
  })
  .get('/calendar/oauth/google/start', c => directCalendarAuthorization(c, 'google'))
  .get('/calendar/oauth/microsoft/start', c => directCalendarAuthorization(c, 'microsoft'))
  .get('/calcom/oauth/start', async c => {
    if (Object.keys(c.req.query()).length) return c.json({ error: 'Employee selection is not accepted on self-service routes' }, 400);
    if (!serverConfigured()) return c.json({ error: 'Cal.com employee OAuth is not configured on the server' }, 503);
    const row = await repo.getEmployeeCalcomSelf(c.get('agentId'), c.get('authUser').id);
    if (!row) return c.json({ error: 'Your workspace account is not linked to an employee' }, 404);
    const redirectUri = callbackUrl(c.req.url);
    const capabilities = createCalcomOAuthCapabilities();
    await repo.startCalcomOAuthState(c.get('agentId'), row.id, c.get('authUser').id, capabilities.stateHash, capabilities.browserChallengeHash);
    setCookie(c, CALCOM_OAUTH_COOKIE, capabilities.browserChallenge, { httpOnly: true, secure: new URL(redirectUri).protocol === 'https:',
      sameSite: 'Lax', path: CALCOM_OAUTH_COOKIE_PATH, maxAge: 600 });
    const params = new URLSearchParams({ client_id: coreEnv.CALCOM_OAUTH_CLIENT_ID!, redirect_uri: redirectUri,
      state: capabilities.state, scope: 'READ_PROFILE,READ_BOOKING' });
    return c.json({ url: `https://app.cal.com/auth/oauth2/authorize?${params}` });
  })
  .post('/calcom/reconcile', async c => {
    if (!z.object({}).strict().safeParse(await c.req.json().catch(() => null)).success) return c.json({ error: 'Invalid setup request' }, 400);
    if (!serverConfigured()) return c.json({ error: 'Cal.com employee OAuth is not configured on the server' }, 503);
    const row = await repo.getEmployeeCalcomSelf(c.get('agentId'), c.get('authUser').id);
    if (!row?.connection || row.connection.authKind !== 'oauth') return c.json({ error: 'Connect Cal.com first' }, 404);
    return c.json(await repo.reconcileCalcomOAuthSetup(c.get('agentId'), row.id, row.connection.id, subscriberUrl(c.req.url, row.connection.id), c.get('authUser').id));
  })
  .delete('/calcom', async c => {
    if (Object.keys(c.req.query()).length) return c.json({ error: 'Employee selection is not accepted on self-service routes' }, 400);
    const row = await repo.getEmployeeCalcomSelf(c.get('agentId'), c.get('authUser').id);
    if (!row?.connection || row.connection.authKind !== 'oauth') return c.json({ error: 'Cal.com connection not found' }, 404);
    await repo.disconnectEmployeeCalcom(c.get('agentId'), c.get('authUser').id, row.id, row.connection.id, subscriberUrl(c.req.url, row.connection.id));
    return c.json({ disconnected: true });
  });
