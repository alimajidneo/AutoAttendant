import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Calendar, MessageSquareText, Phone, Plus, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CalendarOption, CalendarProvider, SlackAlertKind } from '@receptionist/shared'
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

type Open = 'phone' | 'calendar' | 'slack' | null

const alertOptions: Array<{ id: SlackAlertKind; label: string; description: string }> = [
  { id: 'booking', label: 'New bookings', description: 'An appointment was booked.' },
  { id: 'request', label: 'Requests', description: 'A booking needs manual confirmation.' },
  { id: 'cancellation', label: 'Cancellations', description: 'An appointment was cancelled.' },
  { id: 'question', label: 'Caller questions', description: 'A question needs a team answer.' },
  { id: 'call-error', label: 'Call errors', description: 'A call needs attention.' },
]

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
  const [granting, setGranting] = useState<CalendarProvider | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null)
  const [confirmSlackDisconnect, setConfirmSlackDisconnect] = useState(false)
  const [slackChannel, setSlackChannel] = useState<string | null>(null)
  const [slackAlerts, setSlackAlerts] = useState<SlackAlertKind[] | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('calendar')
    if (!result && params.get('manageCalendars') !== '1') return
    setOpen('calendar')
    const provider = params.get('provider') === 'microsoft' ? 'Microsoft' : 'Google'
    if (result === 'connected') toast.success(`${provider} account connected. Select its calendars below and save.`)
    else if (result) toast.error(params.get('message') ?? `${provider} account could not be connected`)
    params.delete('manageCalendars')
    params.delete('calendar')
    params.delete('message')
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
    void qc.invalidateQueries({ queryKey: keys.calendarList })
  }, [qc])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('slack')
    if (!result) return
    setOpen('slack')
    if (result === 'connected') toast.success('Slack connected. Choose a channel and alerts below.')
    else toast.error(params.get('message') ?? 'Slack could not be connected')
    params.delete('slack')
    params.delete('message')
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
    void qc.invalidateQueries({ queryKey: keys.slack })
    void qc.invalidateQueries({ queryKey: keys.settings })
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

  const slackQuery = useQuery({
    queryKey: keys.slack,
    queryFn: fetchers.slack,
    enabled: open === 'slack',
    staleTime: 0,
  })

  useEffect(() => {
    if (!slackQuery.data) return
    setSlackChannel(current => current ?? slackQuery.data.channelId)
    setSlackAlerts(current => current ?? slackQuery.data.alertKinds)
  }, [slackQuery.data])

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
      toast.success('Calendar account disconnected')
    },
    onError: () => toast.error('Could not disconnect. Try again.'),
  })

  async function grantAccess(provider: CalendarProvider) {
    setGranting(provider)
    try {
      const path = provider === 'google' ? '/admin/calendar/oauth/start' : '/admin/calendar/oauth/microsoft/start'
      const { data } = await apiClient.get<{ url: string }>(path, { withCredentials: true })
      window.location.assign(data.url)
    }
    catch { toast.error(`Could not open ${provider === 'google' ? 'Google' : 'Microsoft'}. Try again.`); setGranting(null) }
  }

  async function connectSlack() {
    try {
      const { data } = await apiClient.get<{ url: string }>('/admin/slack/oauth/start', { withCredentials: true })
      window.location.assign(data.url)
    } catch { toast.error('Could not open Slack. Try again.') }
  }

  const saveSlack = useMutation({
    mutationFn: () => apiClient.patch('/admin/slack', {
      channelId: slackChannel,
      alertKinds: slackAlerts ?? [],
    }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.slack })
      await qc.invalidateQueries({ queryKey: keys.settings })
      toast.success('Slack notification settings saved')
    },
    onError: () => toast.error('Could not save Slack settings. Invite DeskRoute to the channel and try again.'),
  })

  const testSlack = useMutation({
    mutationFn: () => apiClient.post('/admin/slack/test'),
    onSuccess: () => toast.success('Test message sent to Slack'),
    onError: () => toast.error('Could not send the test message.'),
  })

  const disconnectSlack = useMutation({
    mutationFn: () => apiClient.delete('/admin/slack'),
    onSuccess: async () => {
      setSlackChannel(null)
      setSlackAlerts(null)
      setConfirmSlackDisconnect(false)
      await qc.invalidateQueries({ queryKey: keys.slack })
      await qc.invalidateQueries({ queryKey: keys.settings })
      toast.success('Slack disconnected')
    },
    onError: () => toast.error('Could not disconnect Slack.'),
  })

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
          title="Calendars"
          description={
            calendarId
              ? `${conflictCalendarCount} checked for conflicts; appointments go to ${calendarName ?? 'the booking calendar'}.`
              : 'Connect one so your agent can check times and book.'
          }
          connected={!!calendarId}
          onOpen={() => setOpen('calendar')}
          actionLabel={calendarId ? 'Manage' : 'Connect'}
        />
        <ConnectionRow
          icon={MessageSquareText}
          title="Slack"
          description={settings.integrations.slack.connected
            ? `Connected to ${settings.integrations.slack.teamName}${settings.integrations.slack.channelName ? ` · #${settings.integrations.slack.channelName}` : ' · choose a channel'}.`
            : 'Notify your team about bookings and caller follow-ups.'}
          connected={settings.integrations.slack.connected}
          onOpen={() => setOpen('slack')}
          actionLabel={settings.integrations.slack.connected ? 'Manage' : 'Connect'}
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
            <SheetTitle>Calendars</SheetTitle>
            <SheetDescription>
              {calendarId
                ? `Writing to ${calendarName ?? calendarId}`
                : 'Not connected'}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-3">
            {isLoading ? (
              <LoadingIndicator compact label="Loading calendars" />
            ) : isError ? (
              <div className="space-y-3">
                <p role="alert" className="text-destructive">Could not load your calendar accounts. Try again.</p>
                <Button variant="outline" onClick={() => void refetch()}>Retry</Button>
              </div>
            ) : !data?.connected ? (
              <>
                <p className="text-muted-foreground">
                  Connect Google or Microsoft, then pick where appointments are saved and which calendars block free time.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void grantAccess('google')} disabled={granting !== null}>
                    <Calendar />
                    {granting === 'google' ? 'Opening Google' : 'Connect Google'}
                  </Button>
                  <Button variant="outline" onClick={() => void grantAccess('microsoft')} disabled={granting !== null}>
                    <Calendar />
                    {granting === 'microsoft' ? 'Opening Microsoft' : 'Connect Microsoft'}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">Connected calendar accounts</p>
                      <p className="text-sm text-muted-foreground">Connecting an account does not select all its calendars. Choose which ones appear on your appointments page below.</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => void grantAccess('google')} disabled={granting !== null}>
                        <Plus className="size-4" /> {granting === 'google' ? 'Opening Google' : 'Google'}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => void grantAccess('microsoft')} disabled={granting !== null}>
                        <Plus className="size-4" /> {granting === 'microsoft' ? 'Opening Microsoft' : 'Microsoft'}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1 rounded-xl border border-border p-2">
                    {connections.map(connection => (
                      <div key={connection.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{connection.accountEmail}</p>
                          <p className="text-sm text-muted-foreground">
                            {connection.provider === 'google' ? 'Google' : 'Microsoft'} · {' '}
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
                  <p className="rounded-lg bg-sunk-1 p-3 text-sm text-muted-foreground">Reconnect the account or create a calendar in Google or Outlook, then check again.</p>
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
                            <span className="block text-sm text-muted-foreground">
                              {id === activeBookingKey ? 'Booking destination' : `${calendar.provider === 'google' ? 'Google' : 'Microsoft'} · ${calendar.accountEmail} · ${calendar.writable ? 'Can read and edit' : 'Availability only'}`}
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

      <Sheet open={open === 'slack'} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Slack notifications</SheetTitle>
            <SheetDescription>
              {slackQuery.data?.connected
                ? `Connected to ${slackQuery.data.teamName}`
                : 'Connect one Slack workspace to this DeskRoute workspace.'}
            </SheetDescription>
          </SheetHeader>
          {slackQuery.isLoading ? (
            <LoadingIndicator compact label="Loading Slack" />
          ) : slackQuery.isError ? (
            <div className="space-y-3">
              <p role="alert" className="text-destructive">Could not load Slack. Try again.</p>
              <Button variant="outline" onClick={() => void slackQuery.refetch()}>Retry</Button>
            </div>
          ) : !slackQuery.data?.connected ? (
            <div className="space-y-3">
              <p className="text-muted-foreground">
                DeskRoute requests permission to post messages and see channels that the bot has joined. Caller names, numbers, recordings, and transcripts are not included in Slack alerts.
              </p>
              <Button onClick={() => void connectSlack()}>
                <MessageSquareText /> Connect Slack
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              <SubRow title="Notification channel" description="Invite the DeskRoute bot to a channel before selecting it.">
                <Select value={slackChannel ?? ''} onValueChange={(value) => setSlackChannel(value ?? null)}>
                  <SelectTrigger className="w-field-md">
                    <SelectValue placeholder="Choose a channel">
                      {value => {
                        const channel = slackQuery.data.channels.find(item => item.id === value)
                        return channel ? `#${channel.name}` : 'Choose a channel'
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {slackQuery.data.channels.map(channel => (
                      <SelectItem key={channel.id} value={channel.id}>
                        #{channel.name}{channel.private ? ' (private)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SubRow>
              {slackQuery.data.channels.length === 0 && (
                <p className="rounded-lg bg-sunk-1 p-3 text-sm text-muted-foreground">
                  No channels are available. In Slack, invite the DeskRoute app to a channel, then select Check again.
                </p>
              )}
              <div className="space-y-1 border-t border-border/60 pt-3">
                <p className="font-medium text-foreground">Send an alert when</p>
                {alertOptions.map(option => {
                  const checked = (slackAlerts ?? []).includes(option.id)
                  return (
                    <label htmlFor={`slack-alert-${option.id}`} key={option.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-hover">
                      <span>
                        <span className="block font-medium text-foreground">{option.label}</span>
                        <span className="block text-sm text-muted-foreground">{option.description}</span>
                      </span>
                      <Switch
                        id={`slack-alert-${option.id}`}
                        checked={checked}
                        onCheckedChange={value => setSlackAlerts(current => value
                          ? [...new Set([...(current ?? []), option.id])]
                          : (current ?? []).filter(id => id !== option.id))}
                        aria-label={`Notify Slack for ${option.label}`}
                      />
                    </label>
                  )
                })}
              </div>
              <div className="flex flex-wrap justify-between gap-2 border-t border-border/60 pt-3">
                <Button variant="destructive" size="sm" onClick={() => setConfirmSlackDisconnect(true)}>Disconnect</Button>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => void slackQuery.refetch()}>Check again</Button>
                  <Button variant="outline" size="sm" onClick={() => testSlack.mutate()} disabled={!slackQuery.data.channelId || testSlack.isPending}>
                    <Send className="size-4" /> Send test
                  </Button>
                  <Button size="sm" onClick={() => saveSlack.mutate()} disabled={!slackChannel || saveSlack.isPending}>
                    {saveSlack.isPending ? 'Saving' : 'Save'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!confirmDisconnect}
        onOpenChange={(open) => !open && setConfirmDisconnect(null)}
        title="Disconnect this calendar account?"
        description="Its calendars stop blocking availability. If it holds the booking calendar, choose another afterward. Existing appointments stay in the provider calendar."
        confirmLabel="Disconnect"
        variant="destructive"
        onConfirm={async () => {
          if (confirmDisconnect) await disconnect.mutateAsync(confirmDisconnect)
        }}
      />
      <ConfirmDialog
        open={confirmSlackDisconnect}
        onOpenChange={setConfirmSlackDisconnect}
        title="Disconnect Slack?"
        description="DeskRoute will stop sending notifications to this Slack workspace. You can reconnect it later."
        confirmLabel="Disconnect"
        variant="destructive"
        onConfirm={async () => { await disconnectSlack.mutateAsync() }}
      />
    </div>
  )
}
