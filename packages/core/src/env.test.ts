import { expect, it } from 'vitest';
import { coreEnvSchema, env, parseEnv } from './env.js';
it.each(['http://api.cal.com/v2', 'https://evil.test/v2', 'https://127.0.0.1/v2', 'https://user:pass@api.cal.com/v2', 'https://api.cal.com/v2?q=x', 'https://api.cal.com/v2#x', 'https://api.cal.com:444/v2', 'https://api.cal.com/v2/../v2'])('rejects unsafe Cal.com env base %s', base => {
 expect(() => parseEnv(coreEnvSchema, { ...env, CALCOM_API_BASE_URL: base })).toThrow('CALCOM_API_BASE_URL');
});
it('normalizes the exact production API base trailing slash', () => {
 expect(parseEnv(coreEnvSchema, { ...env, CALCOM_API_BASE_URL: 'https://api.cal.com/v2/' }).CALCOM_API_BASE_URL).toBe('https://api.cal.com/v2');
});
