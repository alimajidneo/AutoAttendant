import { PageContainer } from '@/layout/PageContainer'
import { PageHeader } from '@/layout/PageHeader'
import { CallsTable } from '@/features/home/CallsTable'
import { useQuery } from '@tanstack/react-query'
import { fetchers, keys } from '@/lib/queries'

export default function CallsPage() {
  const { data: session } = useQuery({ queryKey: keys.session, queryFn: fetchers.session, staleTime: Infinity })
  const memberOnly = session?.role === 'member'
  return (
    <PageContainer>
      <PageHeader
        title="Calls"
        description={memberOnly
          ? "Your workspace's recent call log. Managers control transcripts and recordings."
          : 'Every conversation handled by your receptionist.'}
      />
      <div className="overflow-hidden rounded-2xl border border-border bg-card p-3 shadow-sm" data-ground="card">
        <CallsTable allowDetails={!memberOnly} />
      </div>
    </PageContainer>
  )
}
