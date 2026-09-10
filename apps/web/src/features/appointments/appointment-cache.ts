import type { QueryClient } from '@tanstack/react-query'
import type { AppointmentItem, CalendarAgenda } from '@receptionist/shared'
import { appointmentCalendarEventKey, calendarEventKey } from './appointment-groups'

export async function removeAppointmentFromCache(client: QueryClient, removed: AppointmentItem) {
  await client.cancelQueries({ queryKey: ['appointments'] })
  const removedKey = appointmentCalendarEventKey(removed)
  client.setQueriesData<CalendarAgenda>({ queryKey: ['appointments', 'calendar'] }, current => current ? {
    ...current, events: current.events.filter(event => calendarEventKey(event) !== removedKey),
  } : current)
  client.setQueryData<AppointmentItem[]>(['appointments'], (current = []) => current.filter(item => item.id !== removed.id))
  await client.invalidateQueries({ queryKey: ['appointments'], refetchType: 'none' })
}
