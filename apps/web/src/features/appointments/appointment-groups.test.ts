import { describe, expect, it } from 'vitest'
import type { AppointmentItem, CalendarAgendaEvent } from '@receptionist/shared'
import { eventsForDays, splitAppointments } from './appointment-groups'

const appointment = (overrides: Partial<AppointmentItem>): AppointmentItem => ({
  id: 'appointment', callerPhone: null, callerName: null, service: 'Meeting',
  startTime: '2026-09-09T10:00:00Z', endTime: '2026-09-09T11:00:00Z',
  status: 'confirmed', externalEventId: null, bookingDetails: [], createdAt: '2026-09-08T10:00:00Z', updatedAt: '2026-09-08T10:00:00Z',
  ...overrides,
})
const event = (overrides: Partial<CalendarAgendaEvent> = {}): CalendarAgendaEvent => ({
  id: 'event', calendarId: 'calendar-a', title: 'Test meeting', allDay: false,
  start: '2026-09-09T10:00:00Z', end: '2026-09-09T11:00:00Z', ...overrides,
})

describe('appointment sections', () => {
  it('keeps ongoing appointments until their exact end time', () => {
    const item = appointment({})
    expect(splitAppointments([item], Date.parse('2026-09-09T10:30:00Z')).upcoming).toEqual([item])
    expect(splitAppointments([item], Date.parse(item.endTime!))).toEqual({ upcoming: [], past: [item] })
  })
  it('compares absolute instants regardless of timezone offsets', () => {
    const item = appointment({ endTime: '2026-09-09T16:00:00+05:00' })
    expect(splitAppointments([item], Date.parse('2026-09-09T11:00:00Z')).past).toEqual([item])
  })
  it('includes cancelled history and orders past appointments by latest end first', () => {
    const older = appointment({ id: 'older', status: 'cancelled' })
    const newer = appointment({ id: 'newer', endTime: '2026-09-09T12:00:00Z' })
    expect(splitAppointments([older, newer], Date.parse('2026-09-09T13:00:00Z')).past).toEqual([newer, older])
  })
  it('keeps requests without an end time out of past history and hides future cancellations', () => {
    const request = appointment({ id: 'request', status: 'requested', startTime: null, endTime: null })
    const cancelled = appointment({ status: 'cancelled' })
    expect(splitAppointments([request, cancelled], Date.parse('2026-09-09T09:00:00Z'))).toEqual({ past: [], upcoming: [request] })
  })
})

describe('calendar day display', () => {
  const days = ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']
  it('shows multi-day all-day events on every day, excluding their end date', () => {
    const item = event({ allDay: true, start: '2026-09-08', end: '2026-09-11' })
    const grouped = eventsForDays([item], days, 'America/New_York')
    expect([...grouped.keys()]).toEqual(days.slice(0, 3))
  })
  it('shows overnight events on both days in the business timezone', () => {
    const item = event({ start: '2026-09-10T03:30:00Z', end: '2026-09-10T04:30:00Z' })
    expect([...eventsForDays([item], days, 'America/New_York').keys()]).toEqual(['2026-09-09', '2026-09-10'])
  })
  it('does not show an event ending at midnight on the next day', () => {
    const item = event({ start: '2026-09-09T23:30:00Z', end: '2026-09-10T00:00:00Z' })
    expect([...eventsForDays([item], days, 'UTC').keys()]).toEqual(['2026-09-09'])
  })
  it('preserves events with the same id in distinct calendars and deduplicates a shared calendar', () => {
    const first = event()
    const second = event({ calendarId: 'calendar-b' })
    expect(eventsForDays([first, second, first], days, 'UTC').get('2026-09-09')).toEqual([first, second])
  })
})
