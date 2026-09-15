import { isValidElement, type ReactNode, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ owner: true, queries: [] as { enabled?: boolean }[], state: [] as unknown[], cursor: 0, post: vi.fn(), get: vi.fn(), delete: vi.fn(), refetch: vi.fn(), refresh: vi.fn(), data: [] as unknown[], pending: false, isError: false }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useId: () => 'key', useState: (initial: unknown) => {
 const index = m.cursor++; if (!(index in m.state)) m.state[index] = initial
 return [m.state[index], (value: unknown) => { m.state[index] = value }]
} }))
vi.mock('../../lib/apiClient', () => ({ apiClient: m }))
vi.mock('../../lib/queries', () => ({ keys: { session: ['session'] }, fetchers: { session: vi.fn() } }))
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: { queryKey: string[]; enabled?: boolean; queryFn: () => unknown }) => {
 if (options.queryKey[0] === 'session') return { data: { role: 'manager', workspaceOwner: m.owner } }
 m.queries.push(options)
 if (options.enabled !== false) Promise.resolve(options.queryFn()).catch(() => undefined)
 return { data: m.data, isPending: m.pending, isError: m.isError, refetch: m.refetch }
} }))
import { CalcomConnection } from './CalcomConnection'
type Props = { children?: ReactNode; disabled?: boolean; onClick?: () => void; onSubmit?: (event: unknown) => void; onChange?: (event: unknown) => void }
function tree() { m.cursor = 0; return CalcomConnection({ employeeId: 'employee', refresh: m.refresh }) }
function nodes(node: ReactNode): ReactElement<Props>[] {
 if (Array.isArray(node)) return node.flatMap(nodes)
 if (!isValidElement<Props>(node)) return []
 return [node, ...nodes(node.props.children)]
}
function control(label: string) { return nodes(tree()).find(n => n.props.children === label)! }
async function settle() { await new Promise(resolve => setImmediate(resolve)) }
beforeEach(() => { vi.resetAllMocks(); m.owner = true; m.queries = []; m.get.mockResolvedValue({ data: [] }); m.state = []; m.data = []; m.pending = false; m.isError = false; m.refresh.mockResolvedValue(undefined); m.refetch.mockResolvedValue(undefined) })
afterEach(() => vi.unstubAllGlobals())
it('clearly labels the legacy password flow and disables loading/error/busy controls', () => {
 m.pending = true; expect(control('Connect legacy Cal.com').props.disabled).toBe(true)
 m.isError = true; expect(renderToStaticMarkup(tree())).toContain('Could not load Cal.com connections')
 m.data = [{ id: 'connection', employeeId: 'employee' }]; m.state = [true, 'Failure', [{ id: 12, title: 'Intro', lengthInMinutes: 60 }], '12']
 expect(control('Refresh Cal.com event types').props.disabled).toBe(true)
 expect(control('Disconnect Cal.com').props.disabled).toBe(true)
 expect(control('Use selected Cal.com event type').props.disabled).toBe(true)
 expect(nodes(tree()).find(n => n.type === 'select')!.props.disabled).toBe(true)
 const html = renderToStaticMarkup(tree()); expect(html).toContain('type="password"'); expect(html).toContain('Failure'); expect(html).toContain('Legacy manager API-key flow only'); expect(html).toContain('OAuth')
})
it.each([false, true])('connect submit clears the secret, handles failure=%s and releases busy state', async fail => {
 vi.stubGlobal('FormData', class { get() { return 'PRIVATE' } })
 if (fail) m.post.mockRejectedValue(new Error('PRIVATE')); else m.post.mockResolvedValue({})
 const reset = vi.fn(); nodes(tree()).find(n => n.type === 'form')!.props.onSubmit!({ preventDefault() {}, currentTarget: { reset } })
 expect(reset).toHaveBeenCalledOnce(); expect(control('Connect legacy Cal.com').props.disabled).toBe(true)
 await settle(); expect(m.post).toHaveBeenCalledWith('/admin/calcom/employee/connect', { apiKey: 'PRIVATE' }); expect(m.state[0]).toBe(false)
 expect(m.refresh).toHaveBeenCalledTimes(fail ? 0 : 1)
 expect(String(m.state[1])).not.toContain('PRIVATE'); expect(Boolean(m.state[1])).toBe(fail)
})
it.each([false, true])('refresh/select/disconnect handlers handle failure=%s', async fail => {
 m.data = [{ id: 'connection', employeeId: 'employee' }]
 vi.stubGlobal('window', { confirm: () => true })
 if (fail) { m.get.mockRejectedValue(new Error('PRIVATE')); m.post.mockRejectedValue(new Error('PRIVATE')); m.delete.mockRejectedValue(new Error('PRIVATE')) }
 else { m.get.mockResolvedValue({ data: [{ id: 12, title: 'Intro', lengthInMinutes: 60 }] }); m.post.mockResolvedValue({}); m.delete.mockResolvedValue({}) }
 control('Refresh Cal.com event types').props.onClick!(); await settle(); expect(m.get).toHaveBeenCalledWith('/admin/calcom/employee/connection/event-types')
 expect(Boolean(m.state[1])).toBe(fail)
 m.state[2] = [{ id: 12, title: 'Intro', lengthInMinutes: 60 }]
 nodes(tree()).find(n => n.type === 'select')!.props.onChange!({ target: { value: '12' } })
 control('Use selected Cal.com event type').props.onClick!(); await settle()
 expect(m.post).toHaveBeenCalledWith('/admin/calcom/employee/connection/select', { eventTypeId: 12 }); expect(Boolean(m.state[1])).toBe(fail)
 control('Disconnect Cal.com').props.onClick!(); await settle()
 expect(m.delete).toHaveBeenCalledWith('/admin/calcom/employee/connection'); expect(Boolean(m.state[1])).toBe(fail); expect(m.state[0]).toBe(false)
 expect(m.refresh).toHaveBeenCalledTimes(fail ? 0 : 2)
})

it('shows safe readiness to a non-owner manager without rendering credential controls', () => {
 m.owner = false; m.data = [{ id: 'connection', employeeId: 'employee' }]
 const html = renderToStaticMarkup(tree())
 expect(m.get).toHaveBeenCalledWith('/admin/calcom')
 expect(m.queries.every(query => query.enabled !== false)).toBe(true)
 expect(html).toContain('Cal.com employee connection')
 expect(html).not.toMatch(/API key|Reconnect|Disconnect|event type|password/)
})
