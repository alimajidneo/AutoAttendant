import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, UserRound, Users, ArrowRight, ShieldCheck, Home, Mail, CalendarDays, CircleCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiClient, openWorkspace } from '@/lib/apiClient'
import { useAuth } from '@/features/auth/useAuth'
import { keys, fetchers } from '@/lib/queries'
import { TransferInbox } from './TransferInbox'

type Workspace = { id: string; name: string; kind: 'personal' | 'team'; role: 'manager' | 'member'; ownerUserId: string; userId: string }
type Member = { userId: string; email: string; displayName: string; department: string; available: boolean; role: 'manager' | 'member' }
type Invite = { id: string; email: string; role: string; expiresAt: string }
const panel = 'rounded-2xl border border-border bg-card p-5 shadow-low'

function message(error: unknown) {
  const e = error as { response?: { data?: { error?: unknown } } }
  return typeof e.response?.data?.error === 'string' ? e.response.data.error : 'Could not save. Please try again.'
}

function MemberEditor({ member, workspace, refresh }: { member: Member; workspace: Workspace; refresh: () => void }) {
  const { user } = useAuth()
  const [name, setName] = useState(member.displayName)
  const [department, setDepartment] = useState(member.department)
  const [available, setAvailable] = useState(member.available)
  const [role, setRole] = useState(member.role)
  const [busy, setBusy] = useState(false)
  const self = user?.id === member.userId
  const owner = user?.id === workspace.ownerUserId
  const canEdit = self || workspace.role === 'manager'
  const canChangeRole = owner && member.userId !== workspace.ownerUserId
  async function save() {
    setBusy(true)
    try {
      await apiClient.patch(`/workspaces/${workspace.id}/members/${encodeURIComponent(member.userId)}`, {
        displayName: name, department, available, ...(canChangeRole ? { role } : {}),
      })
      refresh(); toast.success('Member settings saved')
    } catch (error) { toast.error(message(error)) } finally { setBusy(false) }
  }
  async function remove() {
    if (!window.confirm(`Remove ${member.displayName || 'this member'} from ${workspace.name}?`)) return
    setBusy(true)
    try { await apiClient.delete(`/workspaces/${workspace.id}/members/${encodeURIComponent(member.userId)}`); refresh() }
    catch (error) { toast.error(message(error)) } finally { setBusy(false) }
  }
  const label = member.displayName || member.email || 'Teammate'
  return <div className="grid gap-4 rounded-xl border border-border bg-card p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary">{label.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{self ? `${label} (you)` : label}</h3>
          <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground"><Mail className="size-4 shrink-0" />{member.email || 'Account email is private'}</p>
        </div>
      </div>
      <span className="rounded-full bg-sunk-1 px-2.5 py-1 text-sm font-semibold capitalize">{member.userId === workspace.ownerUserId ? 'Owner' : member.role}</span>
    </div>
    {canEdit ? <>
      <div className="grid gap-3 sm:grid-cols-2"><label htmlFor={`member-name-${member.userId}`} className="grid gap-1 text-sm">Name callers can ask for<Input id={`member-name-${member.userId}`} value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label><label htmlFor={`member-department-${member.userId}`} className="grid gap-1 text-sm">Department<Input id={`member-department-${member.userId}`} value={department} maxLength={80} onChange={e => setDepartment(e.target.value)} /></label></div>
      <label className="flex items-center gap-2 rounded-lg bg-sunk-1 p-3 text-sm font-medium"><input type="checkbox" checked={available} onChange={e => setAvailable(e.target.checked)} />Available for browser transfers</label>
      <div className="flex flex-wrap items-center gap-3">{canChangeRole && <label className="flex items-center gap-2 text-sm">Role<select className="rounded-lg border border-border bg-card p-2" value={role} onChange={e => setRole(e.target.value as Member['role'])}><option value="member">Member</option><option value="manager">Manager</option></select></label>}<Button disabled={busy || !name.trim()} onClick={() => void save()}>Save</Button>{canChangeRole && <Button variant="ghost" disabled={busy} onClick={() => void remove()}>Remove member</Button>}</div>
    </> : <p className="text-sm text-muted-foreground">{member.department || 'No department'} · {member.available ? 'Available for transfers' : 'Unavailable'}</p>}
  </div>
}

function WorkspaceDetails({ workspace }: { workspace: Workspace }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Member['role']>('member')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const owner = workspace.ownerUserId === user?.id
  const members = useQuery({ queryKey: ['workspace-members', workspace.id], queryFn: () => apiClient.get<Member[]>(`/workspaces/${workspace.id}/members`).then(r => r.data) })
  const invites = useQuery({ queryKey: ['workspace-invites', workspace.id], queryFn: () => apiClient.get<Invite[]>(`/workspaces/${workspace.id}/invites`).then(r => r.data), enabled: owner && workspace.kind === 'team' })
  const calendars = useQuery({ queryKey: keys.calendarList, queryFn: fetchers.calendarList, enabled: owner })
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['workspace-members', workspace.id] }) }
  async function invite() {
    setBusy(true); setCode('')
    try { const { data } = await apiClient.post<{ code: string }>(`/workspaces/${workspace.id}/invites`, { email, role }); setCode(data.code); setEmail(''); await invites.refetch() }
    catch (error) { toast.error(message(error)) } finally { setBusy(false) }
  }
  async function revoke(id: string) {
    setBusy(true)
    try { await apiClient.delete(`/workspaces/${workspace.id}/invites/${id}`); setCode(''); await invites.refetch() }
    catch (error) { toast.error(message(error)) } finally { setBusy(false) }
  }
  const team = members.data ?? []
  const available = team.filter(member => member.available).length
  return <div className="grid gap-5">
    <section className={panel}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">{workspace.name}</h2><p className="mt-1 text-sm text-muted-foreground">{workspace.kind === 'personal' ? 'Private workspace for your own receptionist.' : 'Shared receptionist. Members can read calls and appointments; managers control settings and records.'}</p></div><Button onClick={() => openWorkspace(workspace.id)}>Open dashboard<ArrowRight /></Button></div>
      <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="size-4 shrink-0" />Calendar connections and personal event details are visible only to the owner.</p>
    </section>
    <div className="grid gap-3 sm:grid-cols-3">
      <article className={panel}><Users className="size-5 text-primary" /><p className="mt-3 text-sm text-muted-foreground">People</p><p className="mt-1 text-2xl font-bold">{team.length || '—'}</p></article>
      <article className={panel}><CircleCheck className="size-5 text-primary" /><p className="mt-3 text-sm text-muted-foreground">Available for transfers</p><p className="mt-1 text-2xl font-bold">{available}</p></article>
      <article className={panel}><CalendarDays className="size-5 text-primary" /><p className="mt-3 text-sm text-muted-foreground">Calendar accounts</p><p className="mt-1 text-2xl font-bold">{owner ? calendars.data?.connections.length ?? '—' : 'Private'}</p></article>
    </div>
    <section className={panel}><h2 className="mb-4 text-lg font-semibold">People & routing</h2>{members.isPending ? <p>Loading members…</p> : members.isError ? <p>Could not load members. <Button variant="ghost" onClick={refresh}>Retry</Button></p> : <div className="grid gap-3">{members.data.map(member => <MemberEditor key={`${member.userId}:${member.displayName}:${member.department}:${member.available}:${member.role}`} member={member} workspace={workspace} refresh={refresh} />)}</div>}</section>
    {owner && <section className={panel}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Calendar accounts</h2><p className="mt-1 text-sm text-muted-foreground">Accounts connected to this workspace receptionist. Events stay in their original source calendars.</p></div><Button variant="outline" render={<Link to="/settings?tab=connections" />}>Manage calendars</Button></div>
      {calendars.isPending ? <p className="mt-4 text-sm text-muted-foreground">Loading calendar accounts…</p> : calendars.isError ? <p className="mt-4 text-sm text-destructive">Could not load calendar accounts.</p> : calendars.data?.connections.length ? <div className="mt-4 grid gap-2">{calendars.data.connections.map(connection => {
        const count = calendars.data!.calendars.filter(calendar => calendar.connectionId === connection.id).length
        return <div key={connection.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"><div className="min-w-0"><p className="truncate font-semibold">{connection.accountName || connection.accountEmail}</p><p className="truncate text-sm text-muted-foreground">{connection.accountEmail}</p></div><span className="shrink-0 rounded-full bg-sunk-1 px-2.5 py-1 text-sm font-semibold capitalize">{connection.provider} · {count} {count === 1 ? 'calendar' : 'calendars'}</span></div>
      })}</div> : <p className="mt-4 text-sm text-muted-foreground">No calendar account is connected to this workspace.</p>}
    </section>}
    {owner && workspace.kind === 'team' && <section className={panel}><h2 className="text-lg font-semibold">Invite a teammate</h2><p className="mt-2 text-sm text-muted-foreground">The code works only for the verified email you specify. It expires in seven days and can be used once. Share it directly with your teammate.</p><form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void invite() }}><label htmlFor="invite-email" className="grid gap-1 text-sm">Email<Input id="invite-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label><label className="grid gap-1 text-sm">Access<select className="rounded-lg border border-border bg-card p-2" value={role} onChange={e => setRole(e.target.value as Member['role'])}><option value="member">Member</option><option value="manager">Manager</option></select></label><Button disabled={busy} type="submit">Create invitation</Button></form>
      {code && <div className="mt-4 rounded-xl bg-sunk-1 p-4"><label htmlFor="created-code" className="grid gap-2 text-sm">Invitation code — copy and share privately<Input id="created-code" readOnly value={code} onFocus={e => e.target.select()} /></label><p className="mt-2 text-sm text-muted-foreground">Your teammate signs in, opens Workspaces, and pastes this under Join a workspace.</p></div>}
      {invites.isError && <p className="mt-3 text-sm text-destructive">Could not load invitations.</p>}{invites.data?.map(item => <div key={item.id} className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm"><span>{item.email} · {item.role}</span><Button variant="ghost" disabled={busy} onClick={() => void revoke(item.id)}>Revoke</Button></div>)}
    </section>}
    <TransferInbox />
  </div>
}

export default function WorkspacesPage() {
  const { user, signOut } = useAuth()
  const query = useQuery({ queryKey: ['workspaces'], queryFn: () => apiClient.get<Workspace[]>('/workspaces').then(r => r.data) })
  const selected = sessionStorage.getItem('deskroute.workspace')
  const workspace = query.data?.find(item => item.id === selected) ?? (!selected ? query.data?.[0] : undefined)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'team' | 'personal'>('team')
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(join: boolean) {
    setBusy(true)
    try { const result = await apiClient.post<{ id: string }>(join ? '/workspaces/join' : '/workspaces', join ? { code: code.trim() } : { name, kind, timezone }); openWorkspace(result.data.id, '/workspaces') }
    catch (error) { toast.error(message(error)); setBusy(false) }
  }
  return <main className="min-h-screen bg-stage text-foreground"><header className="border-b border-border bg-card"><div className="mx-auto flex max-w-page items-center justify-between gap-3 px-5 py-4"><Link to="/" className="text-xl font-bold text-primary">DeskRoute</Link><div className="flex items-center gap-2"><Button variant="ghost" render={<Link to="/" />}><Home />Home</Button><Link to="/help?guide=workspaces" className="hidden text-sm font-semibold text-primary sm:block">Help & tutorial</Link><span className="hidden text-sm md:block">{user?.email}</span><Button variant="ghost" onClick={() => void signOut()}>Sign out</Button></div></div></header>
    <div className="mx-auto grid max-w-page gap-6 px-5 py-8"><div><h1 className="text-2xl font-bold">Your workspaces</h1><p className="mt-2 text-muted-foreground">Keep each business and your personal receptionist separate.</p></div>
      {query.isPending ? <p>Loading workspaces…</p> : query.isError ? <p>Could not load workspaces. <Button onClick={() => void query.refetch()}>Retry</Button></p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{query.data.map(item => <button key={item.id} disabled={item.id === workspace?.id} onClick={() => openWorkspace(item.id, '/workspaces')} className={`flex items-center gap-3 rounded-2xl border p-4 text-left ${item.id === workspace?.id ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-sunk-1'}`}>{item.kind === 'team' ? <Building2 className="text-primary" /> : <UserRound className="text-primary" />}<span><span className="block font-semibold">{item.name}</span><span className="text-sm text-muted-foreground">{item.role} · {item.id === workspace?.id ? 'Selected' : 'Switch workspace'}</span></span></button>)}</div>}
      {workspace && <WorkspaceDetails key={workspace.id} workspace={workspace} />}
      <div className="grid gap-5 md:grid-cols-2"><section className={panel}><h2 className="flex items-center gap-2 text-lg font-semibold"><Building2 className="text-primary" />Create a workspace</h2><form className="mt-4 grid gap-3" onSubmit={e => { e.preventDefault(); void submit(false) }}><label htmlFor="workspace-name" className="grid gap-1 text-sm">Workspace name<Input id="workspace-name" required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label><label className="grid gap-1 text-sm">Type<select className="rounded-lg border border-border bg-card p-2" value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="team">Team — invite managers and members</option><option value="personal">Personal — only you</option></select></label><label htmlFor="workspace-timezone" className="grid gap-1 text-sm">Timezone<Input id="workspace-timezone" required value={timezone} onChange={e => setTimezone(e.target.value)} /></label><Button type="submit" disabled={busy}>Create workspace</Button></form></section>
      <section className={panel}><h2 className="flex items-center gap-2 text-lg font-semibold"><Users className="text-primary" />Join a workspace</h2><p className="mt-3 text-sm text-muted-foreground">Sign in with the email the owner invited, then paste their invitation code.</p><form className="mt-4 grid gap-3" onSubmit={e => { e.preventDefault(); void submit(true) }}><label htmlFor="join-code" className="grid gap-1 text-sm">Invitation code<Input id="join-code" required value={code} autoComplete="off" onChange={e => setCode(e.target.value)} /></label><Button type="submit" disabled={busy}>Join workspace</Button></form></section></div>
    </div>
  </main>
}
