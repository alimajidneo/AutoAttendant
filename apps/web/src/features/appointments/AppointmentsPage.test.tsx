import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ state: 'in_flight', role: 'manager' }))
vi.mock('@/lib/apiClient', () => ({ apiClient: { get: vi.fn() } }))
vi.mock('@/hooks/useAgentZone', () => ({ useAgentZone: () => 'UTC' }))
vi.mock('react-router-dom', () => ({ Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
  useMutation: () => ({}),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'session') return { data: { role: m.role } }
    const today = new Date().toISOString().slice(0, 10)
    if (queryKey[1] === 'calendar') return { data: { events: [{ id: 'past', calendarId: 'workspace', title: 'Agenda booking', start: today + 'T00:00:00Z', end: today + 'T01:00:00Z' }], sources: [] } }
    return { data: [
      { id: 'past', service: 'Past booking', status: 'requested', providerWriteState: m.state, externalEventId: 'past', externalCalendarId: 'workspace', startTime: today + 'T00:00:00Z', endTime: '2000-01-01T01:00:00Z', updatedAt: new Date().toISOString(), bookingDetails: [] },
      { id: 'next', service: 'Next booking', status: 'requested', providerWriteState: m.state, startTime: '2099-01-01T00:00:00Z', endTime: '2099-01-01T01:00:00Z', updatedAt: new Date().toISOString(), bookingDetails: [] },
    ] }
  },
}))
import AppointmentsPage from './AppointmentsPage'
beforeEach(() => { m.state = 'in_flight'; m.role = 'manager' })
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
