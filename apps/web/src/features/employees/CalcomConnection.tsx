import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { keys, fetchers } from '../../lib/queries'
import { apiClient } from '../../lib/apiClient'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
type Connection = { id: string; employeeId: string; accountEmail: string; displayLabel: string; status: string }
type EventType = { id: number; title: string; lengthInMinutes: number }
export function CalcomConnection({ employeeId, refresh }: { employeeId: string; refresh: () => Promise<void> }) {
 const { data: session } = useQuery({ queryKey: keys.session, queryFn: fetchers.session })
 const owner = session?.workspaceOwner === true
 const id = useId()
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const [events, setEvents] = useState<EventType[] | null>(null)
 const [selected, setSelected] = useState('')
 const connections = useQuery({ queryKey: ['calcom-connections'], enabled: owner, queryFn: () => apiClient.get<Connection[]>('/admin/calcom').then(r => r.data) })
 const connection = connections.data?.find(item => item.employeeId === employeeId)
 async function run(action: () => Promise<void>) {
  setBusy(true); setError('')
  try { await action() } catch { setError('Cal.com unavailable. Check the key, employee account, and unresolved appointments before retrying.') } finally { setBusy(false) }
 }
 async function connect(form: HTMLFormElement) {
  const apiKey = String(new FormData(form).get('apiKey') ?? '')
  form.reset()
  await run(async () => { await apiClient.post(`/admin/calcom/${employeeId}/connect`, { apiKey }); await connections.refetch(); await refresh() })
 }
 if (!owner) return null
 return <div className="grid gap-3 border-t border-border pt-4">
  <h3 className="font-semibold">Cal.com employee connection</h3>
  <p className="text-sm text-muted-foreground">Connect only this employee’s Cal.com account with their consent. The company integration owner does not replace employee calendars. No Teams subscription is required.</p>
  {connections.isError && <p role="alert">Could not load Cal.com connections.</p>}
  {connection && <p className="text-sm">{connection.displayLabel} · {connection.accountEmail} · {connection.status}</p>}
  <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void connect(event.currentTarget) }}>
   <label htmlFor={id} className="grid gap-1 text-sm">Cal.com API key<Input id={id} name="apiKey" type="password" required maxLength={4096} autoComplete="off" /></label>
   <Button disabled={busy || connections.isPending} type="submit">{connection ? 'Reconnect Cal.com' : 'Connect Cal.com'}</Button>
  </form>
  {connection && <>
   <Button disabled={busy} variant="outline" onClick={() => void run(async () => { setEvents(null); const result = await apiClient.get<EventType[]>(`/admin/calcom/${employeeId}/${connection.id}/event-types`); setEvents(result.data) })}>Refresh Cal.com event types</Button>
   {events && <><label className="grid gap-1 text-sm">Cal.com event type<select disabled={busy} className="rounded-lg border border-border bg-card p-2 text-sm" value={selected} onChange={event => setSelected(event.target.value)}><option value="">Select event type</option>{events.map(event => <option key={event.id} value={event.id}>{event.title} · {event.lengthInMinutes} minutes</option>)}</select></label>
   <Button disabled={busy || !selected} onClick={() => void run(async () => { await apiClient.post(`/admin/calcom/${employeeId}/${connection.id}/select`, { eventTypeId: Number(selected) }); await refresh() })}>Use selected Cal.com event type</Button></>}
   <Button disabled={busy} variant="outline" onClick={() => { if (window.confirm('Disconnect this employee’s Cal.com connection? Resolve existing appointments first.')) void run(async () => { await apiClient.delete(`/admin/calcom/${employeeId}/${connection.id}`); setEvents(null); await connections.refetch(); await refresh() }) }}>Disconnect Cal.com</Button>
  </>}
  {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
 </div>
}
