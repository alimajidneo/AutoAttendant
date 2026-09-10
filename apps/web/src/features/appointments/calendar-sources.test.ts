import { describe, expect, it } from 'vitest'
import { calendarSourceClass, groupCalendarSources } from './calendar-sources'
describe('calendar account colors and legend', () => {
  const sources = [
    { connectionId: 'first', accountEmail: 'first@example.test', colorIndex: 0, calendarId: 'one', calendarName: 'Work' },
    { connectionId: 'second', accountEmail: 'second@example.test', colorIndex: 1, calendarId: 'two', calendarName: 'Personal' },
    { connectionId: 'first', accountEmail: 'first@example.test', colorIndex: 0, calendarId: 'three', calendarName: 'Bookings' },
  ]
  it('uses one color per account, different colors for the first eight accounts', () => {
    expect(calendarSourceClass(sources[0].colorIndex)).toBe(calendarSourceClass(sources[2].colorIndex))
    expect(new Set(Array.from({ length: 8 }, (_, i) => calendarSourceClass(i))).size).toBe(8)
  })
  it('groups every selected calendar under its named account', () => {
    const grouped = groupCalendarSources(sources)
    expect(grouped).toHaveLength(2)
    expect(grouped[0].calendars).toEqual(['Work', 'Bookings'])
    expect(grouped[1].accountEmail).toBe('second@example.test')
  })
  it('preserves source order when event order changes', () => {
    expect(groupCalendarSources([...sources].reverse()).map(x => x.connectionId)).toEqual(['first', 'second'])
  })
})
