import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  WEEKDAYS,
  type BusinessHours,
  type BookingPolicy,
  type TimeInterval,
  type Weekday,
} from '@receptionist/shared'
import { Button } from '@/components/ui/button'
import { NumberField } from '@/components/ui/number-field'
import { Switch } from '@/components/ui/switch'
import { apiClient } from '@/lib/apiClient'
import { keys } from '@/lib/queries'
import type { AppSettings } from '@/lib/settings-types'
import { Section, Row } from './SettingsList'
import { useServerSeed } from './useServerSeed'
import { SaveBar } from './SaveBar'
import { IntervalEditor } from './HoursInterval'
import { intervalProblem } from './interval-problem'

const DAY_LABELS: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

export function HoursPanel({ settings }: { settings: AppSettings }) {
  const qc = useQueryClient()
  const server = settings.business

  const [hours, setHours] = useState<BusinessHours>(server.businessHours)
  const [policy, setPolicy] = useState<BookingPolicy>(server.bookingPolicy)
  const reviewRecorded = useRef(settings.setup.hoursSeen)

  const dayProblems = WEEKDAYS.map((d) => intervalProblem(hours.weekly[d] ?? []))
  const hasProblem = dayProblems.some(Boolean)

  const changes = useMemo(() => {
    const out: string[] = []
    if (JSON.stringify(hours.weekly) !== JSON.stringify(server.businessHours.weekly)) {
      out.push('opening hours')
    }

    if (JSON.stringify(policy) !== JSON.stringify(server.bookingPolicy)) {
      out.push('booking window')
    }
    return out
  }, [hours, policy, server])

  /* A save re-seeds so the saved shape is the one on screen. A background
     refetch must not, or it eats an unsaved edit. */
  const expectReseed = useServerSeed(server, changes.length > 0, () => {
    setHours(server.businessHours)
    setPolicy(server.bookingPolicy)
  })

  const save = useMutation({
    mutationFn: () =>
      apiClient.patch('/admin/settings', {
        business: { businessHours: { weekly: hours.weekly }, bookingPolicy: policy },
        setup: { hoursSeen: true },
      }),
    onSuccess: async () => {
      expectReseed()
      await qc.invalidateQueries({ queryKey: keys.settings })
      toast.success('Hours saved')
    },
    onError: () => toast.error('Could not save. Check the times and try again.'),
  })

  useEffect(() => {
    if (reviewRecorded.current) return
    reviewRecorded.current = true
    void apiClient.patch('/admin/settings', { setup: { hoursSeen: true } })
      .then(() => qc.invalidateQueries({ queryKey: keys.settings }))
      .catch(() => { reviewRecorded.current = false })
  }, [qc])

  function setDay(day: Weekday, intervals: TimeInterval[]) {
    setHours((h) => ({ ...h, weekly: { ...h.weekly, [day]: intervals } }))
  }


  return (
    <div>
      <Section
        title="Opening hours"
        lede="Your agent only offers times inside these hours."
      >
        {WEEKDAYS.map((day, dayIndex) => {
          const intervals = hours.weekly[day] ?? []
          const open = intervals.length > 0
          const problem = dayProblems[dayIndex]
          return (
            <li
              key={day}
              className="flex items-start justify-between gap-5 border-t border-border/60 p-4 first:border-t-0"
            >
              <div className="flex min-w-0 items-center gap-3 pt-1">
                <Switch
                  checked={open}
                  onCheckedChange={(on) =>
                    setDay(day, on ? [{ start: '09:00', end: '17:00' }] : [])
                  }
                  aria-label={`Open on ${DAY_LABELS[day]}`}
                />
                <span className="font-medium text-foreground">{DAY_LABELS[day]}</span>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                {!open ? (
                  <span className="pt-1.5 text-muted-foreground">Closed</span>
                ) : (
                  <>
                    {intervals.map((interval, i) => (
                      <IntervalEditor
                        key={i}
                        interval={interval}
                        onChange={(patch) =>
                          setDay(
                            day,
                            intervals.map((v, idx) => (idx === i ? { ...v, ...patch } : v)),
                          )
                        }
                        onRemove={() => setDay(day, intervals.filter((_, idx) => idx !== i))}
                      />
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDay(day, [...intervals, { start: '14:00', end: '18:00' }])}
                    >
                      <Plus />
                      Add a second period
                    </Button>
                  </>
                )}
                {problem && <p className="text-destructive">{problem}</p>}
              </div>
            </li>
          )
        })}
      </Section>


      <Section title="Booking window" lede="How near and how far ahead a caller may book.">
        <Row
          title="Earliest a caller can book"
          description="Your agent will not offer a time sooner than this, so you get some warning."
          htmlFor="min-notice"
        >
          <NumberField
            id="min-notice"
            label="Minimum notice in minutes"
            unit="minutes"
            value={policy.minNoticeMinutes}
            onChange={(minNoticeMinutes) => setPolicy((p) => ({ ...p, minNoticeMinutes }))}
          />
        </Row>
        <Row
          title="Furthest a caller can book"
          description="Your agent will not offer a date beyond this."
          htmlFor="max-advance"
        >
          <NumberField
            id="max-advance"
            label="Furthest ahead in days"
            unit="days"
            value={policy.maxAdvanceDays}
            onChange={(maxAdvanceDays) => setPolicy((p) => ({ ...p, maxAdvanceDays }))}
          />
        </Row>
      </Section>

      <SaveBar
        changes={hasProblem ? [] : changes}
        saving={save.isPending}
        onSave={() => save.mutate()}
        onDiscard={() => {
          setHours(server.businessHours)
          setPolicy(server.bookingPolicy)
        }}
      />
    </div>
  )
}
