import { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { env } from '../../env.js';
import { env as coreEnv } from '@receptionist/core/env.js';
import { exchangeCalcomAuthorizationCode } from '@receptionist/core/providers/calcom.js';
import * as repo from '@receptionist/core/repositories/calcom.js';
import { CALCOM_OAUTH_COOKIE, CALCOM_OAUTH_COOKIE_PATH, hashCalcomOAuthCapability } from './oauth-state.js';

function employeeUrl(result: 'connected' | 'setup_required' | 'error', workspace?: string, message?: string) {
  const target = new URL('/employee', env.DASHBOARD_ORIGINS[0]!);
  target.searchParams.set('calcom', result);
  if (workspace) target.searchParams.set('workspace', workspace);
  if (message) target.searchParams.set('message', message);
  return target.toString();
}

export const calcomOAuthCallback = new Hono().get('/callback', async c => {
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  const stateHash = hashCalcomOAuthCapability(c.req.query('state') ?? '');
  const browserChallengeHash = hashCalcomOAuthCapability(getCookie(c, CALCOM_OAUTH_COOKIE) ?? '');
  const state = stateHash && browserChallengeHash ? await repo.consumeCalcomOAuthState(stateHash, browserChallengeHash) : null;
  deleteCookie(c, CALCOM_OAUTH_COOKIE, { path: CALCOM_OAUTH_COOKIE_PATH });
  const code = c.req.query('code');
  if (!state || !code || c.req.query('error')) return c.redirect(employeeUrl('error', undefined, 'Cal.com authorization was not completed.'));
  try {
    if (!coreEnv.CALCOM_OAUTH_WRITE_APPROVED) return c.redirect(employeeUrl('error', state.agentId, 'Cal.com self-service is awaiting provider approval.'));
    const linked = await repo.getLinkedEmployee(state.agentId, state.userId, state.employeeId);
    if (!linked) return c.redirect(employeeUrl('error', state.agentId, 'Your employee link changed. Ask a manager to review it.'));
    if (!env.PUBLIC_API_URL) throw new Error('Cal.com callback origin is not configured');
    const base = env.PUBLIC_API_URL;
    const redirectUri = `${base}/api/calcom/oauth/callback`;
    const { tokens, account } = await exchangeCalcomAuthorizationCode(code, redirectUri);
    const connection = await repo.saveCalcomOAuthGrant(state.agentId, state.employeeId, state.userId, tokens, account, state);
    await repo.invalidateCalcomOAuthStates(state.agentId, state.employeeId);
    const setup = await repo.reconcileCalcomOAuthSetup(state.agentId, state.employeeId, connection.id, `${base}/api/calcom/webhooks/${connection.id}`, state.userId);
    return setup.ready
      ? c.redirect(employeeUrl('connected', state.agentId))
      : c.redirect(employeeUrl('setup_required', state.agentId, 'Connect or select your work calendar in Cal.com, then Retry setup.'));
  } catch {
    console.error('[calcom] OAuth callback failed');
    return c.redirect(employeeUrl('error', state.agentId, 'Cal.com connection failed. Try again or ask a manager.'));
  }
});
