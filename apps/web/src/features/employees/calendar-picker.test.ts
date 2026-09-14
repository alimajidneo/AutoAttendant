import { expect, it, vi } from 'vitest'
const get = vi.hoisted(() => vi.fn())
vi.mock('../../lib/apiClient', () => ({ apiClient: { get } }))
import { loadEmployeeCalendars, selectBookingCalendar, toggleConflictCalendar } from './calendar-picker'
const ref = { connectionId: 'assigned', calendarId: 'book' }
it('loads only on explicit invocation and filters calendars to assigned accounts', async () => {
  expect(get).not.toHaveBeenCalled()
  get.mockResolvedValue({ data: { calendars: [{ id: 'book', connectionId: 'assigned' }, { id: 'private', connectionId: 'other' }] } })
  expect(await loadEmployeeCalendars(['assigned'])).toEqual([{ id: 'book', connectionId: 'assigned' }])
  expect(get).toHaveBeenCalledExactlyOnceWith('/admin/calendar/list')
})
it('chooses one booking destination and includes it once among conflicts', () => {
  const policy = selectBookingCalendar({ authority: 'direct', booking: null, conflicts: [ref, ref] }, ref)
  expect(policy).toEqual({ authority: 'direct', booking: ref, conflicts: [ref] })
  expect(toggleConflictCalendar(policy, ref, false)).toEqual(policy)
  const other = { ...ref, calendarId: 'private' }
  expect(toggleConflictCalendar(policy, other, true).conflicts).toEqual([ref, other])
  expect(toggleConflictCalendar(toggleConflictCalendar(policy, other, true), other, false)).toEqual(policy)
})
