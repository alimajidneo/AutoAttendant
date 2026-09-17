import type { TimeInterval } from '@receptionist/shared'

const toMinutes = (hhmm: string) => {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

export function intervalProblem(intervals: TimeInterval[]): string | null {
  for (const interval of intervals) {
    if (!interval.start || !interval.end) return 'Fill in both times'
    if (toMinutes(interval.end) <= toMinutes(interval.start)) return 'Closing must be after opening'
  }
  const sorted = [...intervals].sort((left, right) => toMinutes(left.start) - toMinutes(right.start))
  for (let index = 1; index < sorted.length; index++) {
    if (toMinutes(sorted[index]!.start) < toMinutes(sorted[index - 1]!.end)) {
      return 'Periods on the same day cannot overlap'
    }
  }
  return null
}
