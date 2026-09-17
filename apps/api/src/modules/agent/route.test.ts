import { afterEach, expect, it } from 'vitest';
import { env } from '@receptionist/core/env.js';
import { agent } from './route.js';

const original = {
  LIVEKIT_URL: env.LIVEKIT_URL,
  LIVEKIT_API_KEY: env.LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET: env.LIVEKIT_API_SECRET,
};

afterEach(() => Object.assign(env, original));

it('returns 503 when the LiveKit browser test is not configured', async () => {
  Object.assign(env, {
    LIVEKIT_URL: undefined,
    LIVEKIT_API_KEY: undefined,
    LIVEKIT_API_SECRET: undefined,
  });
  const response = await agent.request('/test', { method: 'POST' });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'LiveKit is not configured' });
});