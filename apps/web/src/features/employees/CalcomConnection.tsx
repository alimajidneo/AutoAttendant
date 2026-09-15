import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { keys, fetchers } from '../../lib/queries'
import { apiClient } from '../../lib/apiClient'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
type Connection = { id: string; employeeId: string; authKind: 'api_key' | 'oauth'; accountEmail: string; displayLabel: string; status: string; ready: boolean }
type EventType = { id: number; title: string; lengthInMinutes: number }
export function CalcomConnection({ employeeId, refresh }: { employeeId: string; refresh: () => Promise<void> }) {
 const { data: session } = useQuery({ queryKey: keys.session, queryFn: fetchers.session })
 const manager = session?.role === 'manager'
 const owner = session?.workspaceOwner === true
 const id = useId()
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const [events, setEvents] = useState<EventType[] | null>(null)
 const [selected, setSelected] = useState('')
 const connections = useQuery({ queryKey: ['calcom-connections'], enabled: manager, queryFn: () => apiClient.get<Connection[]>('/admin/calcom').then(r => r.data) })
 const connection = connections.data?.find(item => item.employeeId === employeeId)
 async function run(action: () => Promise<void>) {
  setBusy(true); setError('')
  try { await action() } catch { setError('Cal.com unavailable. Check the employee connection and unresolved appointments before retrying.') } finally { setBusy(false) }
 }
 async function connect(form: HTMLFormElement) {
  const apiKey = String(new FormData(form).get('apiKey') ?? '')
  form.reset()
  await run(async () => { await apiClient.post(`/admin/calcom/${employeeId}/connect`, { apiKey }); await connections.refetch(); await refresh() })
 }
 if (!manager) return null
 if (!owner) return <div className="grid gap-3 border-t border-border pt-4"><h3 className="font-semibold">Cal.com employee connection</h3>{connections.isError ? <p role="alert">Could not load Cal.com readiness.</p> : connection ? <p className="text-sm">{connection.displayLabel} · {connection.accountEmail} · {connection.ready ? 'ready' : connection.status}</p> : <p className="text-sm text-muted-foreground">Not connected. Link the employee to a workspace member for self-service OAuth.</p>}<p className="text-sm text-muted-foreground">Only the employee handles OAuth; legacy credentials remain owner-only.</p></div>
 return <div className="grid gap-3 border-t border-border pt-4">
  <h3 className="font-semibold">Cal.com employee connection</h3>
  <p className="text-sm text-muted-foreground">Link this employee to a workspace member so they can authorize hosted OAuth themselves. Managers see readiness but never credentials.</p>
  {connections.isError && <p role="alert">Could not load Cal.com connections.</p>}
  {connection && <p className="text-sm">{connection.displayLabel} · {connection.accountEmail} · {connection.ready ? 'ready' : connection.status}</p>}
  {connection?.authKind === 'oauth' ? <p className="text-sm text-muted-foreground">Employee-managed OAuth connection. The employee reconnects or retries setup from My employee setup.</p> : <>
  <p className="text-sm font-semibold">Legacy manager API-key flow only</p>
  <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void connect(event.currentTarget) }}>
   <label htmlFor={id} className="grid gap-1 text-sm">Legacy Cal.com API key<Input id={id} name="apiKey" type="password" required maxLength={4096} autoComplete="off" /></label>
   <Button disabled={busy || connections.isPending} type="submit">{connection ? 'Reconnect legacy Cal.com' : 'Connect legacy Cal.com'}</Button>
  </form>
  {connection && <>
   <Button disabled={busy} variant="outline" onClick={() => void run(async () => { setEvents(null); const result = await apiClient.get<EventType[]>(`/admin/calcom/${employeeId}/${connection.id}/event-types`); setEvents(result.data) })}>Refresh Cal.com event types</Button>
   {events && <><label className="grid gap-1 text-sm">Cal.com event type<select disabled={busy} className="rounded-lg border border-border bg-card p-2 text-sm" value={selected} onChange={event => setSelected(event.target.value)}><option value="">Select event type</option>{events.map(event => <option key={event.id} value={event.id}>{event.title} · {event.lengthInMinutes} minutes</option>)}</select></label>
   <Button disabled={busy || !selected} onClick={() => void run(async () => { await apiClient.post(`/admin/calcom/${employeeId}/${connection.id}/select`, { eventTypeId: Number(selected) }); await refresh() })}>Use selected Cal.com event type</Button></>}
   <Button disabled={busy} variant="outline" onClick={() => { if (window.confirm('Disconnect this employee’s Cal.com connection? Resolve existing appointments first.')) void run(async () => { await apiClient.delete(`/admin/calcom/${employeeId}/${connection.id}`); setEvents(null); await connections.refetch(); await refresh() }) }}>Disconnect Cal.com</Button>
  </>}</>}
  {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
 </div>
}
