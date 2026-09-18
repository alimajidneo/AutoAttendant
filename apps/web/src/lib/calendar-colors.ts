import type { CalendarSourceColor } from '@receptionist/shared'

export const calendarSourceColors: ReadonlyArray<{ value: CalendarSourceColor; label: string }> = [
  { value: 'blue', label: 'Blue' },
  { value: 'violet', label: 'Violet' },
  { value: 'green', label: 'Green' },
  { value: 'amber', label: 'Amber' },
  { value: 'pink', label: 'Pink' },
  { value: 'teal', label: 'Teal' },
  { value: 'orange', label: 'Orange' },
  { value: 'slate', label: 'Slate' },
  { value: 'red', label: 'Red' },
  { value: 'cyan', label: 'Cyan' },
  { value: 'lime', label: 'Lime' },
  { value: 'indigo', label: 'Indigo' },
]

const classes = calendarSourceColors.map(({ value }) => `calendar-source-${value}`)

export function calendarSourceClass(color: CalendarSourceColor | number) {
  return typeof color === 'number'
    ? classes[color % classes.length] ?? classes[0]
    : `calendar-source-${color}`
}
