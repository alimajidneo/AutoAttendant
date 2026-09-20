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
    if (!result) return
    const provider = params.get('provider') === 'microsoft' ? 'Microsoft' : 'Google'
    if (result === 'connected') toast.success(`${provider} account connected`)
    else toast.error(params.get('message') ?? `${provider} account could not be connected`)
    params.delete('calendar'); params.delete('provider'); params.delete('message')
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
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
    <PageHeader title="My employee setup" description="Connect your own calendar accounts without sharing credentials with a manager." />
    {!employee ? <section className="rounded-2xl border border-border bg-card p-5 shadow-low">
      <h2 className="font-semibold">Your account is not linked to an employee</h2>
      <p className="mt-2 text-sm text-muted-foreground">Ask a workspace manager to explicitly link your dashboard member to your employee record.</p>
    </section> : <section className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-low">
      <div><p className="text-sm text-muted-foreground">Employee</p><h2 className="text-lg font-semibold">{employee.displayName}</h2></div>
      <div className="grid gap-3 border-t border-border/60 pt-4">
        <div><h3 className="font-semibold">Google and Microsoft calendars</h3><p className="text-sm text-muted-foreground">Connect only accounts you own. A manager chooses which connected calendars control bookings and conflicts.</p></div>
        {directCalendars.connections.map(item => <div key={item.id} className="rounded-xl bg-sunk-1 p-3">
          <p className="font-medium">{item.accountEmail}</p>
          <p className="text-sm text-muted-foreground">{item.provider === 'google' ? 'Google' : 'Microsoft'} connected</p>
        </div>)}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !directCalendars.providers.google} onClick={() => void connectDirect('google')}><CalendarCheck />Connect Google</Button>
          <Button variant="outline" disabled={busy || !directCalendars.providers.microsoft} onClick={() => void connectDirect('microsoft')}><CalendarCheck />Connect Microsoft</Button>
        </div>
        {!directCalendars.providers.google && !directCalendars.providers.microsoft && <p className="text-sm text-muted-foreground">Google and Microsoft Calendar connections are not configured on this server.</p>}
      </div>
      <div className="grid gap-3 border-t border-border/60 pt-4"><h3 className="font-semibold">Cal.com</h3>
      {!configured ? <p className="rounded-xl bg-warning-subtle p-3 text-sm">Cal.com employee OAuth is not configured on this server. Ask the operator to add the approved hosted OAuth client settings.</p>
      : !connection ? <div className="grid gap-3"><p className="text-sm text-muted-foreground">Authorize the hosted Cal.com client. Cal.com currently shows READ_PROFILE and READ_BOOKING consent scopes; production automatic setup still requires Cal.com confirmation during client review.</p><Button disabled={busy} onClick={() => void connect()}><CalendarCheck />Connect Cal.com</Button></div>
      : connection.authKind === 'api_key' ? <div className="grid gap-3"><div className="rounded-xl bg-sunk-1 p-4"><p className="font-semibold">Legacy manager connection</p><p className="mt-1 text-sm text-muted-foreground">{connection.accountEmail}</p></div><p className="text-sm text-muted-foreground">A workspace owner configured the legacy API-key flow. You can replace it by authorizing your own hosted OAuth connection.</p><Button disabled={busy} onClick={() => void connect()}><CalendarCheck />Connect Cal.com with OAuth</Button></div>
      : <div className="grid gap-3">
        <div className="rounded-xl bg-sunk-1 p-4"><p className="font-semibold">{connection.ready ? 'Ready' : connection.status === 'reconnect_required' ? 'Reconnect required' : 'Setup required'}</p><p className="mt-1 text-sm text-muted-foreground">{connection.accountEmail}{connection.eventTypeTitle ? ` · ${connection.eventTypeTitle}` : ''}</p></div>
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
