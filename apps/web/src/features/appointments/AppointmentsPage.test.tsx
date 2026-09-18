import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ state: 'in_flight', role: 'manager', zone: 'UTC', calendarConnected: true, calendarError: false }))
vi.mock('@/lib/apiClient', () => ({ apiClient: { get: vi.fn() } }))
vi.mock('@/hooks/useAgentZone', () => ({ useAgentZone: () => m.zone }))
vi.mock('react-router-dom', () => ({ Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
  useMutation: () => ({}),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'session') return { data: { role: m.role } }
    const today = new Date().toISOString().slice(0, 10)
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    if (queryKey[1]?.startsWith('calendar')) return m.calendarError
      ? { isError: true, error: new Error('provider failed') }
      : { data: { connected: m.calendarConnected, events: m.calendarConnected ? [
        { id: 'past', calendarId: 'workspace', title: 'Agenda booking', start: today + 'T00:00:00Z', end: today + 'T01:00:00Z' },
        { id: 'external', calendarId: 'personal', title: 'Customer follow-up', start: tomorrow + 'T15:00:00Z', end: tomorrow + 'T16:00:00Z' },
        { id: 'all-day', calendarId: 'personal', title: 'Conference day', start: tomorrow, end: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), allDay: true },
      ] : [], sources: [{ connectionId: 'connection', provider: 'google', accountEmail: 'owner@example.test', calendarId: 'personal', calendarName: 'Work', colorIndex: 0 }] } }
    return { data: [
      { id: 'past', service: 'Past booking', status: 'requested', providerWriteState: m.state, externalEventId: 'past', externalCalendarId: 'workspace', startTime: today + 'T00:00:00Z', endTime: '2000-01-01T01:00:00Z', updatedAt: new Date().toISOString(), bookingDetails: [] },
      { id: 'next', service: 'Next booking', status: 'requested', providerWriteState: m.state, startTime: '2099-01-01T00:00:00Z', endTime: '2099-01-01T01:00:00Z', updatedAt: new Date().toISOString(), bookingDetails: [] },
    ] }
  },
}))
import AppointmentsPage from './AppointmentsPage'
beforeEach(() => { m.state = 'in_flight'; m.role = 'manager'; m.zone = 'UTC'; m.calendarConnected = true; m.calendarError = false })

it('explains that no calendar is connected instead of reporting a provider failure', () => {
  m.calendarConnected = false
  const html = renderToStaticMarkup(<AppointmentsPage />)
  expect(html).toContain('No calendar connected')
  expect(html).toContain('Connect a calendar')
  expect(html).not.toContain('Calendar events are unavailable')
})
it.each(['in_flight', 'reconciliation_required'])('replaces generic actions in agenda, upcoming and history for %s', state => {
  m.state = state
  const html = renderToStaticMarkup(<AppointmentsPage />)
  expect(html).not.toMatch(/> Cancel<|> Delete</)
  expect(html.match(new RegExp(state === 'in_flight' ? 'Booking in progress' : 'Review booking', 'g'))).toHaveLength(3)
})
it('keeps reconciliation read-only for members', () => {
  m.state = 'reconciliation_required'; m.role = 'member'
  const html = renderToStaticMarkup(<AppointmentsPage />)
  expect(html).not.toContain('Review booking')
  expect(html.match(/Provider reconciliation required/g)).toHaveLength(3)
})
it('shows detailed provider events for a selectable range in a scrollable sidebar', () => {
  const html = renderToStaticMarkup(<AppointmentsPage />)
  expect(html).toContain('Upcoming events')
  expect(html).toContain('Customer follow-up')
  expect(html).toContain('3:00 PM–4:00 PM')
  expect(html).toContain('Show next')
  expect(html).toContain('7 days')
  expect(html).toContain('max-h-[32rem] divide-y divide-border overflow-y-auto')
})
it('does not shift an all-day event into the previous date', () => {
  m.zone = 'America/Los_Angeles'
  const html = renderToStaticMarkup(<AppointmentsPage />)
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const expected = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${tomorrow}T12:00:00Z`))
  expect(html).toContain(`${expected} · All day`)
})
