import { expect, it } from 'vitest';
import { coreEnvSchema, env, parseEnv } from './env.js';
it.each(['http://api.cal.com/v2', 'https://evil.test/v2', 'https://127.0.0.1/v2', 'https://user:pass@api.cal.com/v2', 'https://api.cal.com/v2?q=x', 'https://api.cal.com/v2#x', 'https://api.cal.com:444/v2', 'https://api.cal.com/v2/../v2'])('rejects unsafe Cal.com env base %s', base => {
 expect(() => parseEnv(coreEnvSchema, { ...env, CALCOM_API_BASE_URL: base })).toThrow('CALCOM_API_BASE_URL');
});
it('normalizes the exact production API base trailing slash', () => {
 expect(parseEnv(coreEnvSchema, { ...env, CALCOM_API_BASE_URL: 'https://api.cal.com/v2/' }).CALCOM_API_BASE_URL).toBe('https://api.cal.com/v2');
});
it('defaults Cal.com OAuth provider writes to fail closed', () => {
 expect(parseEnv(coreEnvSchema, { ...env, CALCOM_OAUTH_WRITE_APPROVED: undefined }).CALCOM_OAUTH_WRITE_APPROVED).toBe(false);
 expect(parseEnv(coreEnvSchema, { ...env, CALCOM_OAUTH_WRITE_APPROVED: 'true' }).CALCOM_OAUTH_WRITE_APPROVED).toBe(true);
});
it('allows Retell-only configuration without LiveKit', () => {
 const parsed = parseEnv(coreEnvSchema, {
  ...env,
  LIVEKIT_URL: undefined,
  LIVEKIT_API_KEY: undefined,
  LIVEKIT_API_SECRET: undefined,
 });
 expect(parsed.LIVEKIT_URL).toBeUndefined();
 expect(parsed.LIVEKIT_API_KEY).toBeUndefined();
 expect(parsed.LIVEKIT_API_SECRET).toBeUndefined();
});
it('rejects partial LiveKit configuration', () => {
 expect(() => parseEnv(coreEnvSchema, {
  ...env,
  LIVEKIT_URL: 'wss://example.livekit.cloud',
  LIVEKIT_API_KEY: undefined,
  LIVEKIT_API_SECRET: undefined,
 })).toThrow(/all three LIVEKIT_\* variables/i);
});
