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

export function appointmentCalendarEventKey(appointment: AppointmentItem) {
  return calendarEventKey({ id: appointment.externalEventId ?? appointment.id, calendarId: appointment.externalCalendarId ?? 'workspace' })
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

function addCalendarDays(dateIso: string, days: number) {
  const [year, month, day] = dateIso.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!) + days * 86_400_000).toISOString().slice(0, 10)
}

export function upcomingCalendarEvents(events: CalendarAgendaEvent[], now: number, requestedDays: number, zone?: string) {
  const days = Math.min(7, Math.max(1, Math.trunc(requestedDays)))
  const today = dayKey(new Date(now).toISOString(), zone)
  const lastDayExclusive = addCalendarDays(today, days)
  return [...new Map(events.map(item => [calendarEventKey(item), item])).values()]
    .filter(item => item.allDay
      ? item.end.slice(0, 10) > today && item.start.slice(0, 10) < lastDayExclusive
      : Date.parse(item.end) > now && dayKey(item.start, zone) < lastDayExclusive)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}
