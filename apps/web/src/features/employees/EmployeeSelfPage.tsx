import { useState } from 'react'
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
  return typeof candidate.response?.data?.error === 'string' ? candidate.response.data.error : 'Cal.com is unavailable. Try again or ask a manager.'
}

export default function EmployeeSelfPage() {
  const query = useQuery({ queryKey: keys.employeeSelf, queryFn: fetchers.employeeSelf })
  const [busy, setBusy] = useState(false)
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
  const { configured, employee, connection } = query.data
  return <PageContainer size="form">
    <PageHeader title="My employee setup" description="Connect your own Cal.com account without sharing credentials with a manager." />
    {!employee ? <section className="rounded-2xl border border-border bg-card p-5 shadow-low">
      <h2 className="font-semibold">Your account is not linked to an employee</h2>
      <p className="mt-2 text-sm text-muted-foreground">Ask a workspace manager to explicitly link your dashboard member to your employee record.</p>
    </section> : <section className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-low">
      <div><p className="text-sm text-muted-foreground">Employee</p><h2 className="text-lg font-semibold">{employee.displayName}</h2></div>
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
    </section>}
  </PageContainer>
}
