import { hoursErrors, replaceDay } from './weekly-hours'
import { WEEKDAYS, type BusinessHours, type Weekday, type TimeInterval } from '@receptionist/shared'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
const names: Record<Weekday, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }
export function WeeklyHours({ value, onChange }: { value: BusinessHours; onChange: (value: BusinessHours) => void }) {
  const errors = hoursErrors(value)
  return <fieldset className="grid min-w-0 gap-3"><legend className="mb-2 text-sm font-semibold">Weekly working hours</legend>{WEEKDAYS.map(day => {
    const intervals = value.weekly[day] ?? [], name = names[day]
    const change = (next: TimeInterval[]) => onChange(replaceDay(value, day, next))
    return <div key={day} className="grid gap-2 border-t border-border pt-2">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`${name} open`} checked={intervals.length > 0} onChange={event => change(event.target.checked ? [{ start: '09:00', end: '17:00' }] : [])} />{name} · {intervals.length ? 'Open' : 'Closed'}</label>
      {intervals.map((interval, index) => <div key={index} className="flex flex-wrap items-end gap-2">
        {(['start', 'end'] as const).map(field => <label key={field} className="grid gap-1 text-sm">{field === 'start' ? 'Start' : 'End'}<Input type="time" className="w-field-md sm:w-field-sm" aria-label={`${name} interval ${index + 1} ${field}`} value={interval[field]} required onChange={event => change(intervals.map((p, i) => i === index ? { ...p, [field]: event.target.value } : p))} /></label>)}
        <Button type="button" variant="outline" aria-label={`Remove ${name} interval ${index + 1}`} onClick={() => change(intervals.filter((_, i) => i !== index))}>Remove</Button>
      </div>)}
      {intervals.length > 0 && <Button type="button" variant="outline" aria-label={`Add ${name} interval`} onClick={() => change([...intervals, { start: '09:00', end: '17:00' }])}>Add interval</Button>}
      {errors[day] && <p role="alert" className="text-sm text-destructive">{name}: {errors[day]}</p>}
    </div>
  })}</fieldset>
}
