import { createHash, randomBytes } from 'node:crypto';

export const CALCOM_OAUTH_COOKIE = 'deskroute_calcom_oauth';
export const CALCOM_OAUTH_COOKIE_PATH = '/api/calcom/oauth';
export function hashCalcomOAuthCapability(value: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  return createHash('sha256').update(value).digest('hex');
}

export function createCalcomOAuthCapabilities() {
  const state = randomBytes(32).toString('base64url');
  const browserChallenge = randomBytes(32).toString('base64url');
  return { state, browserChallenge, stateHash: hashCalcomOAuthCapability(state)!,
    browserChallengeHash: hashCalcomOAuthCapability(browserChallenge)! };
}
