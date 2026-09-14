import { keys, fetchers } from '../../lib/queries'
import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '../../lib/apiClient'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
type Readiness = { retellAgentId: string; enabled: boolean; apiKeyConfigured: boolean; operatorApproved: boolean }
function RetellForm({ data, refresh }: { data: Readiness; refresh: () => Promise<unknown> }) {
  const fieldId = useId()
  const [busy, setBusy] = useState(false)
  async function save(form: HTMLFormElement) {
    const fields = new FormData(form)
    setBusy(true)
    try {
      await apiClient.put('/admin/retell', { retellAgentId: String(fields.get('retellAgentId')).trim(), enabled: fields.get('enabled') === 'on' })
      await refresh(); toast.success('Retell settings saved')
    } catch { toast.error('Pending operator approval. The workspace owner must arrange server configuration before enabling Retell.') }
    finally { setBusy(false) }
  }
  return <form className="grid gap-4 rounded-xl border border-border bg-card p-4" onSubmit={event => { event.preventDefault(); void save(event.currentTarget) }}>
    <h2 className="text-lg font-semibold">Retell</h2>
    <label htmlFor={fieldId} className="grid gap-1 text-sm">Retell agent ID<Input id={fieldId} name="retellAgentId" defaultValue={data.retellAgentId} required maxLength={200} pattern="[a-zA-Z0-9_\-]+" /></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={data.enabled} />Enable Retell</label>
    <p className="text-sm text-muted-foreground">{data.apiKeyConfigured ? 'API key is configured on the server.' : 'API key is not configured on the server.'}</p>
    <p className="text-sm text-muted-foreground">{data.operatorApproved ? 'Operator approved. This agent is ready to enable.' : 'Pending operator approval. The workspace owner may save an ID disabled while the operator configures the server allowlist.'}</p>
    <p className="text-sm text-muted-foreground">Message fallback: configure the signed save-message function with message and optional callerName/callerPhone. Set max_retry=0 for save-message and book-appointment.</p>
    <p className="text-sm text-muted-foreground">Saving does not purchase a number or place calls.</p>
    <Button type="submit" disabled={busy}>Save Retell settings</Button>
  </form>
}
export function RetellPanel() {
  const { data: session } = useQuery({ queryKey: keys.session, queryFn: fetchers.session })
  const manager = session?.role === 'manager'
  const query = useQuery({ enabled: manager, queryKey: ['retell-settings'], queryFn: () => apiClient.get<Readiness>('/admin/retell').then(response => response.data) })
  if (!manager) return <p className="text-sm text-muted-foreground">Manager access required.</p>
  if ((query.error as { response?: { status?: number } } | null)?.response?.status === 403) return <p className="text-sm text-muted-foreground">The workspace owner manages Retell connections. Ask the workspace owner to configure this integration.</p>
  if (!query.data) return <p className="text-sm text-muted-foreground">{query.isError ? 'Could not load Retell settings.' : 'Loading Retell settings…'}</p>
  return <RetellForm key={`${query.data.retellAgentId}:${query.data.enabled}`} data={query.data} refresh={query.refetch} />
}
