import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LiveKitRoom, RoomAudioRenderer, useConnectionState, useParticipants } from '@livekit/components-react'
import { ConnectionState } from 'livekit-client'
import { Building2, UserRound, Users, ArrowRight, RefreshCw, PhoneOff, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiClient, openWorkspace } from '@/lib/apiClient'
import { useAuth } from '@/features/auth/useAuth'
import type { TestSessionData } from '@/features/home/LiveControl'

type Workspace = { id: string; name: string; kind: 'personal' | 'team'; role: 'manager' | 'member'; ownerUserId: string; userId: string }
type Member = { userId: string; displayName: string; department: string; available: boolean; role: 'manager' | 'member' }
type Invite = { id: string; email: string; role: string; expiresAt: string }
type Transfer = { id: string; expiresAt: string }
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
  return <div className="grid gap-4 rounded-xl border border-border p-4">
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{self ? 'You' : member.displayName || 'New teammate'}</h3><span className="text-sm text-muted-foreground">{member.userId === workspace.ownerUserId ? 'Owner' : member.role}</span></div>
    {canEdit ? <>
      <div className="grid gap-3 sm:grid-cols-2"><label htmlFor={`member-name-${member.userId}`} className="grid gap-1 text-sm">Name callers can ask for<Input id={`member-name-${member.userId}`} value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label><label htmlFor={`member-department-${member.userId}`} className="grid gap-1 text-sm">Department<Input id={`member-department-${member.userId}`} value={department} maxLength={80} onChange={e => setDepartment(e.target.value)} /></label></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={available} onChange={e => setAvailable(e.target.checked)} />Available for browser transfers</label>
      <div className="flex flex-wrap items-center gap-3">{canChangeRole && <label className="flex items-center gap-2 text-sm">Role<select className="rounded-lg border border-border bg-card p-2" value={role} onChange={e => setRole(e.target.value as Member['role'])}><option value="member">Member</option><option value="manager">Manager</option></select></label>}<Button disabled={busy || !name.trim()} onClick={() => void save()}>Save</Button>{canChangeRole && <Button variant="ghost" disabled={busy} onClick={() => void remove()}>Remove member</Button>}</div>
    </> : <p className="text-sm text-muted-foreground">{member.department || 'No department'} · {member.available ? 'Available for transfers' : 'Unavailable'}</p>}
  </div>
}

function TransferStatus() {
  const state = useConnectionState()
  const participants = useParticipants()
  return <p className="text-sm">{state !== ConnectionState.Connected ? 'Connecting microphone…' : participants.some(item => item.identity.startsWith('admin-')) ? 'Connected. You can speak with the caller.' : 'The caller has left. End this test.'}</p>
}

function TransferInbox() {
  const [session, setSession] = useState<TestSessionData | null>(null)
  const [busy, setBusy] = useState(false)
  const inbox = useQuery({ queryKey: ['transfers'], queryFn: () => apiClient.get<Transfer[]>('/transfers').then(r => r.data), enabled: false })
  async function respond(id: string, accept: boolean) {
    setBusy(true)
    try {
      const result = await apiClient.post<TestSessionData>(`/transfers/${id}/respond`, { accept })
      if (accept) setSession(result.data)
      await inbox.refetch()
    } catch (error) { toast.error(message(error)) } finally { setBusy(false) }
  }
  return <section className={panel}>
    <h2 className="text-lg font-semibold">Browser transfer test</h2>
    <p className="mt-2 text-sm text-muted-foreground">Save your name and turn on availability above. While another person runs Test agent, ask them to request your name or department, then check for their call here. Use headphones. Requests expire after 90 seconds.</p>
    <p className="mt-2 text-sm text-muted-foreground">No phone number or carrier is involved. LiveKit and AI usage still count toward your provider allowances. Nothing polls in the background.</p>
    {session ? <LiveKitRoom serverUrl={session.serverUrl} token={session.token} connect audio video={false} onDisconnected={() => setSession(null)} onError={error => { toast.error(error.message); setSession(null) }} className="mt-4 grid gap-3">
      <RoomAudioRenderer /><TransferStatus /><Button onClick={() => setSession(null)}><PhoneOff />End transfer test</Button>
    </LiveKitRoom> : <>
      <Button className="mt-4" variant="outline" disabled={inbox.isFetching} onClick={() => void inbox.refetch()}><RefreshCw className={inbox.isFetching ? 'animate-spin' : ''} />Check incoming transfers</Button>
      {inbox.isError && <p className="mt-3 text-sm text-destructive">Unable to check requests. Retry.</p>}
      {inbox.data?.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No pending transfer requests.</p>}
      {inbox.data?.map(item => <div key={item.id} className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-sunk-1 p-3"><span className="text-sm">Incoming test call</span><Button disabled={busy} onClick={() => void respond(item.id, true)}>Accept & connect microphone</Button><Button disabled={busy} variant="ghost" onClick={() => void respond(item.id, false)}>Decline</Button></div>)}
    </>}
  </section>
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
  return <div className="grid gap-5">
    <section className={panel}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">{workspace.name}</h2><p className="mt-1 text-sm text-muted-foreground">{workspace.kind === 'personal' ? 'Private workspace for your own receptionist.' : 'Shared receptionist. Managers manage business records; members manage their own availability.'}</p></div>{workspace.role === 'manager' && <Button onClick={() => openWorkspace(workspace.id)}>Open dashboard<ArrowRight /></Button>}</div>
      <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="size-4 shrink-0" />Calendar connections and personal event details are visible only to the owner.</p>
    </section>
    <section className={panel}><h2 className="mb-4 text-lg font-semibold">People & routing</h2>{members.isPending ? <p>Loading members…</p> : members.isError ? <p>Could not load members. <Button variant="ghost" onClick={refresh}>Retry</Button></p> : <div className="grid gap-3">{members.data.map(member => <MemberEditor key={`${member.userId}:${member.displayName}:${member.department}:${member.available}:${member.role}`} member={member} workspace={workspace} refresh={refresh} />)}</div>}</section>
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
  return <main className="min-h-screen bg-stage text-foreground"><header className="border-b border-border bg-card"><div className="mx-auto flex max-w-page items-center justify-between gap-3 px-5 py-4"><Link to="/" className="text-xl font-bold text-primary">DeskRoute</Link><div className="flex items-center gap-3"><Link to="/help?guide=workspaces" className="text-sm font-semibold text-primary">Help & tutorial</Link><span className="hidden text-sm sm:block">{user?.email}</span><Button variant="ghost" onClick={() => void signOut()}>Sign out</Button></div></div></header>
    <div className="mx-auto grid max-w-page gap-6 px-5 py-8"><div><h1 className="text-2xl font-bold">Your workspaces</h1><p className="mt-2 text-muted-foreground">Keep each business and your personal receptionist separate.</p></div>
      {query.isPending ? <p>Loading workspaces…</p> : query.isError ? <p>Could not load workspaces. <Button onClick={() => void query.refetch()}>Retry</Button></p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{query.data.map(item => <button key={item.id} disabled={item.id === workspace?.id} onClick={() => openWorkspace(item.id, '/workspaces')} className={`flex items-center gap-3 rounded-2xl border p-4 text-left ${item.id === workspace?.id ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-sunk-1'}`}>{item.kind === 'team' ? <Building2 className="text-primary" /> : <UserRound className="text-primary" />}<span><span className="block font-semibold">{item.name}</span><span className="text-sm text-muted-foreground">{item.role} · {item.id === workspace?.id ? 'Selected' : 'Switch workspace'}</span></span></button>)}</div>}
      {workspace && <WorkspaceDetails key={workspace.id} workspace={workspace} />}
      <div className="grid gap-5 md:grid-cols-2"><section className={panel}><h2 className="flex items-center gap-2 text-lg font-semibold"><Building2 className="text-primary" />Create a workspace</h2><form className="mt-4 grid gap-3" onSubmit={e => { e.preventDefault(); void submit(false) }}><label htmlFor="workspace-name" className="grid gap-1 text-sm">Workspace name<Input id="workspace-name" required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label><label className="grid gap-1 text-sm">Type<select className="rounded-lg border border-border bg-card p-2" value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="team">Team — invite managers and members</option><option value="personal">Personal — only you</option></select></label><label htmlFor="workspace-timezone" className="grid gap-1 text-sm">Timezone<Input id="workspace-timezone" required value={timezone} onChange={e => setTimezone(e.target.value)} /></label><Button type="submit" disabled={busy}>Create workspace</Button></form></section>
      <section className={panel}><h2 className="flex items-center gap-2 text-lg font-semibold"><Users className="text-primary" />Join a workspace</h2><p className="mt-3 text-sm text-muted-foreground">Sign in with the email the owner invited, then paste their invitation code.</p><form className="mt-4 grid gap-3" onSubmit={e => { e.preventDefault(); void submit(true) }}><label htmlFor="join-code" className="grid gap-1 text-sm">Invitation code<Input id="join-code" required value={code} autoComplete="off" onChange={e => setCode(e.target.value)} /></label><Button type="submit" disabled={busy}>Join workspace</Button></form></section></div>
    </div>
  </main>
}
