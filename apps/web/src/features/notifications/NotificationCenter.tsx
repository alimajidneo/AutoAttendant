import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CalendarCheck2, CircleAlert, CheckCheck, RefreshCw, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { NotificationItem, NotificationReadInput } from '@receptionist/shared'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { LoadingIndicator } from '@/components/ui/loading-indicator'
import { keys, fetchers } from '@/lib/queries'
import { apiClient } from '@/lib/apiClient'
import { formatDateTime } from '@/lib/formatters'
import { useAgentZone } from '@/hooks/useAgentZone'
import { cn } from '@/lib/utils'

export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const zone = useAgentZone()
  const feed = useQuery({ queryKey: keys.notifications, queryFn: fetchers.notifications })
  const items = feed.data ?? []
  const unread = items.filter(item => !item.read)
  const markRead = useMutation({
    mutationFn: (items: NotificationReadInput[]) => apiClient.post('/admin/notifications/read', { items }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: keys.notifications }) },
    onError: () => toast.error('Could not save notification read status. Try again.'),
  })

  async function openItem(item: NotificationItem) {
    if (!item.read) {
      try { await markRead.mutateAsync([{ id: item.id, occurredAt: item.occurredAt }]) }
      catch { return }
    }
    setOpen(false)
    navigate(item.href)
  }

  return <>
    <Button variant="ghost" size="icon" className="relative rounded-full"
      aria-label={feed.isError ? 'Notifications unavailable. Open to retry' : `Notifications${unread.length ? `, ${unread.length} unread` : ''}`}
      onClick={() => { setOpen(true); void feed.refetch() }}>
      <Bell />
      {unread.length > 0 && <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-destructive px-1 text-sm font-semibold text-destructive-foreground">{unread.length}</span>}
      {feed.isError && <span className="absolute right-1 top-1 size-2 rounded-full bg-warning" />}
    </Button>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Notifications</SheetTitle>
          <SheetDescription>Your latest 50 updates from the last 30 days. Refreshes when you open this panel.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" disabled={feed.isFetching} onClick={() => void feed.refetch()}>
            <RefreshCw className={cn(feed.isFetching && 'animate-spin')} /> Refresh
          </Button>
          <Button variant="ghost" size="sm" disabled={!unread.length || markRead.isPending || feed.isFetching || feed.isError}
            onClick={() => markRead.mutate(unread.map(({ id, occurredAt }) => ({ id, occurredAt })))}>
            <CheckCheck /> Mark all read
          </Button>
        </div>
        {feed.isLoading ? <LoadingIndicator compact label="Loading notifications" /> : feed.isError ? (
          <p role="alert" className="rounded-xl bg-destructive-subtle p-4 text-destructive">Could not load notifications. Use Refresh to try again.</p>
        ) : items.length === 0 ? <p className="py-3 text-muted-foreground">No notifications yet. New bookings, cancellations, questions and call errors will appear here.</p> : (
          <ul className="space-y-2" aria-label="Recent notifications">
            {items.map(item => {
              const Icon = item.kind === 'question' ? MessageCircle : item.kind === 'call-error' || item.kind === 'cancellation' ? CircleAlert : CalendarCheck2
              return <li key={item.id}>
                <button type="button" disabled={markRead.isPending} onClick={() => void openItem(item)}
                  className={cn('flex w-full gap-3 rounded-xl border border-border p-4 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60', !item.read && 'bg-primary-subtle')}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-subtle text-accent-ink"><Icon className="size-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 font-semibold text-foreground">{item.title}{!item.read && <span className="text-sm text-accent-ink">Unread</span>}</span>
                    <span className="mt-1 block break-words text-sm text-foreground">{item.description}</span>
                    <span className="mt-2 block text-sm text-muted-foreground">{formatDateTime(item.occurredAt, zone)}</span>
                  </span>
                </button>
              </li>
            })}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  </>
}
