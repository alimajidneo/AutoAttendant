import { describe, expect, it } from 'vitest'
import { calendarSourceClass, calendarSourceLabel, groupCalendarSources } from './calendar-sources'
describe('calendar account colors and legend', () => {
  const sources = [
    { connectionId: 'first', provider: 'google' as const, accountEmail: 'first@example.test', colorIndex: 0, calendarId: 'one', calendarName: 'Work' },
    { connectionId: 'second', provider: 'microsoft' as const, accountEmail: 'second@example.test', colorIndex: 1, calendarId: 'two', calendarName: 'Personal' },
    { connectionId: 'first', provider: 'google' as const, accountEmail: 'first@example.test', colorIndex: 0, calendarId: 'three', calendarName: 'Bookings' },
  ]
  it('uses one color per account, different colors for the first eight accounts', () => {
    expect(calendarSourceClass(sources[0].colorIndex)).toBe(calendarSourceClass(sources[2].colorIndex))
    expect(new Set(Array.from({ length: 8 }, (_, i) => calendarSourceClass(i))).size).toBe(8)
  })
  it('uses a saved calendar color instead of its automatic account color', () => {
    expect(calendarSourceClass('teal')).toBe('calendar-source-teal')
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

describe('calendar source text', () => {
  const source = { connectionId: 'account', provider: 'google' as const, accountEmail: 'owner@example.test', colorIndex: 0, calendarId: 'primary', calendarName: 'owner@example.test' }
  it('shows the email once when Google uses it as the calendar name', () => {
    expect(groupCalendarSources([source])[0].calendars).toEqual([])
    expect(calendarSourceLabel(source)).toBe('owner@example.test')
  })
  it('keeps meaningful secondary calendar names beneath the account', () => {
    const secondary = { ...source, calendarId: 'team', calendarName: 'Team demos' }
    expect(groupCalendarSources([source, secondary])[0].calendars).toEqual(['Team demos'])
    expect(calendarSourceLabel(secondary)).toBe('Team demos · owner@example.test')
  })
  it('ignores case and whitespace in duplicate email labels', () => {
    const primary = { ...source, calendarName: ' OWNER@example.test ' }
    expect(groupCalendarSources([primary])[0].calendars).toEqual([])
    expect(calendarSourceLabel(primary)).toBe(source.accountEmail)
  })
})
