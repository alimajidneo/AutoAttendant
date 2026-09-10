import type { CalendarAgendaSource } from '@receptionist/shared'

const classes = ['calendar-source-blue', 'calendar-source-violet', 'calendar-source-green', 'calendar-source-amber',
  'calendar-source-pink', 'calendar-source-teal', 'calendar-source-orange', 'calendar-source-slate'] as const

export function calendarSourceClass(index: number) {
  return classes[index % classes.length] ?? classes[0]
}

export function groupCalendarSources(sources: CalendarAgendaSource[]) {
  const accounts = new Map<string, { connectionId: string; accountEmail: string; colorIndex: number; calendars: string[] }>()
  for (const source of sources) {
    const account = accounts.get(source.connectionId) ?? { ...source, calendars: [] }
    if (!account.calendars.includes(source.calendarName)) account.calendars.push(source.calendarName)
    accounts.set(source.connectionId, account)
  }
  return [...accounts.values()].sort((a, b) => a.colorIndex - b.colorIndex)
}
