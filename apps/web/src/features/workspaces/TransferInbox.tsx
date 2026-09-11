import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LiveKitRoom, RoomAudioRenderer, useConnectionState, useParticipants } from '@livekit/components-react'
import { ConnectionState } from 'livekit-client'
import { PhoneOff, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { apiClient } from '@/lib/apiClient'
import type { TestSessionData } from '@/features/home/LiveControl'

type Transfer = { id: string; expiresAt: string }

function message(error: unknown) {
  const value = error as { response?: { data?: { error?: unknown } } }
  return typeof value.response?.data?.error === 'string' ? value.response.data.error : 'Could not respond. Please try again.'
}

function TransferStatus() {
  const state = useConnectionState()
  const participants = useParticipants()
  return <p className="text-sm">{state !== ConnectionState.Connected ? 'Connecting microphone…' : participants.some(item => item.identity.startsWith('admin-')) ? 'Connected. You can speak with the caller.' : 'The caller has left. End this test.'}</p>
}

export function TransferInbox({ compact = false }: { compact?: boolean }) {
  const [session, setSession] = useState<TestSessionData | null>(null)
  const [busy, setBusy] = useState(false)
  const inbox = useQuery({ queryKey: ['transfers'], queryFn: () => apiClient.get<Transfer[]>('/transfers').then(r => r.data), enabled: false })

  async function respond(id: string, accept: boolean) {
    setBusy(true)
    try {
      const result = await apiClient.post<TestSessionData>(`/transfers/${id}/respond`, { accept })
      if (accept) setSession(result.data)
      await inbox.refetch()
    } catch (error) {
      toast.error(message(error))
    } finally {
      setBusy(false)
    }
  }

  return <section className={compact ? '' : 'rounded-2xl border border-border bg-card p-5 shadow-low'}>
    <h2 className="text-lg font-semibold">Incoming transfers</h2>
    <p className="mt-2 text-sm text-muted-foreground">When the receptionist asks for you, check here and respond within 90 seconds. Use headphones before connecting your microphone.</p>
    {session ? <LiveKitRoom serverUrl={session.serverUrl} token={session.token} connect audio video={false} onDisconnected={() => setSession(null)} onError={error => { toast.error(error.message); setSession(null) }} className="mt-4 grid gap-3">
      <RoomAudioRenderer />
      <TransferStatus />
      <Button onClick={() => setSession(null)}><PhoneOff />End transfer test</Button>
    </LiveKitRoom> : <>
      <Button className="mt-4" variant="outline" disabled={inbox.isFetching} onClick={() => void inbox.refetch()}>
        <RefreshCw className={inbox.isFetching ? 'animate-spin' : ''} />
        Check incoming transfers
      </Button>
      {inbox.isError && <p className="mt-3 text-sm text-destructive">Unable to check requests. Retry.</p>}
      {inbox.data?.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No pending transfer requests.</p>}
      {inbox.data?.map(item => <div key={item.id} className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-sunk-1 p-3">
        <span className="text-sm">Incoming test call</span>
        <Button disabled={busy} onClick={() => void respond(item.id, true)}>Accept & connect microphone</Button>
        <Button disabled={busy} variant="ghost" onClick={() => void respond(item.id, false)}>Decline</Button>
      </div>)}
    </>}
  </section>
}
