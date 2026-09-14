import type { CallListItem } from '@receptionist/shared'
type Facts = Pick<CallListItem, 'provider' | 'providerStatus' | 'transferStatus' | 'durationMs' | 'costCents'>
export function RetellCallFacts({ call }: { call: Facts }) {
  if (call.provider !== 'retell') return null
  return <span className="text-sm text-muted-foreground">{['Retell', call.providerStatus,
    call.transferStatus ? `Transfer: ${call.transferStatus}` : null,
    call.durationMs != null ? `${Math.round(call.durationMs / 1000)} s` : null,
    call.costCents != null ? `${call.costCents}¢` : null,
  ].filter(Boolean).join(' · ')}</span>
}
