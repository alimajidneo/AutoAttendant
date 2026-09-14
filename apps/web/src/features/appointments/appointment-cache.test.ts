import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { AppointmentItem, CalendarAgenda, CalendarAgendaEvent } from '@receptionist/shared'
import { removeAppointmentFromCache } from './appointment-cache'

const item: AppointmentItem = {
  id: 'booking', service: 'Demo', callerName: null, callerPhone: null,
  status: 'confirmed', startTime: '2026-09-01T09:00:00Z', endTime: '2026-09-01T09:30:00Z',
  externalEventId: 'event', externalCalendarId: 'calendar-a', bookingDetails: [], createdAt: '2026-08-31T00:00:00Z', updatedAt: '2026-08-31T00:00:00Z',
}
const event: CalendarAgendaEvent = {
  id: 'event', calendarId: 'calendar-a', title: 'Demo', allDay: false,
  start: item.startTime!, end: item.endTime!,
}
const agenda = (events: CalendarAgendaEvent[]): CalendarAgenda => ({ events, sources: [] })

describe('confirmed appointment deletion in calendar caches', () => {
  it('removes the linked event in every month while preserving other calendars and bookings', async () => {
    const client = new QueryClient()
    const unrelated = { ...event, calendarId: 'calendar-b' }
    client.setQueryData(['appointments'], [item, { ...item, id: 'other' }])
    client.setQueryData(['appointments', 'calendar', 'september'], agenda([event, unrelated]))
    client.setQueryData(['appointments', 'calendar', 'august'], agenda([event]))
    await removeAppointmentFromCache(client, item)
    expect(client.getQueryData(['appointments'])).toEqual([{ ...item, id: 'other' }])
    expect(client.getQueryData(['appointments', 'calendar', 'september'])).toEqual(agenda([unrelated]))
    expect(client.getQueryData(['appointments', 'calendar', 'august'])).toEqual(agenda([]))
    client.clear()
  })

  it('prevents an older pending calendar read from restoring a deleted event', async () => {
    const client = new QueryClient()
    const key = ['appointments', 'calendar', 'september']
    client.setQueryData(key, agenda([event]))
    let resolve!: (data: CalendarAgenda) => void
    const read = client.fetchQuery({ queryKey: key, queryFn: () => new Promise<CalendarAgenda>(done => { resolve = done }) }).catch(() => undefined)
    await removeAppointmentFromCache(client, item)
    resolve(agenda([event]))
    await read
    expect(client.getQueryData(key)).toEqual(agenda([]))
    client.clear()
  })

  it('removes a manager-visible booking without an external event id', async () => {
    const client = new QueryClient()
    const local = { ...item, externalEventId: null, externalCalendarId: null }
    const key = ['appointments', 'calendar', 'september']
    client.setQueryData(key, agenda([{ ...event, id: local.id, calendarId: 'workspace' }]))
    await removeAppointmentFromCache(client, local)
    expect(client.getQueryData(key)).toEqual(agenda([]))
    client.clear()
  })
})
