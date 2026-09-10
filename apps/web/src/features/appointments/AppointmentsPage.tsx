import { useEffect, useMemo, useState } from 'react'
import { isAxiosError } from 'axios'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, CalendarCheck2, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AppointmentItem, CalendarAgendaEvent, CalendarAgenda } from '@receptionist/shared'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/ui/status-badge'
import { PageContainer } from '@/layout/PageContainer'
import { PageHeader } from '@/layout/PageHeader'
import { keys, fetchers } from '@/lib/queries'
import { useAgentZone } from '@/hooks/useAgentZone'
import { formatPhone, formatTime, dayKey } from '@/lib/formatters'
import { appointmentStatusConfig } from '@/lib/status-config'
import { apiClient } from '@/lib/apiClient'
import { cn } from '@/lib/utils'
import { calendarSourceClass, calendarSourceLabel, groupCalendarSources } from './calendar-sources'
import { appointmentCalendarEventKey, calendarEventKey, eventsForDays, splitAppointments } from './appointment-groups'
import { removeAppointmentFromCache } from './appointment-cache'

const DAY_MS = 86_400_000
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function addDays(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!) + days * DAY_MS).toISOString().slice(0, 10)
}

function monthGrid(monthIso: string): string[] {
  const first = `${monthIso}-01`
  const weekday = new Date(`${first}T12:00:00Z`).getUTCDay()
  const start = addDays(first, -((weekday + 6) % 7))
  return Array.from({ length: 42 }, (_, index) => addDays(start, index))
}

function shiftMonth(monthIso: string, amount: number): string {
  const [year, month] = monthIso.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1 + amount, 1)).toISOString().slice(0, 7)
}

function monthLabel(monthIso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${monthIso}-01T12:00:00Z`))
}

function dateLabel(dateIso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${dateIso}T12:00:00Z`))
}

function eventTime(event: CalendarAgendaEvent, zone?: string): string {
  return event.allDay ? 'All day' : formatTime(event.start, zone)
}

function appointmentDateTime(appointment: AppointmentItem, zone?: string): string {
  if (!appointment.startTime) return 'Time pending'
  const date = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', timeZone: zone,
  }).format(new Date(appointment.startTime))
  return `${date} · ${formatTime(appointment.startTime, zone)}`
}

export default function AppointmentsPage() {
  const zone = useAgentZone()
  const queryClient = useQueryClient()
  const [now, setNow] = useState(() => Date.now())
  const today = dayKey(new Date(now).toISOString(), zone)
  const [month, setMonth] = useState(() => today.slice(0, 7))
  const [selectedDay, setSelectedDay] = useState(today)
  const [cancelling, setCancelling] = useState<AppointmentItem | null>(null)
  const [deleting, setDeleting] = useState<AppointmentItem | null>(null)

  useEffect(() => {
    const update = () => setNow(Date.now())
    const timer = window.setInterval(update, 30_000)
    document.addEventListener('visibilitychange', update)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update) }
  }, [])

  const days = useMemo(() => monthGrid(month), [month])
  const range = useMemo(() => ({
    timeMin: new Date(`${addDays(days[0]!, -1)}T00:00:00Z`).toISOString(),
    timeMax: new Date(`${addDays(days.at(-1)!, 1)}T23:59:59Z`).toISOString(),
  }), [days])

  const appointmentsQuery = useQuery({
    queryKey: keys.appointments,
    queryFn: fetchers.appointments,
    staleTime: 0,
  })
  const calendarKey = ['appointments', 'calendar', range.timeMin, range.timeMax] as const
  const calendarQuery = useQuery({
    queryKey: calendarKey,
    queryFn: ({ signal }) => apiClient
      .get<CalendarAgenda>('/admin/appointments/calendar', { params: range, signal })
      .then((response) => response.data),
    retry: false,
  })

  const appointments = useMemo(() => appointmentsQuery.data ?? [], [appointmentsQuery.data])
  const events = useMemo(() => calendarQuery.data?.events ?? [], [calendarQuery.data])
  const sources = useMemo(() => calendarQuery.data?.sources ?? [], [calendarQuery.data])
  const sourceByCalendar = useMemo(() => new Map(sources.map(source => [source.calendarId, source])), [sources])
  const sourceAccounts = useMemo(() => groupCalendarSources(sources), [sources])
  const appointmentByEventId = useMemo(
    () => new Map(appointments.map(item => [appointmentCalendarEventKey(item), item])),
    [appointments],
  )
  const eventsByDay = useMemo(() => eventsForDays(events, days, zone), [events, days, zone])
  const { upcoming, past } = useMemo(() => splitAppointments(appointments, now), [appointments, now])
  const selectedEvents = eventsByDay.get(selectedDay) ?? []
  const appointmentStats = [
    { label: 'Total appointments', value: appointments.length, icon: CalendarCheck2, tone: 'bg-primary-subtle text-accent-ink', line: 'bg-primary' },
    { label: 'Confirmed', value: appointments.filter((item) => item.status === 'confirmed').length, icon: CheckCircle2, tone: 'bg-success-subtle text-success', line: 'bg-success' },
    { label: 'Requested', value: appointments.filter((item) => item.status === 'requested').length, icon: Clock3, tone: 'bg-warning-subtle text-warning', line: 'bg-warning' },
    { label: 'Cancelled', value: appointments.filter((item) => item.status === 'cancelled').length, icon: Ban, tone: 'bg-destructive-subtle text-destructive', line: 'bg-destructive' },
  ]

  const refresh = useMutation({
    mutationFn: () => apiClient
      .post<{ checked: number; cancelledIds: string[]; appointments: AppointmentItem[] }>('/admin/appointments/sync')
      .then((response) => response.data),
    onSuccess: ({ appointments: latestAppointments }) => {
      queryClient.setQueryData<AppointmentItem[]>(keys.appointments, latestAppointments)
      void queryClient.invalidateQueries({ queryKey: keys.notifications })
    },
    onError: () => toast.error('Appointment sync failed. Check the calendar connection and try again.'),
    onSettled: async (result, error) => {
      const agenda = await calendarQuery.refetch()
      if (error) return
      if (agenda.isError) { toast.error('Could not refresh calendar events. Check your calendar connections.'); return }
      const count = result?.cancelledIds.length ?? 0
      toast.success(count ? `${count} calendar ${count === 1 ? 'change' : 'changes'} found` : 'Calendar is up to date')
    },
  })

  const cancel = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/appointments/${id}`),
    onSuccess: async (_response, id) => {
      queryClient.setQueryData<AppointmentItem[]>(keys.appointments, (current = []) =>
        current.map((item) => item.id === id ? { ...item, status: 'cancelled' } : item),
      )
      await calendarQuery.refetch()
      await queryClient.invalidateQueries({ queryKey: keys.metricsAll })
      void queryClient.invalidateQueries({ queryKey: keys.notifications })
      toast.success('Appointment cancelled')
    },
    onError: () => toast.error('Could not cancel the appointment in its calendar. Nothing was changed.'),
  })

  const removeHistory = useMutation({
    mutationFn: (appointment: AppointmentItem) => apiClient.delete(`/admin/appointments/history/${appointment.id}`),
    onSuccess: async (_response, removed) => {
      await removeAppointmentFromCache(queryClient, removed)
      void queryClient.invalidateQueries({ queryKey: keys.notifications })
      void queryClient.invalidateQueries({ queryKey: keys.metricsAll })
      toast.success('Past appointment deleted from DeskRoute and its calendar')
    },
    onError: (error) => {
      const detail = isAxiosError<{ error?: string }>(error) && error.response?.status === 409
        ? error.response.data.error : undefined
      toast.error(detail || 'Could not delete this past appointment. Check the original calendar account and try again.')
    },
  })

  function moveMonth(amount: number) {
    const next = shiftMonth(month, amount)
    setMonth(next)
    setSelectedDay(`${next}-01`)
  }

  return (
    <PageContainer>
      <PageHeader
        title="Appointments"
        description="Appointments and events from the Google and Microsoft calendars you have selected."
        actions={
          <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending || removeHistory.isPending || cancel.isPending}>
            <RefreshCw className={cn(refresh.isPending && 'animate-spin')} />
            <span className="hidden sm:inline">Refresh calendar</span>
            <span className="sm:hidden">Refresh</span>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-primary-subtle px-4 py-3">
        <p className="text-sm text-foreground">Missing an event? Select its calendar in Connections, save, then refresh this page.</p>
        <Link to="/settings?tab=connections&manageCalendars=1" className="text-sm font-semibold text-accent-ink underline underline-offset-4">Manage calendars</Link>
      </div>

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Appointment summary">
        {appointmentStats.map(({ label, value, icon: Icon, tone, line }) => (
          <article key={label} className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm" data-ground="card">
            <span className={`absolute inset-x-0 top-0 h-0.5 ${line}`} />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{label}</p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{value}</p>
              </div>
              <span className={`grid size-10 place-items-center rounded-xl ${tone}`}><Icon className="size-5" /></span>
            </div>
          </article>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" data-ground="card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
            <div>
              <h2 className="text-base font-semibold text-foreground">{monthLabel(month)}</h2>
              <p className="text-sm text-muted-foreground">Select a day to see its full agenda.</p>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft /></Button>
              <Button variant="ghost" size="sm" onClick={() => { setMonth(today.slice(0, 7)); setSelectedDay(today) }}>Today</Button>
              <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => moveMonth(1)}><ChevronRight /></Button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-border bg-muted/25">
            {WEEKDAYS.map((weekday) => (
              <div key={weekday} className="px-1 py-2 text-center text-xs font-medium text-muted-foreground">{weekday}</div>
            ))}
          </div>

          {calendarQuery.isLoading ? (
            <div className="grid grid-cols-7 gap-px bg-border p-px">
              {days.map((day) => <Skeleton key={day} className="h-24 rounded-none sm:h-28" />)}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-px bg-border">
              {days.map((day) => {
                const dayEvents = eventsByDay.get(day) ?? []
                const inMonth = day.startsWith(month)
                const selected = day === selectedDay
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setSelectedDay(day)}
                    className={cn(
                      'min-h-24 min-w-0 bg-card p-1.5 text-left transition-colors hover:bg-hover sm:min-h-28 sm:p-2',
                      !inMonth && 'bg-muted/20 text-muted-foreground',
                      selected && 'relative z-10 ring-2 ring-inset ring-primary',
                    )}
                  >
                    <span className={cn(
                      'mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums',
                      day === today && 'bg-primary font-semibold text-primary-foreground',
                    )}>{Number(day.slice(-2))}</span>
                    <span className="block space-y-1">
                      {dayEvents.slice(0, 3).map((event) => (
                        <span
                          key={calendarEventKey(event)}
                          className={cn(
                            'block truncate rounded border-l-2 px-1 py-0.5 text-[10px] leading-4 sm:text-xs',
                            'calendar-event-chip', calendarSourceClass(sourceByCalendar.get(event.calendarId)?.colorIndex ?? 0),
                          )}
                        >
                          <span className="hidden sm:inline">{eventTime(event, zone)} </span>{event.title}
                        </span>
                      ))}
                      {dayEvents.length > 3 && <span className="block px-1 text-[10px] text-muted-foreground">+{dayEvents.length - 3} more</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {sourceAccounts.length > 0 && (
            <section aria-label="Calendar sources" className="border-t border-border bg-muted/20 px-4 py-3 sm:px-5">
              <h3 className="text-sm font-semibold text-foreground">Calendar sources</h3>
              <p className="mt-1 text-sm text-muted-foreground">Each color identifies a connected account. Only your selected calendars are shown.</p>
              <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
                {sourceAccounts.map(account => <li key={account.connectionId} className="flex min-w-0 items-start gap-2">
                  <span aria-hidden="true" className={cn('calendar-source-dot mt-1 size-3 shrink-0 rounded-full', calendarSourceClass(account.colorIndex))} />
                  <div className="min-w-0">
                    <p className="break-all text-sm font-semibold text-foreground">{account.provider === 'google' ? 'Google' : 'Microsoft'} · {account.accountEmail}</p>
                    {account.calendars.length > 0 && <p className="break-words text-sm text-muted-foreground">{account.calendars.join(' · ')}</p>}
                  </div>
                </li>)}
              </ul>
            </section>
          )}

          <div className="border-t border-border p-4 sm:p-5">
            <h3 className="font-semibold text-foreground">{dateLabel(selectedDay)}</h3>
            {calendarQuery.isError ? (
              <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Calendar events are unavailable. Check Calendars under Settings → Connections.
              </p>
            ) : selectedEvents.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Nothing scheduled on this calendar.</p>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {selectedEvents.map((event) => {
                  const appointment = appointmentByEventId.get(calendarEventKey(event))
                  const source = sourceByCalendar.get(event.calendarId)
                  return (
                    <div key={calendarEventKey(event)} className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg bg-muted/65 px-3 py-2.5">
                      <span className={cn(
                        'h-9 w-1 shrink-0 rounded-full',
                        'calendar-source-dot', calendarSourceClass(source?.colorIndex ?? 0),
                      )} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{event.title}</p>
                        <p className="text-sm text-muted-foreground">{eventTime(event, zone)}{appointment ? ' · DeskRoute booking' : ''}</p>
                        {source && <p className="mt-1 break-words text-sm text-muted-foreground">{calendarSourceLabel(source)}</p>}
                      </div>
                      {appointment && appointment.endTime && Date.parse(appointment.endTime) <= now ? (
                        <Button variant="destructive" size="sm" className="ml-auto shrink-0" disabled={refresh.isPending || removeHistory.isPending} onClick={() => setDeleting(appointment)} aria-label={`Delete past ${appointment.service} appointment from calendar`}>
                          <Trash2 /> Delete
                        </Button>
                      ) : appointment && appointment.status !== 'cancelled' && (
                        <Button
                          variant="destructive"
                          size="sm"
                          className="ml-auto"
                          disabled={refresh.isPending || cancel.isPending} onClick={() => setCancelling(appointment)}
                        >
                          <Trash2 /> Cancel
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        <aside className="h-fit rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5" data-ground="card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">Upcoming appointments</h2>
              <p className="mt-1 text-sm text-muted-foreground">Upcoming and ongoing receptionist bookings.</p>
            </div>
            <CalendarDays className="size-5 text-primary" />
          </div>

          <div className="mt-4 divide-y divide-border">
            {appointmentsQuery.isLoading ? (
              Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="my-2 h-16" />)
            ) : appointmentsQuery.isError ? (
              <p className="py-3 text-sm text-destructive">Appointments could not be loaded. Try refreshing.</p>
            ) : upcoming.length === 0 ? (
              <div className="py-8 text-center">
                <CalendarDays className="mx-auto size-8 text-muted-foreground/60" />
                <p className="mt-2 text-sm text-muted-foreground">No upcoming appointments.</p>
              </div>
            ) : upcoming.map((appointment) => (
              <div key={appointment.id} className="group py-3 first:pt-0">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Clock3 className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{appointment.service}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{appointmentDateTime(appointment, zone)}</p>
                    <div className="mt-1.5 flex min-w-0 items-center gap-2">
                      <StatusBadge value={appointment.status} config={appointmentStatusConfig} />
                      <span className="truncate text-xs text-muted-foreground">
                        {appointment.callerName ?? (appointment.callerPhone ? formatPhone(appointment.callerPhone) : 'Name not given')}
                      </span>
                    </div>
                    {(appointment.bookingDetails ?? []).length > 0 && (
                      <dl className="mt-2 space-y-1 rounded-lg bg-muted/60 p-2 text-xs">
                        {appointment.bookingDetails.map((detail) => (
                          <div key={detail.question}>
                            <dt className="font-semibold text-foreground">{detail.question}</dt>
                            <dd className="text-muted-foreground">{detail.answer}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    aria-label={`Cancel ${appointment.service} appointment`}
                    title="Cancel appointment"
                    disabled={refresh.isPending || cancel.isPending} onClick={() => setCancelling(appointment)}
                  ><Trash2 /> Cancel</Button>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-card shadow-sm" data-ground="card" aria-label="Past appointments">
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <h2 className="text-base font-semibold text-foreground">Past appointments <span className="ml-2 text-sm text-muted-foreground">{past.length}</span></h2>
          <p className="mt-1 text-sm text-muted-foreground">Appointments move here after their end time. Deleting one also removes its linked provider event.</p>
        </div>
        <div className="divide-y divide-border px-4 sm:px-5">
          {appointmentsQuery.isLoading ? <Skeleton className="my-4 h-16" /> : appointmentsQuery.isError ? (
            <p className="py-4 text-sm text-destructive">Past appointments could not be loaded.</p>
          ) : past.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No past appointments yet.</p> : past.map(appointment => (
            <div key={appointment.id} className="flex flex-wrap items-center gap-3 py-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-success-subtle text-success"><CalendarCheck2 className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground">{appointment.service}</p>
                <p className="mt-1 text-sm text-muted-foreground">{appointmentDateTime(appointment, zone)} · {appointment.callerName ?? 'Name not given'}</p>
              </div>
              {appointment.status === 'confirmed' ? <span className="rounded-md bg-success-subtle px-2 py-1 text-sm font-medium text-success">Ended</span> : <StatusBadge value={appointment.status} config={appointmentStatusConfig} />}
              <Button variant="destructive" size="sm" disabled={refresh.isPending || removeHistory.isPending} onClick={() => setDeleting(appointment)} aria-label={`Delete past ${appointment.service} appointment`}><Trash2 /> Delete</Button>
            </div>
          ))}
        </div>
      </section>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={open => { if (!open) setDeleting(null) }}
        title="Delete this past appointment?"
        description={deleting ? `${deleting.service} will be permanently removed from DeskRoute history. Its linked calendar event will also be deleted.` : undefined}
        confirmLabel="Delete past appointment"
        variant="destructive"
        onConfirm={async () => { if (deleting) await removeHistory.mutateAsync(deleting) }}
      />

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => { if (!open) setCancelling(null) }}
        title="Cancel this appointment?"
        description={cancelling
          ? `${cancelling.service} will be removed from its calendar and marked cancelled here.`
          : undefined}
        confirmLabel="Cancel appointment"
        variant="destructive"
        onConfirm={async () => { if (cancelling) await cancel.mutateAsync(cancelling.id) }}
      />
    </PageContainer>
  )
}
