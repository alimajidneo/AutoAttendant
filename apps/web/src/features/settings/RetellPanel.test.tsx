import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ role: 'manager', approved: false, denied: false, active: false, key: false, enabled: [] as boolean[] }))
vi.mock('../../lib/apiClient', () => ({ apiClient: { get: vi.fn() } }))
vi.mock('../../lib/queries', () => ({ keys: { session: ['session'] }, fetchers: { session: vi.fn() } }))
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: { queryKey: string[]; enabled: boolean }) => {
  if (options.queryKey[0] === 'session') return { data: { role: m.role } }
  m.enabled.push(options.enabled)
  return m.denied ? { isError: true, error: { response: { status: 403 } } } : { data: { retellAgentId: 'agent_a', enabled: m.active, apiKeyConfigured: m.key, operatorApproved: m.approved } }
} }))
import { RetellPanel } from './RetellPanel'
beforeEach(() => { m.role = 'manager'; m.approved = false; m.denied = false; m.active = false; m.key = false; m.enabled = [] })
it('shows pending operator approval and no-purchase warning', () => {
  const html = renderToStaticMarkup(<RetellPanel />)
  expect(() => new RegExp(html.match(/pattern="([^"]+)"/)![1], 'v')).not.toThrow()
  for (const text of ['Pending operator approval', 'Saving does not purchase a number or place calls.', 'save-message', 'agent_a']) expect(html).toContain(text)
  expect(html).toContain('Not connected')
})
it('does not fetch settings for members', () => {
  m.role = 'member'
  expect(renderToStaticMarkup(<RetellPanel />)).toContain('Manager access required')
  expect(m.enabled).toEqual([false])
})
it('explains owner-only access and approved readiness', () => {
  m.denied = true
  expect(renderToStaticMarkup(<RetellPanel />)).toContain('workspace owner')
  m.denied = false; m.approved = true
  expect(renderToStaticMarkup(<RetellPanel />)).toContain('Operator approved')
})
it('shows green only for a saved, enabled, approved server binding', () => {
  m.approved = true; m.key = true; m.active = true
  const html = renderToStaticMarkup(<RetellPanel />)
  expect(html).toContain('Configured and enabled')
  expect(html).toContain('Live Retell calls have not been verified')
  expect(html).not.toContain('Not connected')
})
