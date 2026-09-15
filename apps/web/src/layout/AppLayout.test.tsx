import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: { email: 'manager@example.test', user_metadata: {} }, signOut: vi.fn() }) }))
vi.mock('./TopBar', () => ({ TopBar: () => null }))
vi.mock('@/lib/queries', () => ({
  keys: { session: ['session'], settings: ['settings'], escalations: (status: string) => ['escalations', status] },
  fetchers: { session: vi.fn().mockResolvedValue({ role: 'manager' }), settings: vi.fn().mockResolvedValue(null), escalations: vi.fn().mockResolvedValue([]) },
}))

import AppLayout from './AppLayout'

it('renders My employee setup as a discoverable manager navigation link', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['session'], { role: 'manager' })
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><AppLayout /></MemoryRouter></QueryClientProvider>)
  expect(html).toContain('href="/employee"')
  expect(html).toContain('My employee setup')
})
