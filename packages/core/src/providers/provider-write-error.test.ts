import { afterEach, expect, it, vi } from 'vitest';
import { createCalendarEvent } from './calendar.js';
import { createMicrosoftCalendarEvent } from './microsoftCalendar.js';
import { ProviderWriteRejectedError } from './provider-write-error.js';
afterEach(() => vi.unstubAllGlobals());
const event = { summary: 'Appointment', startIso: '2026-09-14T10:00:00Z', endIso: '2026-09-14T11:00:00Z', timezone: 'UTC' };
it.each([createCalendarEvent, createMicrosoftCalendarEvent])('types only clear client-side write rejections as definite', async create => {
  const fetch = vi.fn().mockResolvedValue(new Response('', { status: 403 })); vi.stubGlobal('fetch', fetch);
  await expect(create('mock', 'calendar', event)).rejects.toBeInstanceOf(ProviderWriteRejectedError);
  fetch.mockResolvedValue(new Response('', { status: 500 }));
  await expect(create('mock', 'calendar', event)).rejects.not.toBeInstanceOf(ProviderWriteRejectedError);
  fetch.mockRejectedValue(new Error('timeout'));
  await expect(create('mock', 'calendar', event)).rejects.not.toBeInstanceOf(ProviderWriteRejectedError);
  fetch.mockResolvedValue(new Response('{}', { status: 200 }));
  await expect(create('mock', 'calendar', event)).rejects.not.toBeInstanceOf(ProviderWriteRejectedError);
});
