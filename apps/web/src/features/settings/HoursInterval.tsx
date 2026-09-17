import { X } from 'lucide-react'
import type { TimeInterval } from '@receptionist/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function IntervalEditor({
  interval,
  onChange,
  onRemove,
}: {
  interval: TimeInterval
  onChange: (patch: Partial<TimeInterval>) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Input type="time" value={interval.start} onChange={(event) => onChange({ start: event.target.value })} className="w-field-sm" aria-label="Opens at" />
      <span className="text-muted-foreground">to</span>
      <Input type="time" value={interval.end} onChange={(event) => onChange({ end: event.target.value })} className="w-field-sm" aria-label="Closes at" />
      <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Remove this period"><X /></Button>
    </div>
  )
}
