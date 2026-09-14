import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { apiClient } from '@/lib/apiClient'

const STALE_PROVIDER_WRITE_MS = 24 * 60 * 60 * 1000

export function AppointmentWriteStatus({ id, state, updatedAt, canManage, calcom = false }: {
  id: string
  state: 'in_flight' | 'reconciliation_required'
  updatedAt: string
  canManage: boolean
  calcom?: boolean
}) {
  const [open, setOpen] = useState(false)
  const client = useQueryClient()
  const updated = Date.parse(updatedAt)
  const staleInFlight = state === 'in_flight' && Number.isFinite(updated) && Date.now() - updated > STALE_PROVIDER_WRITE_MS
  if (state === 'in_flight' && !staleInFlight) return <span className="text-sm text-muted-foreground">Booking in progress</span>
  return <div className="space-y-2">
    <p className="text-sm text-warning">{staleInFlight ? 'Booking stalled — provider check required' : 'Provider reconciliation required'}</p>
    {canManage && <>
      {calcom && <form className="grid gap-2" onSubmit={async event => {
        event.preventDefault()
        const form = event.currentTarget
        const bookingUid = String(new FormData(form).get('bookingUid') ?? '').trim()
        const submit = form.querySelector('button')
        if (submit) submit.disabled = true
        try {
          await apiClient.post(`/admin/appointments/${id}/reconcile-calcom`, bookingUid ? { bookingUid } : {})
          await client.invalidateQueries({ queryKey: ['appointments'] })
          toast.success('Cal.com booking state reconciled')
        } catch { toast.error('Could not reconcile. Check the original Cal.com booking UID and interval; do not retry booking.') }
        finally { if (submit) submit.disabled = false }
      }}>
        <label className="grid gap-1 text-sm">Booking UID (optional if received by webhook)<input name="bookingUid" maxLength={200} className="rounded-lg border border-border bg-card p-2" /></label>
        <Button type="submit" variant="outline" size="sm">Check Cal.com booking</Button>
      </form>}

      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>{staleInFlight ? 'Review stalled booking' : 'Review booking'}</Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Mark this booking as not created?"
        description="Check the employee's original provider calendar for this appointment first. Only proceed if no event exists. This releases the reserved time in DeskRoute."
        confirmLabel="I checked the provider calendar and no event exists"
        onConfirm={async () => {
          try {
            await apiClient.post(`/admin/appointments/${id}/reconcile-not-created`, { providerChecked: true })
            await client.invalidateQueries({ queryKey: ['appointments'] })
            toast.success('Booking marked not created; reservation released')
          } catch (error) {
            toast.error('Could not reconcile this booking. Refresh and check its current state.')
            throw error
          }
        }}
      />
    </>}
  </div>
}
