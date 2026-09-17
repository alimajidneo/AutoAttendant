import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ tab: 'connections', workspaceOwner: true }))
const settings = {
  business: {
    businessHours: {
      weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      exceptions: [{ date: '2026-12-25', intervals: [], label: 'Christmas Day' }],
    },
  },
  setup: {},
  integrations: { slack: { connected: false } },
}

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(`tab=${state.tab}`), vi.fn()],
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => queryKey[0] === 'session'
    ? { data: { workspaceOwner: state.workspaceOwner } }
    : { data: settings, isLoading: false },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/lib/queries', () => ({
  keys: { session: ['session'], settings: ['settings'] },
  fetchers: { session: vi.fn(), settings: vi.fn() },
}))
vi.mock('@/lib/apiClient', () => ({ apiClient: { patch: vi.fn() } }))
vi.mock('./BusinessPanel', () => ({ BusinessPanel: () => <p>Business panel</p> }))
vi.mock('./HoursPanel', () => ({ HoursPanel: () => <p>Opening hours panel</p> }))
vi.mock('./AgentPanel', () => ({ AgentPanel: () => <p>Agent panel</p> }))
vi.mock('./ConnectionsPanel', () => ({ ConnectionsPanel: () => <p>Calendar connections panel</p> }))
vi.mock('../employees/EmployeesPanel', () => ({ EmployeesPanel: () => <p>Employees panel</p> }))
vi.mock('./RetellPanel', () => ({ RetellPanel: () => <p>Retell panel</p> }))
vi.mock('./AccountPanel', () => ({ AccountPanel: () => <p>Account panel</p> }))

import SettingsPage from './SettingsPage'

beforeEach(() => { state.tab = 'connections'; state.workspaceOwner = true })

it('places holiday configuration with calendar connections', () => {
  const html = renderToStaticMarkup(<SettingsPage />)
  expect(html).toContain('Calendar connections panel')
  expect(html).toContain('Holidays')
  expect(html).toContain('Christmas Day')
})

it('does not keep holiday configuration in opening hours', () => {
  state.tab = 'hours'
  const html = renderToStaticMarkup(<SettingsPage />)
  expect(html).toContain('Opening hours panel')
  expect(html).not.toContain('Holidays')
})

it('keeps holiday configuration available to non-owner managers', () => {
  state.workspaceOwner = false
  const html = renderToStaticMarkup(<SettingsPage />)
  expect(html).toContain('Holidays')
  expect(html).toContain('Christmas Day')
  expect(html).not.toContain('Calendar connections panel')
})
