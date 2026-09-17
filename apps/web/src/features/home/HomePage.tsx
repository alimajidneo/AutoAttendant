import { useQueries, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, BookOpen, CalendarPlus, CircleHelp, Clock3, PhoneCall } from 'lucide-react'
import { PageContainer } from '@/layout/PageContainer'
import { PageHeader } from '@/layout/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { apiClient } from '@/lib/apiClient'
import { keys, fetchers } from '@/lib/queries'
import { usePageReady } from '@/hooks/usePageData'
import { dayKey, formatPhone, formatTime } from '@/lib/formatters'
import type { Period } from '@/lib/types'
import { CallStats } from './CallStats'
import { CallsTable } from './CallsTable'
import { TestAgentControl } from './TestAgentControl'
import { SetupChecklist, SetupBanner } from './SetupChecklist'
import { setupItems } from './setup-items'
import { useAuth } from '@/features/auth/useAuth'
import { useAgentZone } from '@/hooks/useAgentZone'
import { livekitBrowserControlsEnabled } from '@/lib/livekit'
import { MemberHomePage } from '@/features/workspaces/MemberHomePage'

function isPeriod(v: string | null): v is Period {
  return v === 'today' || v === '7d' || v === '30d'
}

function HomeSkeleton() {
  return (
    <>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-2 h-5 w-96" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-2xl" />)}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 w-full rounded-2xl lg:col-span-2" />
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    </>
  )
}

function ManagerHomePage() {
  const [params] = useSearchParams()
  const qc = useQueryClient()
  const { user } = useAuth()
  const zone = useAgentZone()
  const raw = params.get('period')
  const period: Period = isPeriod(raw) ? raw : '30d'

  const [settings, metrics, appointments] = useQueries({
    queries: [
      { queryKey: keys.settings, queryFn: fetchers.settings },
      { queryKey: keys.metrics(period), queryFn: () => fetchers.metrics(period) },
      { queryKey: keys.appointments, queryFn: fetchers.appointments },
    ],
  })

  const dismiss = useMutation({
    mutationFn: () => apiClient.patch('/admin/settings', { setup: { checklistDismissed: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.settings }),
  })

  const { ready, showSkeleton } = usePageReady(
    settings.isPending || metrics.isPending || appointments.isPending,
  )

  if (!ready) return <PageContainer>{showSkeleton ? <HomeSkeleton /> : null}</PageContainer>

  const s = settings.data!
  const m = metrics.data!
  const items = setupItems(s)
  const outstanding = items.some((item) => !item.done)
  const name = user?.user_metadata.first_name || user?.user_metadata.full_name?.split(' ')[0] || ''
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const today = dayKey(new Date().toISOString(), zone)
  const todayAppointments = (appointments.data ?? [])
    .filter((appointment) => appointment.startTime && dayKey(appointment.startTime, zone) === today && appointment.status !== 'cancelled')
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))

  return (
    <PageContainer className="pb-10">
      <PageHeader
        className="mb-8"
        title={`${greeting}${name ? `, ${name}` : ''}`}
        actions={livekitBrowserControlsEnabled ? <TestAgentControl /> : undefined}
        description={
          <>
            Here’s what {s.agent.name || 'your receptionist'} has handled for {s.business.name}.
            {s.business.phoneNumber && (
              <> · <span className="text-secondary-foreground tabular-nums">{formatPhone(s.business.phoneNumber)}</span></>
            )}
          </>
        }
      />

      {outstanding && !s.setup.checklistDismissed && (
        <SetupBanner items={items} onDismiss={() => dismiss.mutate()} />
      )}
      {outstanding && m.totalCalls === 0 && <SetupChecklist items={items} />}

      <CallStats period={period} metrics={m} agentName={s.agent.name} />

      <div className="mt-7 grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.8fr)]">
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" data-ground="card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-base font-semibold">Recent calls</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">Latest conversations and outcomes.</p>
            </div>
            <Link to="/calls" className="flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline">
              View all <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="p-3"><CallsTable compact /></div>
        </section>

        <div className="grid content-start gap-4">
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm" data-ground="card">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">Today’s appointments</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">{todayAppointments.length} scheduled</p>
              </div>
              <CalendarPlus className="size-5 text-accent-ink" />
            </div>
            <div className="mt-4 space-y-2">
              {todayAppointments.length === 0 ? (
                <p className="rounded-xl bg-sunk-1 px-3 py-4 text-sm text-muted-foreground">Nothing booked for today.</p>
              ) : todayAppointments.slice(0, 4).map((appointment) => (
                <div key={appointment.id} className="flex items-center gap-3 rounded-xl bg-sunk-1 px-3 py-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-subtle text-accent-ink"><Clock3 className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{appointment.service}</p>
                    <p className="truncate text-sm text-muted-foreground">{appointment.callerName || 'Caller'}</p>
                  </div>
                  <span className="text-sm font-medium tabular-nums">{formatTime(appointment.startTime!, zone)}</span>
                </div>
              ))}
            </div>
            <Link to="/appointments" className="mt-4 flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline">Open calendar <ArrowRight className="size-4" /></Link>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm" data-ground="card">
            <h2 className="text-base font-semibold">Quick actions</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[
                { to: '/calls', label: 'Review calls', icon: PhoneCall, tone: 'bg-primary-subtle text-accent-ink' },
                { to: '/appointments', label: 'Appointments', icon: CalendarPlus, tone: 'bg-success-subtle text-success' },
                { to: '/escalations', label: 'Questions', icon: CircleHelp, tone: 'bg-warning-subtle text-warning' },
                { to: '/knowledge', label: 'Knowledge', icon: BookOpen, tone: 'bg-violet-subtle text-violet' },
              ].map(({ to, label, icon: Icon, tone }) => (
                <Link key={to} to={to} className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2.5 font-medium hover:bg-hover">
                  <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${tone}`}><Icon className="size-4" /></span>
                  <span className="truncate">{label}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </PageContainer>
  )
}

export default function HomePage() {
  const { data: session } = useQuery({ queryKey: keys.session, queryFn: fetchers.session, staleTime: Infinity })
  return session?.role === 'member' ? <MemberHomePage /> : <ManagerHomePage />
}
