import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), workspaceAccess: vi.fn(), listWorkspaces: vi.fn(),
  listEmployees: vi.fn(), createEmployee: vi.fn(), updateEmployee: vi.fn(), deactivateEmployee: vi.fn(),
  listEmployeeConnections: vi.fn(), assignEmployeeConnection: vi.fn(), saveEmployeePolicy: vi.fn() }));
vi.mock("@receptionist/core/providers/supabase.js", () => ({ supabase: { auth: { getUser: mocks.getUser } } }));
vi.mock("@receptionist/core/repositories/workspaces.js", () => mocks);
vi.mock("@receptionist/core/repositories/employees.js", async importOriginal => ({ ...await importOriginal<typeof import("@receptionist/core/repositories/employees.js")>(), ...mocks }));
import { EmployeeBookingInProgressError } from "@receptionist/core/repositories/employees.js";
import { createApp } from "../../app.js";
const app = createApp({ allowedOrigins: [] });
const id = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222";
const headers = { Authorization: "Bearer verified", "X-Workspace-Id": workspaceId, "Content-Type": "application/json" };
const request = (path = "", method = "GET", body?: unknown) => app.request(`/api/admin/employees${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "manager" } }, error: null });
  mocks.workspaceAccess.mockResolvedValue({ role: "manager", ownerUserId: "owner" });
  mocks.listEmployees.mockResolvedValue([]); mocks.listEmployeeConnections.mockResolvedValue([]);
});
describe("employee administration", () => {
  it("requires authentication, workspace membership and manager access", async () => {
    expect((await app.request('/api/admin/employees')).status).toBe(401);
    mocks.workspaceAccess.mockResolvedValue(null);
    expect((await request()).status).toBe(403);
    mocks.workspaceAccess.mockResolvedValue({ role: "member" });
    for (const [path, method, body] of [["", "GET"], ["/connections", "GET"], ["", "POST", {}], [`/${id}`, "PATCH", {}], [`/${id}/deactivate`, "POST", {}], [`/${id}/connections/${id}`, "PATCH", { assigned: true }], [`/${id}/policy`, "PATCH", {}]] as const) {
      expect((await request(path, method, body)).status).toBe(403);
    }
    expect(mocks.listEmployees).not.toHaveBeenCalled();
    expect(mocks.createEmployee).not.toHaveBeenCalled();
  });
  it("lists bounded employee pages and stored account labels for the selected workspace", async () => {
    expect((await request('?limit=20&offset=20')).status).toBe(200);
    expect(mocks.listEmployees).toHaveBeenCalledWith(workspaceId, 20, 20);
    expect((await request('/connections')).status).toBe(200);
    expect(mocks.listEmployeeConnections).toHaveBeenCalledWith(workspaceId);
    expect((await request('?limit=101')).status).toBe(400);
    expect((await request('?offset=-1')).status).toBe(400);
  });
  it("creates and patches employee fields with server tenant ownership", async () => {
    const body = { displayName: "Sam", timezone: "UTC", transferNumber: "+14155550123" };
    mocks.createEmployee.mockResolvedValue({ id, hasTransferDestination: true, transferDestinationDisplay: "•••• 0123" });
    const response = await request('', 'POST', body);
    expect(response.status).toBe(201);
    expect(await response.text()).not.toContain(body.transferNumber);
    expect(mocks.createEmployee).toHaveBeenCalledWith(workspaceId, body);
    mocks.updateEmployee.mockResolvedValue({ id, hasTransferDestination: false });
    expect((await request(`/${id}`, 'PATCH', { transferNumber: null, department: "Sales" })).status).toBe(200);
    expect(mocks.updateEmployee).toHaveBeenCalledWith(workspaceId, id, { transferNumber: null, department: "Sales" });
    mocks.updateEmployee.mockResolvedValue(null);
    expect((await request(`/${id}`, 'PATCH', { displayName: "Sam" })).status).toBe(404);
  });
  it.each([{ displayName: "" }, { timezone: "wrong" }, { transferNumber: "4155550123" }, { agentId: workspaceId }, { encryptedTransferDestination: "secret" }, { routingEnabled: "true" }, { manualAvailability: "free" }, {}])("rejects invalid or unknown update fields %j", async body => {
    expect((await request(`/${id}`, 'PATCH', body)).status).toBe(400);
    expect(mocks.updateEmployee).not.toHaveBeenCalled();
  });
  it("validates strict nested hours, ids and malformed JSON", async () => {
    expect((await request('/bad-id', 'PATCH', { displayName: 'Sam' })).status).toBe(400);
    expect((await request(`/${id}`, 'PATCH', { workingHours: { weekly: { mon: [{ start: '17:00', end: '09:00' }] }, exceptions: [] } })).status).toBe(400);
    expect((await request(`/${id}`, 'PATCH', { workingHours: { weekly: {}, exceptions: [], secret: 'bad' } })).status).toBe(400);
    expect((await app.request('/api/admin/employees', { method: 'POST', headers, body: '{' })).status).toBe(400);
  });
  it("deactivates and assigns or unassigns scoped connections", async () => {
    mocks.deactivateEmployee.mockResolvedValue({ id, routingEnabled: false });
    expect((await request(`/${id}/deactivate`, 'POST', {})).status).toBe(200);
    expect(mocks.deactivateEmployee).toHaveBeenCalledWith(workspaceId, id);
    expect((await request(`/${id}/deactivate`, 'POST', { agentId: workspaceId })).status).toBe(400);
    mocks.assignEmployeeConnection.mockResolvedValue(true);
    for (const assigned of [true, false]) {
      expect((await request(`/${id}/connections/${id}`, 'PATCH', { assigned })).status).toBe(200);
      expect(mocks.assignEmployeeConnection).toHaveBeenLastCalledWith(workspaceId, id, id, assigned);
    }
    mocks.assignEmployeeConnection.mockResolvedValue(false);
    expect((await request(`/${id}/connections/${id}`, 'PATCH', { assigned: true })).status).toBe(409);
  });
  it("returns a validation error for a malformed Cal.com URL", async () => {
    expect((await request(`/${id}/policy`, 'PATCH', { authority: 'calcom', eventType: null, bookingUrl: 'not a URL' })).status).toBe(400);
    expect(mocks.saveEmployeePolicy).not.toHaveBeenCalled();
  });
  it("accepts a single direct or Cal.com policy and rejects mixed or unsafe inputs", async () => {
    mocks.saveEmployeePolicy.mockResolvedValue({ id });
    for (const policy of [
      { authority: 'direct', booking: { connectionId: id, calendarId: 'primary' }, conflicts: [] },
      { authority: 'calcom', eventType: 'sam/intro', bookingUrl: null },
      { authority: 'calcom', eventType: null, bookingUrl: 'https://cal.com/sam/intro' },
    ]) {
      expect((await request(`/${id}/policy`, 'PATCH', policy)).status).toBe(200);
      expect(mocks.saveEmployeePolicy).toHaveBeenLastCalledWith(workspaceId, id, policy);
    }
    for (const policy of [
      { authority: 'calcom', eventType: null, bookingUrl: null },
      { authority: 'calcom', eventType: 'sam/intro', bookingUrl: 'javascript:alert(1)' },
      { authority: 'calcom', eventType: 'sam/intro', bookingUrl: 'https://user:pass@cal.com/sam' },
      { authority: 'direct', booking: null, conflicts: [], eventType: 'sam/intro' },
      { authority: 'direct', booking: { connectionId: id, calendarId: 'primary', secret: 'bad' }, conflicts: [] },
    ]) expect((await request(`/${id}/policy`, 'PATCH', policy)).status).toBe(400);
    mocks.saveEmployeePolicy.mockResolvedValue(null);
    expect((await request(`/${id}/policy`, 'PATCH', { authority: 'direct', booking: null, conflicts: [] })).status).toBe(409);
  });
});

it.each([
  ['updateEmployee', '', 'PATCH', { displayName: 'Updated' }],
  ['deactivateEmployee', '/deactivate', 'POST', {}],
  ['saveEmployeePolicy', '/policy', 'PATCH', { authority: 'direct', booking: null, conflicts: [] }],
  ['assignEmployeeConnection', `/connections/${id}`, 'PATCH', { assigned: false }],
] as const)('returns actionable 409 for %s during a booking write', async (method, path, verb, body) => {
  mocks[method].mockRejectedValue(new EmployeeBookingInProgressError());
  const response = await request(`/${id}${path}`, verb, body);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'A booking write is in progress or ambiguous; check Appointments/provider before retrying.' });
});
