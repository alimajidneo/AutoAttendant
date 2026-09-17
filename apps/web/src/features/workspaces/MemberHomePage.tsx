import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CalendarDays, Clock3, PhoneCall, Route, Settings2, ShieldCheck, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PageContainer } from '@/layout/PageContainer'
import { PageHeader } from '@/layout/PageHeader'
import { apiClient } from '@/lib/apiClient'
import { fetchers, keys } from '@/lib/queries'
import { useAuth } from '@/features/auth/useAuth'
import { CallsTable } from '@/features/home/CallsTable'
import { useAgentZone } from '@/hooks/useAgentZone'
import { formatTime } from '@/lib/formatters'
import { browserTransferUi } from '@/lib/livekit'
import { TransferInbox } from './TransferInbox'

type Workspace = { id: string; name: string; kind: 'personal' | 'team'; role: 'manager' | 'member'; ownerUserId: string; userId: string }
type Member = { userId: string; email: string; displayName: string; department: string; available: boolean; role: 'manager' | 'member' }

export function MemberHomePage() {
  const { user } = useAuth()
  const zone = useAgentZone()
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: () => apiClient.get<Workspace[]>('/workspaces').then(r => r.data) })
  const selectedId = sessionStorage.getItem('deskroute.workspace')
  const workspace = workspaces.data?.find(item => item.id === selectedId) ?? workspaces.data?.[0]
  const members = useQuery({
    queryKey: ['workspace-members', workspace?.id],
    queryFn: () => apiClient.get<Member[]>(`/workspaces/${workspace!.id}/members`).then(r => r.data),
    enabled: !!workspace,
  })
  const appointments = useQuery({ queryKey: keys.appointments, queryFn: fetchers.appointments })
  const self = members.data?.find(member => member.userId === user?.id)
  const now = Date.now()
  const upcoming = useMemo(() => (appointments.data ?? [])
    .filter(item => item.status !== 'cancelled' && item.endTime && Date.parse(item.endTime) > now)
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '')),
  [appointments.data, now])
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date())
  const todayCount = upcoming.filter(item => item.startTime
    && new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(item.startTime)) === today).length
  const displayName = user?.user_metadata.first_name || user?.user_metadata.full_name?.split(' ')[0] || ''

  return <PageContainer className="pb-10">
    <PageHeader
      title={displayName ? `Welcome, ${displayName}` : 'Workspace dashboard'}
      description={workspace ? `${workspace.name} calls, appointments and team handoffs.` : 'Your workspace activity.'}
      actions={<Button variant="outline" render={<Link to="/workspaces" />}><Settings2 />Workspace profile</Button>}
    />

    <div className={`mt-7 grid gap-4 sm:grid-cols-2 ${browserTransferUi ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
      {[
        { label: 'Upcoming appointments', value: appointments.isLoading ? '—' : upcoming.length, icon: CalendarDays, tone: 'bg-success-subtle text-success' },
        { label: 'Appointments today', value: appointments.isLoading ? '—' : todayCount, icon: Clock3, tone: 'bg-primary-subtle text-accent-ink' },
        { label: 'Team members', value: members.isLoading ? '—' : members.data?.length ?? 0, icon: Users, tone: 'bg-violet-subtle text-violet' },
        ...(browserTransferUi ? [{ label: browserTransferUi.statusLabel, value: self?.available ? 'Available' : 'Unavailable', icon: Route, tone: 'bg-warning-subtle text-warning' }] : []),
      ].map(({ label, value, icon: Icon, tone }) => <article key={label} className="rounded-2xl border border-border bg-card p-5 shadow-sm" data-ground="card">
        <span className={`grid size-10 place-items-center rounded-xl ${tone}`}><Icon className="size-5" /></span>
        <p className="mt-4 text-sm font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
      </article>)}
    </div>

    <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" data-ground="card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Recent workspace calls</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Caller, summary, duration and outcome. Transcripts stay manager-only.</p>
          </div>
          <Link to="/calls" className="flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline">View all <ArrowRight className="size-4" /></Link>
        </div>
        <div className="p-3"><CallsTable compact allowDetails={false} /></div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm" data-ground="card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Upcoming appointments</h2>
            <p className="mt-1 text-sm text-muted-foreground">Shared receptionist bookings for this workspace.</p>
          </div>
          <CalendarDays className="size-5 text-primary" />
        </div>
        <div className="mt-4 divide-y divide-border">
          {appointments.isLoading ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="my-2 h-14" />)
            : upcoming.length === 0 ? <p className="py-5 text-sm text-muted-foreground">No upcoming appointments.</p>
              : upcoming.slice(0, 4).map(item => <div key={item.id} className="py-3 first:pt-0">
                <p className="truncate font-semibold text-foreground">{item.service}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.startTime ? `${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: zone }).format(new Date(item.startTime))} · ${formatTime(item.startTime, zone)}` : 'Time pending'} · {item.callerName || 'Caller'}</p>
              </div>)}
        </div>
        <Button className="mt-4 w-full" variant="outline" render={<Link to="/appointments" />}>Open calendar <ArrowRight /></Button>
      </section>
    </div>

    <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.75fr)]">
      {browserTransferUi && <TransferInbox />}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm" data-ground="card">
        <h2 className="text-lg font-semibold">Your access</h2>
        <div className="mt-4 grid gap-3 text-sm text-muted-foreground">
          <p className="flex items-start gap-2"><PhoneCall className="mt-0.5 size-4 shrink-0 text-primary" />You can read workspace call logs and appointments.</p>
          <p className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />Only managers can open transcripts, recordings, change settings or delete records. Private events from another person's connected calendar are not shown here.</p>
        </div>
        <Button className="mt-5" variant="outline" render={<Link to="/help?guide=workspaces" />}>Open workspace tutorial</Button>
      </section>
    </div>
  </PageContainer>
}
