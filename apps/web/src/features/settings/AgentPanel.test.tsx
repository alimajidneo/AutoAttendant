import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { AppSettings } from '@/lib/settings-types'

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/lib/apiClient', () => ({ apiClient: { patch: vi.fn() } }))

import { AgentPanel } from './AgentPanel'

const settings = {
  business: {
    name: 'Pilot', industry: 'services', timezone: 'America/New_York', description: '',
    services: [], businessHours: {
      weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      exceptions: [],
    },
    bookingPolicy: { minNoticeMinutes: 60, maxAdvanceDays: 30 },
    recordCalls: true, storageConfigured: true, recordingAvailable: false,
    phoneNumber: null, calendarProvider: null, calendarExternalId: null, calendarPayload: null,
  },
  agent: { name: 'Agent', greeting: 'Hello', farewell: 'Bye', fallback: 'Sorry', bookingQuestions: [] },
  setup: { checklistDismissed: false, hoursSeen: false },
  integrations: { slack: { connected: false, teamName: null, channelName: null } },
} as AppSettings

it('fails closed when the active voice path cannot use the recording implementation', () => {
  const html = renderToStaticMarkup(<AgentPanel settings={settings} />)

  expect(html).toContain('Recording is unavailable for the active voice provider')
  expect(html).toMatch(/role="switch"[^>]*aria-checked="false"[^>]*disabled/)
  expect(html).not.toContain('this call is recorded')
})

it('shows recording as enabled only when the API says it is available', () => {
  const html = renderToStaticMarkup(<AgentPanel settings={{
    ...settings,
    business: { ...settings.business, recordingAvailable: true },
  }} />)

  expect(html).toMatch(/role="switch"[^>]*aria-checked="true"/)
  expect(html).toContain('this call is recorded')
})
