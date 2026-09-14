import type { CallListItem } from '@receptionist/shared'
import { StatusBadge } from '../../components/ui/status-badge'
import { callOutcomeConfig } from '../../lib/status-config'
export function CallOutcome({ provider, outcome }: Pick<CallListItem, 'provider' | 'outcome'>) {
  return provider === 'retell' && !outcome ? <span className="text-sm text-muted-foreground">Unknown</span> : <StatusBadge value={outcome} config={callOutcomeConfig} />
}
