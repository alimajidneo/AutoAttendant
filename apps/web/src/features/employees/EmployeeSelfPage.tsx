import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarCheck, RefreshCw, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PageContainer } from '@/layout/PageContainer'
import { PageHeader } from '@/layout/PageHeader'
import { apiClient } from '@/lib/apiClient'
import { fetchers, keys } from '@/lib/queries'

function errorMessage(error: unknown) {
  const candidate = error as { response?: { data?: { error?: unknown } } }
  return typeof candidate.response?.data?.error === 'string' ? candidate.response.data.error : 'Calendar connection is unavailable. Try again or ask a manager.'
}

export default function EmployeeSelfPage() {
  const query = useQuery({ queryKey: keys.employeeSelf, queryFn: fetchers.employeeSelf })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('calendar')
    const calcomResult = params.get('calcom')
    if (!result && !calcomResult) return
    if (calcomResult) {
      if (calcomResult === 'connected') toast.success('Cal.com connected')
      else if (calcomResult === 'setup_required') toast.message('Choose a destination calendar in Cal.com, then retry setup.')
      else toast.error(params.get('message') ?? 'Cal.com could not be connected')
      params.delete('calcom'); params.delete('workspace')
    } else {
      const provider = params.get('provider') === 'microsoft' ? 'Microsoft' : 'Google'
      if (result === 'connected') toast.success(`${provider} account connected`)
      else toast.error(params.get('message') ?? `${provider} account could not be connected`)
      params.delete('calendar'); params.delete('provider')
    }
    params.delete('message')
    const search = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}`)
    void query.refetch()
  }, [query])
  async function connectDirect(provider: 'google' | 'microsoft') {
    setBusy(true)
    try {
      const { data } = await apiClient.get<{ url: string }>(`/admin/employee/calendar/oauth/${provider}/start`)
      window.location.assign(data.url)
    } catch (error) { toast.error(errorMessage(error)); setBusy(false) }
  }
  async function connect() {
    setBusy(true)
    try {
      const { data } = await apiClient.get<{ url: string }>('/admin/employee/calcom/oauth/start')
      window.location.assign(data.url)
    } catch (error) { toast.error(errorMessage(error)); setBusy(false) }
  }
  async function reconcile() {
    setBusy(true)
    try { await apiClient.post('/admin/employee/calcom/reconcile', {}); await query.refetch() }
    catch (error) { toast.error(errorMessage(error)) } finally { setBusy(false) }
  }
  async function disconnect() {
    if (!window.confirm('Disconnect your Cal.com account from this employee? Existing appointments must be resolved first.')) return
    setBusy(true)
    try { await apiClient.delete('/admin/employee/calcom'); await query.refetch(); toast.success('Cal.com disconnected') }
    catch (error) { toast.error(errorMessage(error)) } finally { setBusy(false) }
  }

  if (query.isPending) return <PageContainer><p>Loading employee setup…</p></PageContainer>
  if (query.isError || !query.data) return <PageContainer><p>Could not load employee setup. <Button variant="ghost" onClick={() => void query.refetch()}>Retry</Button></p></PageContainer>
  const { configured, employee, connection, directCalendars = { providers: { google: false, microsoft: false }, connections: [] } } = query.data
  return <PageContainer size="form">
    <PageHeader title="My employee setup" description="Your company workspace, profile, and private calendar connections." />
    {!employee ? <section className="rounded-2xl border border-border bg-card p-5 shadow-low">
      <h2 className="font-semibold">Your account is not linked to an employee</h2>
      <p className="mt-2 text-sm text-muted-foreground">You joined the company, but a manager must link your account to the correct employee record before you can connect a calendar.</p>
      <a className="mt-4 inline-block font-semibold text-primary hover:underline" href="/workspaces">View company members</a>
    </section> : <section className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-low">
      <div><p className="text-sm text-muted-foreground">Employee</p><h2 className="text-lg font-semibold">{employee.displayName}</h2><p className="text-sm text-muted-foreground">{employee.department || 'Department not set'}</p></div>
      <div className="rounded-xl bg-sunk-1 p-4 text-sm">
        <h3 className="font-semibold">Setup checklist</h3>
        <ol className="mt-2 grid gap-2">
          <li>✓ Joined company and linked to an employee record</li>
          <li>{directCalendars.connections.length || connection ? '✓' : '○'} Connect a calendar account you own</li>
          <li>{employee.bookingConfigured ? '✓ Booking destination configured' : '○ Manager must approve a booking destination'}</li>
        </ol>
        <p className="mt-3 font-medium">{employee.bookingConfigured ? 'Calendar setup configured' : 'Needs setup'}</p>
        <p className="mt-1 text-muted-foreground">Calendar setup does not by itself enable telephone routing or prove a live provider booking.</p>
        <a href="/workspaces" className="mt-2 inline-block font-semibold text-primary hover:underline">Review your workspace profile</a>
      </div>
      <details className="order-last grid gap-3 border-t border-border/60 pt-4">
        <summary className="cursor-pointer font-semibold">Direct Google and Microsoft connections</summary>
        <p className="text-sm text-muted-foreground">Use direct connections when your manager chooses that calendar authority. These use DeskRoute provider authorization.</p>
        {directCalendars.connections.map(item => <div key={item.id} className="rounded-xl bg-sunk-1 p-3">
          <p className="font-medium">{item.accountEmail}</p>
          <p className="text-sm text-muted-foreground">{item.provider === 'google' ? 'Google' : 'Microsoft'} connected</p>
        </div>)}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !directCalendars.providers.google} onClick={() => void connectDirect('google')}><CalendarCheck />Connect Google</Button>
          <Button variant="outline" disabled={busy || !directCalendars.providers.microsoft} onClick={() => void connectDirect('microsoft')}><CalendarCheck />Connect Microsoft</Button>
        </div>
        {!directCalendars.providers.google && !directCalendars.providers.microsoft && <p className="text-sm text-muted-foreground">Google and Microsoft Calendar connections are not configured on this server.</p>}
      </details>
      <div className="grid gap-3 border-t border-border/60 pt-4"><h3 className="font-semibold">Cal.com · one booking schedule</h3>
      <p className="text-sm text-muted-foreground">Connect your three Google and two Microsoft calendars inside Cal.com. Select all five to block busy times, then choose one writable destination for new bookings. DeskRoute checks Cal.com slots for this employee. A ready connection does not verify that all five conflict calendars were selected.</p>
      <ol className="grid gap-1 text-sm text-muted-foreground"><li>1. Connect and select all five calendars in Cal.com.</li><li>2. Choose the booking destination in Cal.com.</li><li>3. Connect Cal.com below and confirm it is ready.</li></ol>
      <a className="text-sm font-semibold text-primary hover:underline" href="https://app.cal.com/settings/my-account/calendars" target="_blank" rel="noopener noreferrer">Open Cal.com calendar settings</a>
      {connection?.authKind === 'api_key' ? <div className="grid gap-3"><div className="rounded-xl bg-sunk-1 p-4"><p className="font-semibold">{connection.ready && employee.bookingConfigured ? 'Ready for DeskRoute bookings' : 'Legacy manager connection'}</p><p className="mt-1 text-sm text-muted-foreground">{connection.accountEmail}</p></div><p className="text-sm text-muted-foreground">A workspace owner configured this Cal.com connection. The owner manages its event type and booking policy.</p>{configured && <Button disabled={busy} onClick={() => void connect()}><CalendarCheck />Connect Cal.com with OAuth</Button>}</div>
      : !configured ? <p className="rounded-xl bg-warning-subtle p-3 text-sm">Cal.com employee OAuth is not configured on this server. Ask the operator to add the approved hosted OAuth client settings.</p>
      : !connection ? <div className="grid gap-3"><p className="text-sm text-muted-foreground">Authorize DeskRoute in Cal.com to use your booking schedule.</p><Button disabled={busy} onClick={() => void connect()}><CalendarCheck />Connect Cal.com</Button></div>
      : <div className="grid gap-3">
        <div className="rounded-xl bg-sunk-1 p-4"><p className="font-semibold">{connection.ready ? employee.bookingConfigured ? 'Ready for DeskRoute bookings' : 'Cal.com ready; manager setup pending' : connection.status === 'reconnect_required' ? 'Reconnect required' : 'Setup required'}</p><p className="mt-1 text-sm text-muted-foreground">{connection.accountEmail}{connection.eventTypeTitle ? ` · ${connection.eventTypeTitle}` : ''}</p></div>
        {!connection.ready && <p className="text-sm text-muted-foreground">Connect or select your work calendar in Cal.com, then Retry setup. DeskRoute will not mark this connection ready without one confirmed booking destination.</p>}
        <div className="flex flex-wrap gap-2">
          {!connection.ready && <Button disabled={busy} onClick={() => void reconcile()}><RefreshCw />Retry setup</Button>}
          <Button variant="outline" disabled={busy} onClick={() => void connect()}>Reconnect Cal.com</Button>
          <Button variant="ghost" disabled={busy} onClick={() => void disconnect()}><Unplug />Disconnect</Button>
        </div>
      </div>}
      </div>
    </section>}
  </PageContainer>
}
