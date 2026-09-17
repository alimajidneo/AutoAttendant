import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { HoursException } from '@receptionist/shared'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { apiClient } from '@/lib/apiClient'
import { formatDate } from '@/lib/formatters'
import { keys } from '@/lib/queries'
import type { AppSettings } from '@/lib/settings-types'
import { IntervalEditor } from './HoursInterval'
import { intervalProblem } from './interval-problem'
import { RecordDrawer } from './RecordDrawer'
import { SaveBar } from './SaveBar'
import { Row, Section, SubRow } from './SettingsList'
import { useRecordDraft } from './useRecordDraft'
import { useServerSeed } from './useServerSeed'

export function HolidaysPanel({ settings }: { settings: AppSettings }) {
  const qc = useQueryClient()
  const server = settings.business.businessHours
  const [exceptions, setExceptions] = useState(server.exceptions)
  const {
    draft, open, edit, patch: patchDraft, close, reset, clear,
  } = useRecordDraft<{ index: number | null; value: HoursException }>()
  const hasProblem = exceptions.some(exception => !!intervalProblem(exception.intervals))
  const changes = useMemo(() => JSON.stringify(exceptions) === JSON.stringify(server.exceptions) ? [] : ['holidays'], [exceptions, server.exceptions])
  const expectReseed = useServerSeed(server, changes.length > 0, () => {
    setExceptions(server.exceptions)
    reset()
  })

  const save = useMutation({
    mutationFn: () => apiClient.patch('/admin/settings', {
      business: { businessHours: { exceptions } },
    }),
    onSuccess: async () => {
      expectReseed()
      await qc.invalidateQueries({ queryKey: keys.settings })
      toast.success('Holidays saved')
    },
    onError: () => toast.error('Could not save holidays. Check the dates and times and try again.'),
  })

  const patch = (next: Partial<HoursException>) => patchDraft(current => ({ ...current, value: { ...current.value, ...next } }))

  function commit() {
    if (!draft) return
    setExceptions(draft.index === null
      ? [...exceptions, draft.value]
      : exceptions.map((exception, index) => index === draft.index ? draft.value : exception))
    close()
  }

  function removeDraft() {
    if (draft && draft.index !== null) setExceptions(exceptions.filter((_, index) => index !== draft.index))
    close()
  }

  return (
    <div className="mt-6">
      <Section
        title="Holidays"
        lede="Days that replace your weekly hours and calendar availability."
        action={<Button variant="outline" size="sm" onClick={() => edit({ index: null, value: { date: '', intervals: [], label: '' } })}><Plus />Add a date</Button>}
        empty={exceptions.length === 0}
      >
        {exceptions.map((exception, index) => (
          <Row
            key={`${exception.date}-${index}`}
            title={exception.date ? formatDate(`${exception.date}T12:00:00`) : 'New date'}
            description={exception.intervals.length === 0
              ? `${exception.label || 'Closed'}. Closed all day.`
              : `${exception.label || 'Open'}. ${exception.intervals[0]!.start} to ${exception.intervals[0]!.end}.`}
          >
            <Button variant="outline" size="sm" onClick={() => edit({ index, value: exception })}>Edit</Button>
          </Row>
        ))}
      </Section>

      {draft && (
        <RecordDrawer
          open={open}
          onOpenChange={(value) => !value && close()}
          onClosed={clear}
          title={draft.index === null ? 'New date' : draft.value.label || 'Holiday'}
          description="This day replaces your weekly hours."
          saveLabel="Done"
          saveDisabled={!draft.value.date || !!intervalProblem(draft.value.intervals)}
          onSave={commit}
          onRemove={draft.index === null ? undefined : removeDraft}
          removeLabel="Remove date"
        >
          <SubRow title="Date" description="The day this applies to." htmlFor="hol-date">
            <DatePicker id="hol-date" value={draft.value.date} onChange={(date) => patch({ date })} className="w-field-md" />
          </SubRow>
          <SubRow title="Reason" description="For your own reference. Your agent never says it." htmlFor="hol-reason">
            <Input id="hol-reason" className="w-field-md" value={draft.value.label ?? ''} onChange={(event) => patch({ label: event.target.value })} />
          </SubRow>
          <SubRow title="Open at all" description="Off means closed all day.">
            <Switch checked={draft.value.intervals.length > 0} onCheckedChange={(enabled) => patch({ intervals: enabled ? [{ start: '09:00', end: '17:00' }] : [] })} aria-label="Open at all" />
          </SubRow>
          {draft.value.intervals.map((interval, index) => (
            <SubRow key={index} title="Open between" description="The hours for this one day.">
              <IntervalEditor
                interval={interval}
                onChange={(next) => patch({ intervals: draft.value.intervals.map((value, itemIndex) => itemIndex === index ? { ...value, ...next } : value) })}
                onRemove={() => patch({ intervals: draft.value.intervals.filter((_, itemIndex) => itemIndex !== index) })}
              />
            </SubRow>
          ))}
          {intervalProblem(draft.value.intervals) && <p className="pt-2 text-destructive">{intervalProblem(draft.value.intervals)}</p>}
        </RecordDrawer>
      )}

      <SaveBar
        changes={hasProblem ? [] : changes}
        saving={save.isPending}
        onSave={() => save.mutate()}
        onDiscard={() => { setExceptions(server.exceptions); reset() }}
      />
    </div>
  )
}
