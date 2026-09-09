import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Calendar, Phone, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CalendarOption } from '@receptionist/shared'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LoadingIndicator } from '@/components/ui/loading-indicator'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { apiClient } from '@/lib/apiClient'
import { keys, fetchers } from '@/lib/queries'
import { formatPhone } from '@/lib/formatters'
import type { AppSettings } from '@/lib/settings-types'
import { cn } from '@/lib/utils'
import { Section, SubRow, MEASURE } from './SettingsList'

type Open = 'phone' | 'calendar' | null

function ConnectionRow({
  icon: Icon,
  title,
  description,
  connected,
  onOpen,
  actionLabel,
}: {
  icon: typeof Phone
  title: string
  description: string
  connected: boolean
  onOpen: () => void
  actionLabel: string
}) {
  return (
    <li className="flex items-center justify-between gap-5 border-t border-border/60 p-4 first:border-t-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sunk-1 text-secondary-foreground">
          <Icon className="size-[17px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className="font-medium text-foreground">{title}</p>
          <p className={cn(MEASURE, 'text-muted-foreground')}>{description}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3.5">
        {connected && <span className="font-medium text-foreground">Connected</span>}
        <Button variant="outline" size="sm" onClick={onOpen}>
          {actionLabel}
        </Button>
      </div>
    </li>
  )
}

export function ConnectionsPanel({ settings }: { settings: AppSettings }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState<Open>(null)
  const initialBookingKey = settings.business.calendarPayload?.bookingConnectionId && settings.business.calendarExternalId
    ? `${settings.business.calendarPayload.bookingConnectionId}\u0000${settings.business.calendarExternalId}` : null
  const [choice, setChoice] = useState<string | null>(null)
  const savedConflictChoices = settings.business.calendarPayload?.conflictCalendars?.flatMap(calendar =>
    calendar.connectionId ? [`${calendar.connectionId}\u0000${calendar.id}`] : []) ?? []
  const [conflictDraft, setConflictChoices] = useState<string[] | null>(null)
  const conflictChoices = conflictDraft ?? savedConflictChoices
  const [granting, setGranting] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('calendar')
    if (!result && params.get('manageCalendars') !== '1') return
    setOpen('calendar')
    if (result === 'connected') toast.success('Account connected. Select its calendars below and save to include their events.')
    else if (result) toast.error(params.get('message') ?? 'Google account could not be connected')
    params.delete('manageCalendars')
    params.delete('calendar')
    params.delete('message')
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
    void qc.invalidateQueries({ queryKey: keys.calendarList })
  }, [qc])

  const phone = settings.business.phoneNumber
  const calendarId = settings.business.calendarExternalId
  const calendarName = settings.business.calendarPayload?.summary
  const conflictCalendarCount = calendarId
    ? Math.max(1, settings.business.calendarPayload?.conflictCalendars?.length ?? 0)
    : 0

  /* Only reaches Google while the drawer is open. A connected agent reads the
     calendar's name from what is stored. */
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: keys.calendarList,
    queryFn: fetchers.calendarList,
    enabled: open === 'calendar',
    staleTime: 0,
  })

  const selectCalendar = useMutation({
    mutationFn: (calendar: CalendarOption) =>
      apiClient.patch('/admin/calendar', {
        booking: { connectionId: calendar.connectionId, calendarId: calendar.id },
        conflicts: [...new Set([...conflictChoices, `${calendar.connectionId}\u0000${calendar.id}`])]
          .map(value => {
            const [connectionId, calendarId] = value.split('\u0000')
            return { connectionId, calendarId }
          }),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.settings })
      await qc.invalidateQueries({ queryKey: keys.appointments })
      setChoice(null)
      setConflictChoices(null)
      toast.success('Calendar settings saved')
    },
    onError: () => toast.error('Could not save that calendar. Try again.'),
  })

  const disconnect = useMutation({
    mutationFn: (connectionId: string) => apiClient.delete(`/admin/calendar/${connectionId}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.settings })
      await qc.invalidateQueries({ queryKey: keys.calendarList })
      await qc.invalidateQueries({ queryKey: keys.appointments })
      setChoice(null)
      setConflictChoices(null)
      setConfirmDisconnect(null)
      toast.success('Google account disconnected')
    },
    onError: () => toast.error('Could not disconnect. Try again.'),
  })

  async function grantAccess() {
    setGranting(true)
    try {
      const { data } = await apiClient.get<{ url: string }>('/admin/calendar/oauth/start', { withCredentials: true })
      window.location.assign(data.url)
    }
    catch { toast.error('Could not open Google. Try again.'); setGranting(false) }
  }

  const calendars = data?.calendars ?? []
  const connections = data?.connections ?? []
  const activeBookingKey = choice ?? initialBookingKey
  const calendarKey = (calendar: Pick<CalendarOption, 'connectionId' | 'id'>) => `${calendar.connectionId}\u0000${calendar.id}`
  const selected = calendars.find(calendar => calendarKey(calendar) === activeBookingKey)

  function toggleConflictCalendar(id: string, checked: boolean) {
    if (id === activeBookingKey && !checked) return
    setConflictChoices((current) => checked
      ? [...new Set([...(current ?? savedConflictChoices), id])]
      : (current ?? savedConflictChoices).filter((calendarId) => calendarId !== id))
  }

  return (
    <div>
      <Section
        title="Connections"
        lede="What your agent is connected to."
      >
        <ConnectionRow
          icon={Phone}
          title="Phone number"
          description={
            phone
              ? 'The number your customers call.'
              : 'Not set up yet.'
          }
          connected={!!phone}
          onOpen={() => setOpen('phone')}
          actionLabel="Manage"
        />
        <ConnectionRow
          icon={Calendar}
          title="Google Calendar"
          description={
            calendarId
              ? `${conflictCalendarCount} checked for conflicts; appointments go to ${calendarName ?? 'the booking calendar'}.`
              : 'Connect one so your agent can check times and book.'
          }
          connected={!!calendarId}
          onOpen={() => setOpen('calendar')}
          actionLabel={calendarId ? 'Manage' : 'Connect'}
        />
      </Section>

      <Sheet open={open === 'phone'} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Phone number</SheetTitle>
            <SheetDescription className="tabular-nums">
              {phone ? formatPhone(phone) : 'Not provisioned yet'}
            </SheetDescription>
          </SheetHeader>
          <div>
            <SubRow
              title="Your agent answers this number"
              description="Every call to this number reaches your agent."
            >
              <Switch checked={!!phone} disabled aria-label="Your agent answers this number" />
            </SubRow>
            <SubRow
              title="Transfer to a human"
              description="Passes a live call to a number you choose."
            >
              <Button variant="outline" size="sm" disabled>
                Not available yet
              </Button>
            </SubRow>
            <SubRow
              title="Text confirmations"
              description="A message after a booking, and a reminder the day before."
            >
              <Button variant="outline" size="sm" disabled>
                Not available yet
              </Button>
            </SubRow>
            <p className="mt-4 rounded-lg bg-sunk-1 p-3 text-muted-foreground">
              Transfer and texts both need the carrier upgrade, and texts also need carrier
              registration, which takes a few weeks.
            </p>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={open === 'calendar'} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Google Calendar</SheetTitle>
            <SheetDescription>
              {calendarId
                ? `Writing to ${calendarName ?? calendarId}`
                : 'Not connected'}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-3">
            {isLoading ? (
              <LoadingIndicator compact label="Loading Google calendars" />
            ) : isError ? (
              <div className="space-y-3">
                <p role="alert" className="text-destructive">Could not load your Google accounts. Try again.</p>
                <Button variant="outline" onClick={() => void refetch()}>Retry</Button>
              </div>
            ) : !data?.connected ? (
              <>
                <p className="text-muted-foreground">
                  Give your agent access to Google Calendar, then pick which calendar holds your
                  appointments.
                </p>
                <Button onClick={grantAccess} disabled={granting} className="self-start">
                  <Calendar />
                  {granting ? 'Opening Google' : 'Connect Google Calendar'}
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">Connected Google accounts</p>
                      <p className="text-sm text-muted-foreground">Connecting an account does not select all its calendars. Choose which ones appear on your appointments page below.</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={grantAccess} disabled={granting}>
                      <Plus className="size-4" /> {granting ? 'Opening Google' : 'Connect account'}
                    </Button>
                  </div>
                  <div className="space-y-1 rounded-xl border border-border p-2">
                    {connections.map(connection => (
                      <div key={connection.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{connection.accountEmail}</p>
                          <p className="text-xs text-muted-foreground">
                            {connection.reconnectRequired ? 'Permission expired — reconnect this account'
                              : `${new Set([...savedConflictChoices, ...(initialBookingKey ? [initialBookingKey] : [])].filter(key => key.startsWith(`${connection.id}\u0000`))).size} calendars included on your appointments page`}
                          </p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => setConfirmDisconnect(connection.id)} aria-label={`Disconnect ${connection.accountEmail}`}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                {calendars.length === 0 ? (
                  <p className="rounded-lg bg-sunk-1 p-3 text-sm text-muted-foreground">Reconnect the account or create a Google Calendar, then check again.</p>
                ) : <>
                <SubRow
                  title="Booking calendar"
                  description="Where your agent writes appointments."
                >
                  <Select value={activeBookingKey ?? ''} onValueChange={(v) => setChoice(v ?? null)}>
                    <SelectTrigger className="w-field-md">
                      {/* Base UI renders the value rather than the label without
                          this. A calendar id is not a name. */}
                      <SelectValue placeholder="Pick a calendar">
                        {(value) =>
                          calendars.find(c => calendarKey(c) === value)?.summary ?? 'Pick a calendar'
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {calendars.filter((calendar) => calendar.writable).map((cal) => (
                        <SelectItem key={calendarKey(cal)} value={calendarKey(cal)}>
                          {cal.summary} · {cal.accountEmail}
                          {cal.primary ? ' (main)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SubRow>
                <div className="border-t border-border/60 py-3">
                  <div className="mb-2">
                    <p className="font-medium text-foreground">Calendars that block free time</p>
                    <p className="text-sm text-muted-foreground">Selected calendars appear on your appointments page and are checked before offering a time. Turn on calendars from your second account, then save below.</p>
                  </div>
                  <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
                    {calendars.map((calendar) => {
                      const id = calendarKey(calendar)
                      const checked = conflictChoices.includes(id) || id === activeBookingKey
                      return (
                        <label htmlFor={`conflict-calendar-${encodeURIComponent(id)}`} key={id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-hover">
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">{calendar.summary}</span>
                            <span className="block text-xs text-muted-foreground">
                              {id === activeBookingKey ? 'Booking destination' : `${calendar.accountEmail} · ${calendar.writable ? 'Can read and edit' : 'Availability only'}`}
                            </span>
                          </span>
                          <Switch
                            id={`conflict-calendar-${encodeURIComponent(id)}`}
                            checked={checked}
                            disabled={id === activeBookingKey}
                            onCheckedChange={(value) => toggleConflictCalendar(id, value)}
                            aria-label={`Include ${calendar.summary} from ${calendar.accountEmail}`}
                          />
                        </label>
                      )
                    })}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
                  <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: keys.calendarList })}>
                    Check again
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => selected && selectCalendar.mutate(selected)}
                    disabled={!selected || selectCalendar.isPending}
                  >
                    {selectCalendar.isPending ? 'Saving' : 'Save calendar settings'}
                  </Button>
                </div>
                </>}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!confirmDisconnect}
        onOpenChange={(open) => !open && setConfirmDisconnect(null)}
        title="Disconnect this Google account?"
        description="Its calendars stop blocking availability. If it holds the booking calendar, choose another booking calendar afterward. Existing appointments stay in Google Calendar."
        confirmLabel="Disconnect"
        variant="destructive"
        onConfirm={async () => {
          if (confirmDisconnect) await disconnect.mutateAsync(confirmDisconnect)
        }}
      />
    </div>
  )
}
