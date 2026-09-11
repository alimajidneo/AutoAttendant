import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Building2, CalendarDays, Route, Settings2, ShieldCheck, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageContainer } from '@/layout/PageContainer'
import { PageHeader } from '@/layout/PageHeader'
import { apiClient } from '@/lib/apiClient'
import { useAuth } from '@/features/auth/useAuth'
import { TransferInbox } from './TransferInbox'

type Workspace = { id: string; name: string; kind: 'personal' | 'team'; role: 'manager' | 'member'; ownerUserId: string; userId: string }
type Member = { userId: string; email: string; displayName: string; department: string; available: boolean; role: 'manager' | 'member' }

export function MemberHomePage() {
  const { user } = useAuth()
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: () => apiClient.get<Workspace[]>('/workspaces').then(r => r.data) })
  const selectedId = sessionStorage.getItem('deskroute.workspace')
  const workspace = workspaces.data?.find(item => item.id === selectedId) ?? workspaces.data?.[0]
  const members = useQuery({
    queryKey: ['workspace-members', workspace?.id],
    queryFn: () => apiClient.get<Member[]>(`/workspaces/${workspace!.id}/members`).then(r => r.data),
    enabled: !!workspace,
  })
  const self = members.data?.find(member => member.userId === user?.id)

  return <PageContainer className="pb-10">
    <PageHeader
      title={workspace ? workspace.name : 'Your workspace'}
      description="Your private team home for call routing, availability and workspace access."
      actions={<Button render={<Link to="/workspaces" />}><Settings2 />Manage workspace</Button>}
    />

    <div className="mt-7 grid gap-4 sm:grid-cols-3">
      <article className="rounded-2xl border border-border bg-card p-5 shadow-low">
        <Building2 className="size-5 text-primary" />
        <p className="mt-4 text-sm text-muted-foreground">Your access</p>
        <p className="mt-1 text-xl font-bold capitalize">{workspace?.role ?? 'Member'}</p>
      </article>
      <article className="rounded-2xl border border-border bg-card p-5 shadow-low">
        <Users className="size-5 text-primary" />
        <p className="mt-4 text-sm text-muted-foreground">Team members</p>
        <p className="mt-1 text-xl font-bold">{members.data?.length ?? '—'}</p>
      </article>
      <article className="rounded-2xl border border-border bg-card p-5 shadow-low">
        <Route className="size-5 text-primary" />
        <p className="mt-4 text-sm text-muted-foreground">Your transfer status</p>
        <p className="mt-1 text-xl font-bold">{self?.available ? 'Available' : 'Unavailable'}</p>
      </article>
    </div>

    <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.75fr)]">
      <TransferInbox />
      <section className="rounded-2xl border border-border bg-card p-5 shadow-low">
        <h2 className="text-lg font-semibold">Workspace access</h2>
        <div className="mt-4 grid gap-3 text-sm">
          <p className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />Managers handle shared business records. Your personal calendar details remain private.</p>
          <p className="flex items-start gap-2"><CalendarDays className="mt-0.5 size-4 shrink-0 text-primary" />Employee calendar sharing is the next workspace feature and requires your explicit permission.</p>
        </div>
        <Button className="mt-5" variant="outline" render={<Link to="/help?guide=workspaces" />}>Open workspace tutorial</Button>
      </section>
    </div>
  </PageContainer>
}
