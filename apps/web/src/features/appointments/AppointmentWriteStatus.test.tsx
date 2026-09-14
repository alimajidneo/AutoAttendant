import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ confirm: undefined as undefined | (() => Promise<void>), post: vi.fn(), invalidate: vi.fn(), open: false }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: () => [m.open, vi.fn()] }))
vi.mock('@/lib/apiClient', () => ({ apiClient: { post: m.post } }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: m.invalidate }) }))
vi.mock('@/components/ui/confirm-dialog', () => ({ ConfirmDialog: (props: { open: boolean; confirmLabel: string; onConfirm: () => Promise<void> }) => {
  m.confirm = props.onConfirm
  return props.open ? <div>{props.confirmLabel}</div> : null
} }))
import { AppointmentWriteStatus } from './AppointmentWriteStatus'
beforeEach(() => { vi.clearAllMocks(); m.open = false; m.confirm = undefined })
it('shows non-clickable booking progress while the write is fresh', () => {
  const html = renderToStaticMarkup(<AppointmentWriteStatus id="held" state="in_flight" updatedAt={new Date().toISOString()} canManage />)
  expect(html).toContain('Booking in progress')
  expect(html).not.toContain('<button')
  expect(m.post).not.toHaveBeenCalled()
})
it('offers explicit provider reconciliation when an in-flight write is stale', async () => {
  const props = { id: 'stale', state: 'in_flight' as const, updatedAt: '2000-01-01T00:00:00.000Z', canManage: true }
  expect(renderToStaticMarkup(<AppointmentWriteStatus {...props} />)).toContain('Review stalled booking')
  m.open = true
  expect(renderToStaticMarkup(<AppointmentWriteStatus {...props} />)).toContain('I checked the provider calendar and no event exists')
  await m.confirm!()
  expect(m.post).toHaveBeenCalledExactlyOnceWith('/admin/appointments/stale/reconcile-not-created', { providerChecked: true })
})
it('requires the explicit provider confirmation before the dedicated reconciliation request', async () => {
  const html = renderToStaticMarkup(<AppointmentWriteStatus id="held" state="reconciliation_required" updatedAt={new Date().toISOString()} canManage />)
  expect(html).toContain('Review booking')
  expect(m.post).not.toHaveBeenCalled()
  m.open = true
  expect(renderToStaticMarkup(<AppointmentWriteStatus id="held" state="reconciliation_required" updatedAt={new Date().toISOString()} canManage />)).toContain('I checked the provider calendar and no event exists')
  await m.confirm!()
  expect(m.post).toHaveBeenCalledExactlyOnceWith('/admin/appointments/held/reconcile-not-created', { providerChecked: true })
  expect(m.invalidate).toHaveBeenCalled()
})
it('does not expose reconciliation to members', () => {
  const html = renderToStaticMarkup(<AppointmentWriteStatus id="held" state="reconciliation_required" updatedAt={new Date().toISOString()} canManage={false} />)
  expect(html).toContain('Provider reconciliation required')
  expect(html).not.toContain('<button')
})
it('offers an authenticated Cal.com state check before declaring absence', () => {
 const html = renderToStaticMarkup(<AppointmentWriteStatus id="held" state="reconciliation_required" updatedAt={new Date().toISOString()} canManage calcom />)
 expect(html).toContain('Check Cal.com booking'); expect(html).toContain('Booking UID'); expect(m.post).not.toHaveBeenCalled()
})
