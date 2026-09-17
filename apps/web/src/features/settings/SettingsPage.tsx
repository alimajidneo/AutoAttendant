import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@/components/ui/skeleton'
import { FilterPills } from '@/components/ui/filter-pills'
import { PageContainer } from '@/layout/PageContainer'
import { PageHeader } from '@/layout/PageHeader'
import { keys, fetchers } from '@/lib/queries'
import { BusinessPanel } from './BusinessPanel'
import { HoursPanel } from './HoursPanel'
import { AgentPanel } from './AgentPanel'
import { ConnectionsPanel } from './ConnectionsPanel'
import { HolidaysPanel } from './HolidaysPanel'
import { EmployeesPanel } from '../employees/EmployeesPanel'
import { RetellPanel } from './RetellPanel'
import { AccountPanel } from './AccountPanel'

const PANELS = [
  { id: 'business', label: 'Business' },
  { id: 'hours', label: 'Hours' },
  { id: 'agent', label: 'Agent' },
  { id: 'connections', label: 'Connections' },
  { id: 'employees', label: 'Employees' },
  { id: 'retell', label: 'Retell' },
  { id: 'account', label: 'Account' },
] as const

type PanelId = (typeof PANELS)[number]['id']

function isPanelId(v: string | null): v is PanelId {
  return PANELS.some((p) => p.id === v)
}

export default function SettingsPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const panel: PanelId = isPanelId(raw) ? raw : 'business'

  function setPanel(next: PanelId) {
    const p = new URLSearchParams(params)
    p.set('tab', next)
    setParams(p, { replace: true })
  }

  const { data: session } = useQuery({ queryKey: keys.session, queryFn: fetchers.session })
  const { data: settings, isLoading } = useQuery({
    queryKey: keys.settings,
    queryFn: fetchers.settings,
  })

  return (
    <PageContainer size="form">
      <PageHeader
        title="Settings"
        description="How your agent introduces the business, when it offers times, and what it is connected to."
      />

      <FilterPills
        options={PANELS}
        value={panel}
        onChange={setPanel}
        label="Settings section"
        className="mb-7"
      />

      {panel === 'account' ? (
        <AccountPanel />
      ) : panel === 'retell' ? (
        <RetellPanel />
      ) : panel === 'employees' ? (
        <EmployeesPanel />
      ) : isLoading || !settings ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : panel === 'business' ? (
        <BusinessPanel settings={settings} />
      ) : panel === 'hours' ? (
        <HoursPanel settings={settings} />
      ) : panel === 'agent' ? (
        <AgentPanel settings={settings} />
      ) : (
        <>
          {session?.workspaceOwner
            ? <ConnectionsPanel settings={settings} />
            : <p className="text-sm text-muted-foreground">The workspace owner manages calendar connections. Personal calendar details are private.</p>}
          <HolidaysPanel settings={settings} />
        </>
      )}
    </PageContainer>
  )
}
