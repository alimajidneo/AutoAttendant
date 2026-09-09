import { useSearchParams } from 'react-router-dom'
import { CalendarCheck, CircleHelp, PhoneCall, PhoneMissed } from 'lucide-react'
import type { DashboardMetrics } from '@receptionist/shared'
import { FilterPills } from '@/components/ui/filter-pills'
import type { Period } from '@/lib/types'

const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
] as const satisfies readonly { id: Period; label: string }[]

const PERIOD_LABEL: Record<Period, string> = {
  today: 'today',
  '7d': 'in the last 7 days',
  '30d': 'in the last 30 days',
}

export function CallStats({
  period,
  metrics,
}: {
  period: Period
  metrics: DashboardMetrics
  agentName: string
}) {
  const [params, setParams] = useSearchParams()

  function setPeriod(next: Period) {
    const p = new URLSearchParams(params)
    p.set('period', next)
    setParams(p, { replace: true })
  }

  const cards = [
    { label: 'Total calls', value: metrics.totalCalls, note: PERIOD_LABEL[period], icon: PhoneCall, tone: 'text-accent-ink bg-primary-subtle' },
    { label: 'Appointments', value: metrics.confirmedBookings, note: 'confirmed bookings', icon: CalendarCheck, tone: 'text-status-confirmed bg-success-subtle' },
    { label: 'Missed calls', value: metrics.abandonedCalls, note: 'callers who hung up', icon: PhoneMissed, tone: 'text-destructive bg-destructive-subtle' },
    { label: 'Questions', value: metrics.pendingEscalations, note: 'waiting for you', icon: CircleHelp, tone: 'text-warning bg-warning-subtle' },
  ]

  return (
    <section aria-labelledby="performance-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="performance-heading" className="text-lg font-semibold tracking-tight">Performance</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">A live summary of your receptionist.</p>
        </div>
        <FilterPills options={PERIODS} value={period} onChange={setPeriod} label="Time period" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, note, icon: Icon, tone }) => (
          <article key={label} className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm" data-ground="card">
            <span className={`absolute inset-x-0 top-0 h-0.5 ${tone.split(' ')[1]}`} />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-muted-foreground">{label}</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
              </div>
              <span className={`grid size-10 place-items-center rounded-xl ${tone}`}>
                <Icon className="size-5" />
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{note}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
