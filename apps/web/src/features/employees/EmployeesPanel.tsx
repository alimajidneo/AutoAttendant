import { CalcomConnection } from './CalcomConnection'
import { WeeklyHours } from './WeeklyHours'
import { hoursErrors } from './weekly-hours'
import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { EmployeeView, EmployeeConnectionView, EmployeeCalendarPolicy, CalendarOption } from '@receptionist/shared'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { apiClient } from '../../lib/apiClient'
import { keys, fetchers } from '../../lib/queries'
import { employeeFormPatch } from './employee-form'
import { calendarKey, loadEmployeeCalendars, selectBookingCalendar, toggleConflictCalendar } from './calendar-picker'

const panel = 'grid gap-4 rounded-xl border border-border bg-card p-4'
const select = 'rounded-lg border border-border bg-card p-2 text-sm'
function errorMessage(error: unknown) {
  const value = (error as { response?: { data?: { error?: unknown } } }).response?.data?.error
  return typeof value === 'string' ? value : 'Could not save. Please try again.'
}

function EmployeeForm({ employee, refresh }: { employee?: EmployeeView; refresh: () => Promise<void> }) {
  const formId = useId()
  const [workingHours, setWorkingHours] = useState(employee?.workingHours)
  const invalidHours = workingHours ? Object.keys(hoursErrors(workingHours)).length > 0 : false
  const [busy, setBusy] = useState(false)
  async function save(form: HTMLFormElement) {
    if (invalidHours) return
    setBusy(true)
    try {
      const data = employeeFormPatch(new FormData(form), workingHours)
      if (employee) await apiClient.patch(`/admin/employees/${employee.id}`, data)
      else await apiClient.post('/admin/employees', data)
      form.reset()
      await refresh()
      toast.success('Employee saved')
    } catch (error) { toast.error(errorMessage(error)) } finally { setBusy(false) }
  }
  async function deactivate() {
    setBusy(true)
    try { await apiClient.post(`/admin/employees/${employee!.id}/deactivate`, {}); await refresh() }
    catch (error) { toast.error(errorMessage(error)) } finally { setBusy(false) }
  }
  return <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void save(event.currentTarget) }}>
    <div className="grid gap-3 sm:grid-cols-2">
      <label htmlFor={`${formId}-displayName`} className="grid gap-1 text-sm">Name<Input id={`${formId}-displayName`} name="displayName" required maxLength={80} defaultValue={employee?.displayName} /></label>
      <label htmlFor={`${formId}-department`} className="grid gap-1 text-sm">Department<Input id={`${formId}-department`} name="department" maxLength={80} defaultValue={employee?.department ?? ''} /></label>
      <label htmlFor={`${formId}-timezone`} className="grid gap-1 text-sm">Timezone<Input id={`${formId}-timezone`} name="timezone" required defaultValue={employee?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone} /></label>
      <label className="grid gap-1 text-sm">Manual availability<select name="manualAvailability" className={select} defaultValue={employee?.manualAvailability ?? 'unknown'}><option value="unknown">Unknown</option><option value="available">Available</option><option value="unavailable">Unavailable</option></select></label>
    </div>
    <label className="flex items-center gap-2 text-sm"><input name="routingEnabled" type="checkbox" defaultChecked={employee?.routingEnabled ?? false} />Enable routing</label>
    <label htmlFor={`${formId}-transferNumber`} className="grid gap-1 text-sm">Private transfer number<Input id={`${formId}-transferNumber`} name="transferNumber" type="password" autoComplete="off" placeholder="+14155550123" pattern="\+[1-9][0-9]{7,14}" /></label>
    <p className="text-sm text-muted-foreground">{employee?.transferDestinationDisplay ?? 'No transfer destination'} · Leave blank to keep the saved number.</p>
    {employee?.hasTransferDestination && <label className="flex items-center gap-2 text-sm"><input name="removeTransfer" type="checkbox" />Remove saved transfer number</label>}
    {workingHours && <WeeklyHours value={workingHours} onChange={setWorkingHours} />}
    <div className="flex flex-wrap gap-2"><Button disabled={busy || invalidHours} type="submit">{employee ? 'Save employee' : 'Add employee'}</Button>{employee && <Button disabled={busy} type="button" variant="outline" onClick={() => void deactivate()}>Deactivate</Button>}</div>
  </form>
}

function CalendarPolicy({ employee, connections, refresh }: { employee: EmployeeView; connections: EmployeeConnectionView[]; refresh: () => Promise<void> }) {
  const policyId = useId()
  const [calendars, setCalendars] = useState<CalendarOption[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [policy, setPolicy] = useState<EmployeeCalendarPolicy>(employee.calendarPolicy)
  const [busy, setBusy] = useState(false)
  const accounts = connections.filter(account => account.employeeId === employee.id)
  async function load() {
    setBusy(true); setLoadError('')
    try { setCalendars(await loadEmployeeCalendars(accounts.map(account => account.id))) }
    catch { setLoadError('Could not load calendars. The workspace owner must load authorized accounts; reconnect if needed.') }
    finally { setBusy(false) }
  }
  async function assign(connection: EmployeeConnectionView) {
    setBusy(true)
    try { await apiClient.patch(`/admin/employees/${employee.id}/connections/${connection.id}`, { assigned: connection.employeeId !== employee.id }); await refresh() }
    catch (error) { toast.error(errorMessage(error)) } finally { setBusy(false) }
  }
  async function save() {
    setBusy(true)
    try { await apiClient.patch(`/admin/employees/${employee.id}/policy`, policy); await refresh(); toast.success('Calendar policy saved') }
    catch (error) { toast.error(errorMessage(error)) } finally { setBusy(false) }
  }
  return <div className="grid gap-3 border-t border-border pt-4">
    <h3 className="font-semibold">Connected accounts</h3>
    {connections.length === 0 && <p className="text-sm text-muted-foreground">The workspace owner can connect Google or Microsoft in Settings → Connections.</p>}
    {connections.map(account => <label key={account.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={account.employeeId === employee.id} disabled={busy || (!!account.employeeId && account.employeeId !== employee.id)} onChange={() => void assign(account)} /><span>{account.provider} · {account.accountEmail}{account.employeeId && account.employeeId !== employee.id ? ' · Assigned to another employee' : ''}</span></label>)}
    <label className="grid gap-1 text-sm">Calendar authority<select className={select} value={policy.authority} onChange={e => setPolicy(e.target.value === 'direct' ? { authority: 'direct', booking: null, conflicts: [] } : { authority: 'calcom', eventType: null, bookingUrl: null })}><option value="direct">Direct Google/Microsoft</option><option value="calcom">Cal.com</option></select></label>
    {policy.authority === 'calcom' && policy.connectionId ? <p className="text-sm">Selected Cal.com event: {policy.eventTypeTitle ?? policy.eventTypeId}. Use the employee connection controls to change it.</p> : policy.authority === 'calcom' ? <>
      <label htmlFor={`${policyId}-eventType`} className="grid gap-1 text-sm">Cal.com event type reference<Input id={`${policyId}-eventType`} placeholder="sam/intro or event type ID" value={policy.eventType ?? ''} maxLength={200} onChange={e => setPolicy({ ...policy, eventType: e.target.value || null })} /></label>
      <label htmlFor={`${policyId}-bookingUrl`} className="grid gap-1 text-sm">Cal.com booking URL<Input id={`${policyId}-bookingUrl`} type="url" placeholder="https://cal.com/sam/intro" value={policy.bookingUrl ?? ''} maxLength={2048} onChange={e => setPolicy({ ...policy, bookingUrl: e.target.value || null })} /></label>
      <p className="text-sm text-muted-foreground">Legacy link only: this reference cannot check availability or book. Connect this employee’s Cal.com account and select a discovered event type below.</p>
    </> : <>
      <Button variant="outline" disabled={busy} onClick={() => void load()}>Load calendars</Button>
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      {calendars === null ? <p className="text-sm text-muted-foreground">Load calendars to edit the saved selection.</p> : <>
        <label className="grid gap-1 text-sm">Booking destination<select className={select} value={policy.booking ? calendarKey(policy.booking) : ''} onChange={event => {
          const selected = calendars.find(calendar => calendarKey({ connectionId: calendar.connectionId, calendarId: calendar.id }) === event.target.value)
          if (selected) setPolicy(selectBookingCalendar(policy, { connectionId: selected.connectionId, calendarId: selected.id }))
        }}><option value="">Choose one writable calendar</option>{calendars.filter(calendar => calendar.writable && accounts.some(account => account.id === calendar.connectionId)).map(calendar => <option key={calendarKey({ connectionId: calendar.connectionId, calendarId: calendar.id })} value={calendarKey({ connectionId: calendar.connectionId, calendarId: calendar.id })}>{calendar.provider} · {calendar.accountEmail} · {calendar.summary}</option>)}</select></label>
        <h4 className="text-sm font-semibold">Conflict calendars</h4>
        {calendars.filter(calendar => accounts.some(account => account.id === calendar.connectionId)).map(calendar => {
          const ref = { connectionId: calendar.connectionId, calendarId: calendar.id }, key = calendarKey(ref)
          const booking = !!policy.booking && calendarKey(policy.booking) === key
          return <label className="flex items-center gap-2 text-sm" key={key}><input type="checkbox" checked={booking || policy.conflicts.some(item => calendarKey(item) === key)} disabled={booking} onChange={event => setPolicy(toggleConflictCalendar(policy, ref, event.target.checked))} />{calendar.provider} · {calendar.accountEmail} · {calendar.summary}{booking ? ' · Booking destination' : ''}</label>
        })}
        {!calendars.length && <p className="text-sm text-muted-foreground">No calendars available from this employee’s assigned accounts.</p>}
      </>}
    </>}
    <Button disabled={busy || (policy.authority === 'calcom' && !!policy.connectionId) || (policy.authority === 'direct' && (!calendars || !policy.booking || !calendars.some(calendar => calendar.writable && calendar.id === policy.booking?.calendarId && calendar.connectionId === policy.booking.connectionId)))} onClick={() => void save()}>Save calendar policy</Button>
  </div>
}

export function EmployeesPanel() {
  const { data: session } = useQuery({ queryKey: keys.session, queryFn: fetchers.session })
  const manager = session?.role === 'manager'
  const [offset, setOffset] = useState(0)
  const employees = useQuery({ queryKey: ['employees', offset], queryFn: () => apiClient.get<EmployeeView[]>(`/admin/employees?limit=20&offset=${offset}`).then(r => r.data), enabled: manager })
  const connections = useQuery({ queryKey: ['employee-connections'], queryFn: () => apiClient.get<EmployeeConnectionView[]>('/admin/employees/connections').then(r => r.data), enabled: manager })
  const refresh = async () => { await Promise.all([employees.refetch(), connections.refetch()]) }
  if (!manager) return <p className="text-sm text-muted-foreground">Manager access required.</p>
  return <section className="grid gap-5">
    <div><h2 className="text-lg font-semibold">Employees</h2><p className="mt-1 text-sm text-muted-foreground">People callers can reach. Employees do not need dashboard accounts.</p></div>
    <details className={panel}><summary className="cursor-pointer font-semibold">Add employee</summary><div className="pt-4"><EmployeeForm refresh={refresh} /><p className="mt-3 text-sm text-muted-foreground">Working hours start at Monday–Friday, 09:00–17:00 in the selected timezone. Routing starts disabled.</p></div></details>
    {employees.isPending ? <p className="text-sm text-muted-foreground">Loading employees…</p> : employees.isError ? <p>Could not load employees. <Button onClick={() => void refresh()}>Retry</Button></p> : !employees.data?.length ? <p className="text-sm text-muted-foreground">No employees yet.</p> : employees.data.map(employee => <article className={panel} key={`${employee.id}:${employee.updatedAt}`}>
      <h3 className="font-semibold">{employee.displayName}</h3>
      <EmployeeForm employee={employee} refresh={refresh} />
      <CalcomConnection employeeId={employee.id} refresh={refresh} />
      <p className="text-sm text-muted-foreground">Working hours: {Object.entries(employee.workingHours.weekly).filter(([, periods]) => periods.length).map(([day, periods]) => `${day} ${periods.map(p => `${p.start}–${p.end}`).join(', ')}`).join('; ') || 'Closed'} ({employee.timezone})</p>
      {connections.isError ? <p className="text-sm text-destructive">Could not load accounts. <Button variant="ghost" onClick={() => void connections.refetch()}>Retry</Button></p> : connections.isPending ? <p className="text-sm text-muted-foreground">Loading accounts…</p> : <CalendarPolicy employee={employee} connections={connections.data ?? []} refresh={refresh} />}
    </article>)}
    <div className="flex gap-2"><Button variant="outline" disabled={!offset} onClick={() => setOffset(offset - 20)}>Previous</Button><Button variant="outline" disabled={(employees.data?.length ?? 0) < 20 || offset >= 10000} onClick={() => setOffset(offset + 20)}>Next</Button></div>
    <p className="text-sm text-muted-foreground">Availability requires routing, manual availability, working hours and verified calendar checks. Calendar policy changes do not change existing workspace bookings.</p>
  </section>
}
