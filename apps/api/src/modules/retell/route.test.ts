import { createHmac } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ runRetellFunction: vi.fn(), saveRetellMessage: vi.fn(), markRetellCallOutcome: vi.fn(), getUser: vi.fn(), workspaceAccess: vi.fn(), getRetellConnection: vi.fn(), saveRetellConnection: vi.fn(), resolveRetellWorkspace: vi.fn(), ingestRetellEvent: vi.fn(), lookupEmployees: vi.fn(), getEmployee: vi.fn(), resolveEmployeeTransferDestination: vi.fn(), checkEmployeeAvailability: vi.fn(), bookEmployeeAppointment: vi.fn() }));
vi.mock('@receptionist/core/providers/supabase.js', () => ({ supabase: { auth: { getUser: m.getUser } } }));
vi.mock('@receptionist/core/repositories/workspaces.js', () => m);
vi.mock('@receptionist/core/repositories/retell.js', () => m);
vi.mock('@receptionist/core/repositories/employees.js', () => m);
vi.mock('@receptionist/core/providers/employee-calendar.js', () => m);
import { env } from '@receptionist/core/env.js';
import { createApp } from '../../app.js';
const app = createApp({ allowedOrigins: ['https://dashboard.test'] });
const id = '11111111-1111-4111-8111-111111111111';
const admin = { Authorization: 'Bearer test', 'X-Workspace-Id': id, 'Content-Type': 'application/json' };
function signed(path: string, body: unknown, signature?: string) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body), time = Date.now();
  return app.request(`/api/retell/${path}`, { method: 'POST', headers: { 'x-retell-signature': signature ?? `v=${time},d=${createHmac('sha256', 'test-only').update(raw + time).digest('hex')}` }, body: raw });
}
const call = { agent_id: 'agent_a', call_id: 'call_a' };
const range = { employeeId: id, start: '2026-09-14T10:00:00Z', end: '2026-09-14T11:00:00Z' };
beforeEach(() => {
  vi.resetAllMocks(); env.RETELL_API_KEY = 'test-only'; env.RETELL_WORKSPACE_ID = id; env.RETELL_AGENT_ID = 'agent_a';
  const completed = new Map<string, unknown>();
  m.runRetellFunction.mockImplementation(async (_a, _r, callId, name, hash, invocationId, execute) => {
    const key = JSON.stringify([callId, name, invocationId ?? hash]);
    if (completed.has(key)) return completed.get(key);
    const result = await execute('invocation-key'); completed.set(key, result); return result;
  }); m.markRetellCallOutcome.mockResolvedValue(undefined);
  m.getUser.mockResolvedValue({ data: { user: { id: 'manager' } }, error: null });
  m.workspaceAccess.mockResolvedValue({ role: 'manager', ownerUserId: 'manager' });
  m.resolveRetellWorkspace.mockResolvedValue('workspace'); m.getRetellConnection.mockResolvedValue(null);
  m.lookupEmployees.mockResolvedValue([]); m.checkEmployeeAvailability.mockResolvedValue({ available: true, reason: 'available' });
  m.bookEmployeeAppointment.mockResolvedValue({ status: 'confirmed', appointmentId: id });
});
it('fails 401 before JSON parsing or any repository/provider work for every public route', async () => {
  for (const path of ['webhook', ...['lookup-employee', 'check-availability', 'resolve-transfer', 'book-appointment', 'save-message'].map(x => `functions/${x}`)]) {
    expect((await signed(path, '{', 'bad')).status).toBe(401);
  }
  expect(m.resolveRetellWorkspace).not.toHaveBeenCalled(); expect(m.ingestRetellEvent).not.toHaveBeenCalled();
  expect(m.checkEmployeeAvailability).not.toHaveBeenCalled(); expect(m.bookEmployeeAppointment).not.toHaveBeenCalled();
  env.RETELL_API_KEY = undefined;
  expect((await signed('webhook', {})).status).toBe(401);
});
it('rejects oversized unauthenticated bodies before signature or repository work even with understated content length', async () => {
 const raw = 'x'.repeat(262145);
 for (const request of [
  signed('webhook', raw, 'bad'),
  app.request(new Request('http://localhost/api/retell/webhook', { method: 'POST', headers: { 'x-retell-signature': 'bad', 'content-length': '1' }, body: raw })),
 ]) expect((await request).status).toBe(413);
 expect(m.resolveRetellWorkspace).not.toHaveBeenCalled();
 expect(m.ingestRetellEvent).not.toHaveBeenCalled();
});
it('accepts raw signed JSON, ignores streams, and never forwards raw webhook artifacts', async () => {
  expect((await signed('webhook', '{')).status).toBe(400);
  expect((await signed('webhook', { event: 'transcript_updated', call })).status).toBe(204);
  expect(m.ingestRetellEvent).not.toHaveBeenCalled();
  expect((await signed('webhook', { event: 'call_ended', call: { ...call, transcript: 'SECRET', recording_url: 'SECRET' } })).status).toBe(204);
  expect(JSON.stringify(m.ingestRetellEvent.mock.calls)).not.toContain('SECRET');
});
it('maps enabled function workspace only from call.agent_id and rejects strict invalid args', async () => {
  expect((await signed('functions/check-availability', { call, args: range })).status).toBe(200);
  expect(m.checkEmployeeAvailability).toHaveBeenCalledWith('workspace', range);
  for (const args of [{ ...range, agentId: id }, { ...range, employeeId: 'bad' }, { ...range, start: '2026-09-14' }, { ...range, end: '2026-09-14T10:04:59Z' }, { ...range, end: '2026-09-14T18:00:01Z' }, { ...range, end: range.start }]) expect((await signed('functions/check-availability', { call, args })).status).toBe(400);
  for (const args of [{ employeeId: id, extra: true }, {}]) expect((await signed('functions/resolve-transfer', { call, args })).status).toBe(400);
  expect((await signed('functions/book-appointment', { call, args: { ...range, callerName: '' } })).status).toBe(400);
  expect((await signed('functions/lookup-employee', { call, args: { department: 42 } })).status).toBe(400);
  m.resolveRetellWorkspace.mockResolvedValue(null);
  expect((await signed('functions/lookup-employee', { call, args: {} })).status).toBe(204);
});
it('returns only eligible protected transfer destinations and does not place calls', async () => {
  m.getEmployee.mockResolvedValue({ routingEnabled: true, manualAvailability: 'available', hasTransferDestination: true });
  m.resolveEmployeeTransferDestination.mockResolvedValue('+14155550123');
  const response = await signed('functions/resolve-transfer', { call, args: { employeeId: id } });
  expect(await response.json()).toEqual({ destination: '+14155550123' });
  for (const employee of [null, { routingEnabled: false }, { routingEnabled: true, manualAvailability: 'unknown' }, { routingEnabled: true, manualAvailability: 'available', hasTransferDestination: false }]) {
    m.getEmployee.mockResolvedValue(employee); m.resolveEmployeeTransferDestination.mockClear();
    expect(await (await signed('functions/resolve-transfer', { call, args: { employeeId: id } })).json()).toEqual({ destination: null });
    expect(m.resolveEmployeeTransferDestination).not.toHaveBeenCalled();
  }
});
it('looks up employees and books with bounded disclosed fields', async () => {
  expect((await signed('functions/lookup-employee', { call, args: { name: 'Sam', department: 'Sales' } })).status).toBe(200);
  expect(m.lookupEmployees).toHaveBeenCalledWith('workspace', { name: 'Sam', department: 'Sales' });
  expect(await (await signed('functions/book-appointment', { call, args: { ...range, callerName: 'Caller', caller_confirmed: true } })).json()).toEqual({ status: 'confirmed', appointmentId: id });
});
it('passes one request deadline safely below the Vercel function limit into booking', async () => {
  const startedAt = Date.now();
  await signed('functions/book-appointment', { call, args: { ...range, callerName: 'Caller', caller_confirmed: true } });
  const deadlineAt = m.bookEmployeeAppointment.mock.calls[0]?.[3];
  expect(deadlineAt).toEqual(expect.any(Number));
  expect(deadlineAt - startedAt).toBeGreaterThanOrEqual(44_000);
  expect(deadlineAt - startedAt).toBeLessThan(60_000);
});
it('returns a conservative result when workspace resolution consumes the whole booking request budget', async () => {
  vi.useFakeTimers();
  try {
    m.resolveRetellWorkspace.mockImplementation(() => new Promise(() => undefined));
    const response = signed('functions/book-appointment', { call, args: { ...range, callerName: 'Caller', caller_confirmed: true } });
    await vi.advanceTimersByTimeAsync(45_001);
    expect(await (await response).json()).toEqual({ status: 'unknown', reason: 'request_deadline_exceeded' });
    expect(m.runRetellFunction).not.toHaveBeenCalled();
    expect(m.bookEmployeeAppointment).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it('requires manager auth for settings and returns only key readiness', async () => {
  expect((await app.request('/api/admin/retell')).status).toBe(401);
  expect(await (await app.request('/api/admin/retell', { headers: admin })).json()).toEqual({ retellAgentId: '', enabled: false, apiKeyConfigured: true, operatorApproved: false });
  m.saveRetellConnection.mockResolvedValue(true);
  expect((await app.request('/api/admin/retell', { method: 'PUT', headers: admin, body: JSON.stringify({ retellAgentId: 'agent_a', enabled: true }) })).status).toBe(200);
  expect((await app.request('/api/admin/retell', { method: 'PUT', headers: admin, body: JSON.stringify({ retellAgentId: 'agent_a', enabled: true, apiKey: 'SECRET' }) })).status).toBe(400);
  m.saveRetellConnection.mockResolvedValue(false);
  expect((await app.request('/api/admin/retell', { method: 'PUT', headers: admin, body: JSON.stringify({ retellAgentId: 'agent_a', enabled: true }) })).status).toBe(409);
  m.workspaceAccess.mockResolvedValue({ role: 'member' });
  expect((await app.request('/api/admin/retell', { headers: admin })).status).toBe(403);
});
it('requires owner and operator approval to enable a binding', async () => {
  env.RETELL_WORKSPACE_ID = undefined; env.RETELL_AGENT_ID = undefined;
  expect((await app.request('/api/admin/retell', { method: 'PUT', headers: admin, body: JSON.stringify({ retellAgentId: 'agent_a', enabled: true }) })).status).toBe(409);
  m.workspaceAccess.mockResolvedValue({ role: 'manager', ownerUserId: 'someone-else' });
  expect((await app.request('/api/admin/retell', { headers: admin })).status).toBe(403);
});
it.each(['outside_hours', 'provider_unknown', 'provider_busy'])('never decrypts for %s', async reason => {
  m.getEmployee.mockResolvedValue({ routingEnabled: true, manualAvailability: 'available', hasTransferDestination: true });
  m.checkEmployeeAvailability.mockResolvedValue({ available: false, reason });
  expect(await (await signed('functions/resolve-transfer', { call, args: { employeeId: id } })).json()).toEqual({ destination: null });
  expect(m.resolveEmployeeTransferDestination).not.toHaveBeenCalled();
});
it('validates save-message and delegates semantic identity to the transactional repository', async () => {
  m.saveRetellMessage.mockResolvedValue({ saved: true, messageId: id });
  const payload = { call, args: { message: 'Please call back', callerPhone: '+14155550123', caller_confirmed: true }, tool_call_id: 'message-1' };
  expect(await (await signed('functions/save-message', payload)).json()).toEqual({ saved: true, messageId: id });
  expect(m.saveRetellMessage).toHaveBeenCalledWith('workspace', 'agent_a', 'call_a', { message: 'Please call back', callerPhone: '+14155550123' }, expect.stringMatching(/^[a-f0-9]{64}$/), 'message-1');
  expect(m.runRetellFunction).not.toHaveBeenCalled();
  for (const args of [{ message: '' }, { message: 'x'.repeat(1001) }, { message: 'x', callerPhone: '123' }, { message: 'x', extra: true }]) expect((await signed('functions/save-message', { call, args })).status).toBe(400);
});
it.each([{ message: 'Please call back' }, { message: 'Please call back', caller_confirmed: false }])('does not save an unconfirmed message %j', async args => {
  expect(await (await signed('functions/save-message', { call, args })).json()).toMatchObject({ saved: false, status: 'confirmation_required' });
  expect(m.saveRetellMessage).not.toHaveBeenCalled();
});
it('allows disabled pending saves but rejects mismatched activation pairs without a write', async () => {
  m.saveRetellConnection.mockResolvedValue(true); env.RETELL_AGENT_ID = 'different';
  expect((await app.request('/api/admin/retell', { method: 'PUT', headers: admin, body: JSON.stringify({ retellAgentId: 'agent_a', enabled: false }) })).status).toBe(200);
  m.saveRetellConnection.mockClear();
  for (const workspace of [id, '22222222-2222-4222-8222-222222222222']) {
    env.RETELL_WORKSPACE_ID = workspace;
    expect((await app.request('/api/admin/retell', { method: 'PUT', headers: admin, body: JSON.stringify({ retellAgentId: 'agent_a', enabled: true }) })).status).toBe(409);
  }
  expect(m.saveRetellConnection).not.toHaveBeenCalled();
});
it('does not repeat booking after a claim and retains confirmed response if outcome recording fails', async () => {
  m.markRetellCallOutcome.mockRejectedValue(new Error('local failure'));
  const payload = { call, args: { ...range, callerName: 'Caller' } };
  expect(await (await signed('functions/book-appointment', payload)).json()).toEqual({ status: 'confirmed', appointmentId: id });
  expect(await (await signed('functions/book-appointment', payload)).json()).toEqual({ status: 'confirmed', appointmentId: id });
  expect(m.bookEmployeeAppointment).toHaveBeenCalledTimes(1);
  expect(m.markRetellCallOutcome).toHaveBeenCalledTimes(1);
  expect(m.runRetellFunction.mock.invocationCallOrder[0]).toBeLessThan(m.bookEmployeeAppointment.mock.invocationCallOrder[0]!);
});
it('permits Cal.com resolution only after the shared full eligibility check', async () => {
  m.getEmployee.mockResolvedValue({ routingEnabled: true, manualAvailability: 'available', hasTransferDestination: true });
  m.checkEmployeeAvailability.mockResolvedValue({ available: false, reason: 'calcom_authority' });
  m.resolveEmployeeTransferDestination.mockResolvedValue('+14155550123');
  expect(await (await signed('functions/resolve-transfer', { call, args: { employeeId: id } })).json()).toEqual({ destination: '+14155550123' });
  const interval = m.checkEmployeeAvailability.mock.calls[0]![1];
  expect(Date.parse(interval.end) - Date.parse(interval.start)).toBe(300000);
  expect(m.checkEmployeeAvailability.mock.invocationCallOrder[0]).toBeLessThan(m.resolveEmployeeTransferDestination.mock.invocationCallOrder[0]!);
});
it('passes Cal contact and explicit confirmation aliases without announcing non-success', async () => {
 m.bookEmployeeAppointment.mockResolvedValue({ status: 'contact_required', reason: 'Ask for valid contact' });
 const response = await signed('functions/book-appointment', { call, args: { ...range, callerName: 'Caller', caller_email: 'caller@example.test', caller_phone: '+14155550123', caller_confirmed: true } });
 expect(await response.json()).toMatchObject({ status: 'contact_required' });
 expect(m.bookEmployeeAppointment).toHaveBeenCalledWith('workspace', expect.objectContaining({ callerEmail: 'caller@example.test', callerPhone: '+14155550123', callerConfirmed: true }), 'invocation-key', expect.any(Number));
 expect(m.markRetellCallOutcome).not.toHaveBeenCalled();
});

it('claims normalized booking semantics once across aliases and JSON formatting', async () => {

 const args = { ...range, callerName: ' Caller ', callerEmail: 'caller@example.test', callerPhone: '+14155550123', callerConfirmed: true, purpose: ' Intro ' };
 await signed('functions/book-appointment', { call, args });
 await signed('functions/book-appointment', JSON.stringify({ args: { purpose: 'Intro', caller_confirmed: true, caller_phone: '+14155550123', caller_email: ' caller@example.test ', callerName: 'Caller', ...range, start: '2026-09-14T10:00:00.000Z' }, call }, null, 2));
 expect(m.bookEmployeeAppointment).toHaveBeenCalledTimes(1);
});
it.each([{ callerConfirmed: true, caller_confirmed: false }, { callerEmail: 'a@example.test', caller_email: 'b@example.test' }, { callerPhone: '+14155550123', caller_phone: '+14155550124' }])('rejects conflicting aliases %j before claim', async aliases => {
 expect((await signed('functions/book-appointment', { call, args: { ...range, callerName: 'Caller', ...aliases } })).status).toBe(400);
 expect(m.runRetellFunction).not.toHaveBeenCalled();
});
it('normalizes UUID case and insignificant name/purpose whitespace before hashing', async () => {
 const employeeId = 'abcdefab-abcd-4abc-8abc-abcdefabcdef';
 await signed('functions/book-appointment', { call, args: { ...range, employeeId, callerName: 'Jane Doe', purpose: 'Sales intro', callerConfirmed: true } });
 await signed('functions/book-appointment', { call, args: { ...range, employeeId: employeeId.toUpperCase(), callerName: ' Jane  Doe ', purpose: ' Sales  intro ', caller_confirmed: true } });
 expect(m.runRetellFunction.mock.calls[0]![4]).toBe(m.runRetellFunction.mock.calls[1]![4]);
});

it('normalizes all semantic text to NFC before validation and hashes composed/decomposed replays identically', async () => {
 const args = { ...range, callerName: 'José', purpose: 'Résumé', callerEmail: 'josé@example.test' };
 await signed('functions/book-appointment', { call, args, tool_call_id: 'tool-1' });
 await signed('functions/book-appointment', { call, args: Object.fromEntries(Object.entries(args).map(([k,v]) => [k, v.normalize('NFD')])), tool_call_id: 'tool-1' });
 expect(m.runRetellFunction.mock.calls[0]![4]).toBe(m.runRetellFunction.mock.calls[1]![4]);
 expect(m.runRetellFunction.mock.calls[0]![5]).toBe('tool-1');
 expect(m.bookEmployeeAppointment).toHaveBeenCalledTimes(1);
 await signed('functions/lookup-employee', { call, args: { name: 'José'.normalize('NFD'), department: 'Résumé'.normalize('NFD') } });
 expect(m.lookupEmployees).toHaveBeenCalledWith('workspace', { name: 'José', department: 'Résumé' });
 m.saveRetellMessage.mockResolvedValue({ saved: true, messageId: id });
 await signed('functions/save-message', { call, args: { message: 'é'.repeat(1000).normalize('NFD'), callerName: 'José'.normalize('NFD'), caller_confirmed: true } });
 expect(m.saveRetellMessage).toHaveBeenCalledWith('workspace', 'agent_a', 'call_a', { message: 'é'.repeat(1000), callerName: 'José' }, expect.any(String), undefined);
});
it.each([{ tool_call_id: '' }, { tool_call_id: 'x'.repeat(201) }, { tool_call_id: 'a', invocation_id: 'b' }])('rejects invalid or conflicting invocation identity %j', async identity => {
 expect((await signed('functions/book-appointment', { call, args: { ...range, callerName: 'Caller' }, ...identity })).status).toBe(400);
 expect(m.runRetellFunction).not.toHaveBeenCalled();
});
