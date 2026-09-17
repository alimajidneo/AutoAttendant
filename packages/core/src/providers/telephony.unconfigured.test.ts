import { expect, it, vi } from 'vitest';

vi.mock('../env.js', () => ({
  env: {
    LIVEKIT_URL: undefined,
    LIVEKIT_API_KEY: undefined,
    LIVEKIT_API_SECRET: undefined,
  },
  livekitConfig: () => null,
}));

it('imports without LiveKit and fails only when telephony is used', async () => {
  const provider = await import('./telephony.js');
  await expect(provider.searchPhoneNumbers()).rejects.toThrow(/LiveKit is not configured/i);
});