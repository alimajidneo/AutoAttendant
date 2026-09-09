import type { AppointmentItem, CalendarAgendaEvent } from '@receptionist/shared'
import { dayKey } from '../../lib/formatters'

export function splitAppointments(appointments: AppointmentItem[], now: number) {
  const past = appointments.filter(item => item.endTime && Date.parse(item.endTime) <= now)
    .sort((a, b) => Date.parse(b.endTime!) - Date.parse(a.endTime!))
  const upcoming = appointments.filter(item => item.status !== 'cancelled'
    && (!item.endTime || !(Date.parse(item.endTime) <= now)))
    .sort((a, b) => (a.startTime ? Date.parse(a.startTime) : Infinity) - (b.startTime ? Date.parse(b.startTime) : Infinity))
  return { past, upcoming }
}

export function calendarEventKey(event: Pick<CalendarAgendaEvent, 'calendarId' | 'id'>) {
  return JSON.stringify([event.calendarId, event.id])
}

export function eventsForDays(events: CalendarAgendaEvent[], days: string[], zone?: string) {
  const grouped = new Map<string, CalendarAgendaEvent[]>()
  const unique = new Map(events.map(event => [calendarEventKey(event), event]))
  for (const event of unique.values()) {
    const start = event.allDay ? event.start.slice(0, 10) : dayKey(event.start, zone)
    const end = event.allDay ? event.end.slice(0, 10) : dayKey(new Date(Date.parse(event.end) - 1).toISOString(), zone)
    for (const day of days) {
      if (day < start || (event.allDay ? day >= end : day > end)) continue
      grouped.set(day, [...(grouped.get(day) ?? []), event])
    }
  }
  for (const list of grouped.values()) list.sort((a, b) => a.start.localeCompare(b.start))
  return grouped
}
