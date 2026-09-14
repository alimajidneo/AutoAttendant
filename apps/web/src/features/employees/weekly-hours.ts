import { WEEKDAYS, type BusinessHours, type Weekday, type TimeInterval } from '@receptionist/shared'
export function replaceDay(hours: BusinessHours, day: Weekday, intervals: TimeInterval[]): BusinessHours {
  return { ...hours, weekly: { ...hours.weekly, [day]: intervals } }
}
export function hoursErrors(hours: BusinessHours): Partial<Record<Weekday, string>> {
  const errors: Partial<Record<Weekday, string>> = {}
  for (const day of WEEKDAYS) {
    const intervals = [...(hours.weekly[day] ?? [])].sort((a, b) => a.start.localeCompare(b.start))
    if (intervals.some((p, i) => !/^\d{2}:\d{2}$/.test(p.start) || !/^\d{2}:\d{2}$/.test(p.end) || p.end <= p.start || (i > 0 && p.start < intervals[i - 1].end))) errors[day] = 'End must be after start and intervals must not overlap.'
  }
  return errors
}
