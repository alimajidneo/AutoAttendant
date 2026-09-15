import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AppEnv } from '../../types.js';
import { env as apiEnv } from '../../env.js';
import { env as coreEnv } from '@receptionist/core/env.js';
import { calcomOAuthConfigured } from '@receptionist/core/providers/calcom.js';
import * as repo from '@receptionist/core/repositories/calcom.js';
import { CALCOM_OAUTH_COOKIE, CALCOM_OAUTH_COOKIE_PATH, createCalcomOAuthCapabilities } from './oauth-state.js';

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

export const employeeCalcom = new Hono<AppEnv>()
  .onError((_error, c) => c.json({ error: 'Cal.com self-service is unavailable. Try again or ask a manager.' }, 503))
  .use('*', bodyLimit({ maxSize: 8192 }))
  .use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); })
  .get('/', async c => {
    const row = await repo.getEmployeeCalcomSelf(c.get('agentId'), c.get('authUser').id);
    return c.json({ configured: serverConfigured(), employee: row ? { id: row.id, displayName: row.displayName } : null,
      connection: publicConnection(row?.connection ?? null) });
  })
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
