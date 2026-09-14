import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ role: 'manager', get: vi.fn(), data: [] as unknown[], connections: [] as unknown[], calls: [] as { enabled: boolean }[] }))
vi.mock('../../lib/apiClient', () => ({ apiClient: { get: mocks.get } }))
vi.mock('../../lib/queries', () => ({ keys: { session: ['session'] }, fetchers: { session: vi.fn() } }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: string[]; enabled: boolean }) => {
    if (options.queryKey[0] === 'session') return { data: { role: mocks.role } }
    mocks.calls.push(options)
    return { data: options.queryKey[0] === 'employees' ? mocks.data : mocks.connections, isPending: false, refetch: vi.fn() }
  },
}))
import { EmployeesPanel } from './EmployeesPanel'
beforeEach(() => { mocks.role = 'manager'; mocks.data = []; mocks.connections = []; mocks.calls = [] })
it('shows manager employee creation and a simple empty list', () => {
  const html = renderToStaticMarkup(<EmployeesPanel />)
  expect(html).toContain('Add employee')
  expect(html).toContain('No employees yet')
})
it('hides employee management and disables queries for members', () => {
  mocks.role = 'member'
  const html = renderToStaticMarkup(<EmployeesPanel />)
  expect(html).toContain('Manager access required')
  expect(html).not.toContain('Add employee')
  expect(mocks.calls.every(call => call.enabled === false)).toBe(true)
})
it('renders masked destinations, account assignment and both calendar authorities', () => {
  mocks.data = [{ id: 'employee', displayName: 'Sam', department: 'Sales', routingEnabled: false, manualAvailability: 'unknown', timezone: 'UTC',
    workingHours: { weekly: {}, exceptions: [] }, calendarPolicy: { authority: 'direct', booking: null, conflicts: [] },
    hasTransferDestination: true, transferDestinationDisplay: '•••• 0123', updatedAt: '2026-01-01' }]
  mocks.connections = [{ id: 'connection', employeeId: 'employee', provider: 'microsoft', accountEmail: 'sam@example.test' }]
  const html = renderToStaticMarkup(<EmployeesPanel />)
  for (const text of ['Sam', '•••• 0123', 'Private transfer number', 'Cal.com', 'Direct Google/Microsoft', 'Connected accounts', 'sam@example.test', 'microsoft', 'Deactivate']) expect(html).toContain(text)
  expect(html).not.toContain('value="•••• 0123"')
})

it('offers explicit calendar loading with no initial provider request or manual ID fields', () => {
  mocks.get.mockClear()
  mocks.data = [{ id: 'employee', displayName: 'Sam', timezone: 'UTC', workingHours: { weekly: {}, exceptions: [] },
    calendarPolicy: { authority: 'direct', booking: { connectionId: 'connection', calendarId: 'book' }, conflicts: [] }, updatedAt: 'now' }]
  const html = renderToStaticMarkup(<EmployeesPanel />)
  expect(html).toContain('Load calendars')
  expect(html).not.toContain('Calendar ID')
  expect(mocks.get).not.toHaveBeenCalled()
})
