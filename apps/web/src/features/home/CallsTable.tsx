import { CallOutcome } from '../calls/CallOutcome'
import { RetellCallFacts } from '../calls/RetellCallFacts'
import { useEffect, useMemo, useRef } from 'react'
import type { CallListItem } from '@receptionist/shared'
import { Skeleton } from '@/components/ui/skeleton'
import { DataList, type Column } from '@/components/ui/data-list'
import { useCallsQuery } from '@/hooks/useCallsQuery'
import { useAgentZone } from '@/hooks/useAgentZone'
import { formatCaller, formatTime, formatDuration } from '@/lib/formatters'
import { callOutcomeConfig } from '@/lib/status-config'
import { groupByDay } from '@/lib/group-by-day'

// eslint-disable-next-line react-refresh/only-export-components -- Pure row-label contract is exported here for focused accessibility tests.
export function callRowLabel(call: CallListItem): string {
  if (call.provider !== 'retell') return call.summary || 'Call detail'
  return [call.summary || 'No summary', formatCaller(call.callerName, call.callerPhone),
    'Retell', call.providerStatus,
    call.transferStatus ? `Transfer: ${call.transferStatus}` : null,
    call.durationMs != null ? `${Math.round(call.durationMs / 1000)} s` : null,
    formatDuration(call.startedAt, call.endedAt),
    call.costCents != null ? `${call.costCents}¢` : null,
    call.outcome ? callOutcomeConfig[call.outcome].label : 'Unknown',
  ].filter(Boolean).join(' · ')
}

/** The group carries the date, so the column carries only the time. */
function columns(zone: string | undefined): Column<CallListItem>[] {
  return [
    {
      key: 'time',
      header: 'Time',
      width: '76px',
      cell: (c) => (
        <span className="text-muted-foreground tabular-nums">
          {formatTime(c.startedAt, zone)}
        </span>
      ),
    },
    {
      key: 'summary',
      header: 'Summary',
      width: 'minmax(0,1fr)',
      cell: (c) => <span><span>{c.summary || (c.provider === 'retell' ? 'No summary available' : 'Hung up during the greeting')}</span>{c.provider === 'retell' && <span className="ml-2"><RetellCallFacts call={c} /></span>}</span>,
    },
    {
      key: 'caller',
      header: 'Caller',
      width: '188px',
      hideUnder: 'sm',
      cell: (c) => (
        <span className="truncate text-muted-foreground tabular-nums">
          {formatCaller(c.callerName, c.callerPhone)}
        </span>
      ),
    },
    {
      key: 'length',
      header: 'Length',
      width: '64px',
      align: 'end',
      hideUnder: 'md',
      cell: (c) => (
        <span className="text-muted-foreground tabular-nums">
          {formatDuration(c.startedAt, c.endedAt) ?? ''}
        </span>
      ),
    },
    {
      key: 'outcome',
      header: 'Outcome',
      width: 'max-content',
      align: 'end',
      cell: (c) => <CallOutcome provider={c.provider} outcome={c.outcome} />,
    },
  ]
}

export function CallsTable({ compact = false, allowDetails = true }: { compact?: boolean; allowDetails?: boolean }) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const zone = useAgentZone()
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useCallsQuery()

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasNextPage) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !isFetchingNextPage) fetchNextPage()
      },
      { rootMargin: '200px' },
    )
    obs.observe(node)
    return () => obs.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const calls = useMemo(() => {
    const all = data?.pages.flat() ?? []
    return compact ? all.slice(0, 5) : all
  }, [compact, data])
  const groups = useMemo(() => groupByDay(calls, zone, (c) => c.startedAt), [calls, zone])

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    )
  }

  if (calls.length === 0) {
    return (
      <p className="py-2 text-muted-foreground">
        No calls yet. Ring your number and the first one lands here.
      </p>
    )
  }

  return (
    <div>
      <DataList
        columns={columns(zone)}
        groups={groups}
        rowKey={(c) => c.id}
        {...(allowDetails ? {
          href: (c: CallListItem) => `/calls/${c.id}`,
          rowLabel: callRowLabel,
        } : {})}
      />
      {!compact && hasNextPage && (
        <div ref={sentinelRef} className="flex items-center justify-center py-3">
          {isFetchingNextPage && <Skeleton className="h-4 w-24" />}
        </div>
      )}
    </div>
  )
}
