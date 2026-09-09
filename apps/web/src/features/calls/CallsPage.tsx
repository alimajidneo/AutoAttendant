import { PageContainer } from '@/layout/PageContainer'
import { PageHeader } from '@/layout/PageHeader'
import { CallsTable } from '@/features/home/CallsTable'

export default function CallsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Calls"
        description="Every conversation handled by your receptionist."
      />
      <div className="overflow-hidden rounded-2xl border border-border bg-card p-3 shadow-sm" data-ground="card">
        <CallsTable />
      </div>
    </PageContainer>
  )
}
