import type { CalendarOption, EmployeeCalendarPolicy, EmployeeCalendarReference } from '@receptionist/shared'
import { apiClient } from '../../lib/apiClient'
type Direct = Extract<EmployeeCalendarPolicy, { authority: 'direct' }>
export const calendarKey = (ref: EmployeeCalendarReference) => JSON.stringify([ref.connectionId, ref.calendarId])
export async function loadEmployeeCalendars(connectionIds: string[]) {
  const { data } = await apiClient.get<{ calendars: CalendarOption[] }>('/admin/calendar/list')
  return data.calendars.filter(calendar => connectionIds.includes(calendar.connectionId))
}
export function selectBookingCalendar(policy: Direct, booking: EmployeeCalendarReference): Direct {
  return { authority: 'direct', booking, conflicts: [...new Map([...policy.conflicts, booking].map(ref => [calendarKey(ref), ref])).values()] }
}
export function toggleConflictCalendar(policy: Direct, ref: EmployeeCalendarReference, selected: boolean): Direct {
  const conflicts = policy.conflicts.filter(item => calendarKey(item) !== calendarKey(ref))
  if (selected) conflicts.push(ref)
  const next = { ...policy, conflicts }
  return next.booking ? selectBookingCalendar(next, next.booking) : next
}
