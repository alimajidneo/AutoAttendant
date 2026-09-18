import { expect, it } from 'vitest'
import { calendarSourceColors } from './calendar-colors'

it('offers twelve distinct calendar colors', () => {
  expect(calendarSourceColors).toHaveLength(12)
  expect(new Set(calendarSourceColors.map(option => option.value))).toHaveLength(12)
})
