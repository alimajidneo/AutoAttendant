import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), listWorkspaces: vi.fn(), createWorkspace: vi.fn(),
  workspaceAccess: vi.fn(), listMembers: vi.fn(), updateMember: vi.fn(), removeMember: vi.fn(),
  createInvite: vi.fn(), acceptInvite: vi.fn(), listInvites: vi.fn(), revokeInvite: vi.fn(),
  convertPersonalWorkspaceToTeam: vi.fn(), saveVerifiedMemberEmail: vi.fn() }));
vi.mock("@receptionist/core/providers/supabase.js", () => ({ supabase: { auth: { getUser: mocks.getUser } } }));
vi.mock("@receptionist/core/repositories/workspaces.js", () => mocks);
import { workspaces } from "./route.js";
const id = "11111111-1111-4111-8111-111111111111";
const headers = { Authorization: "Bearer verified", "Content-Type": "application/json" };
const post = (path: string, data: unknown, method = "POST") => workspaces.request(path, { method, headers, body: JSON.stringify(data) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "member", email: "member@example.test", email_confirmed_at: "2026-01-01" } }, error: null });
  mocks.workspaceAccess.mockResolvedValue({ role: "member", ownerUserId: "owner", kind: "team" });
  mocks.listMembers.mockResolvedValue([]);
});
describe("workspace HTTP authorization", () => {
  it("does not reveal a directory to an outsider", async () => {
    mocks.workspaceAccess.mockResolvedValue(null);
    expect((await workspaces.request(`/${id}/members`, { headers })).status).toBe(403);
    expect(mocks.listMembers).not.toHaveBeenCalled();
  });
  it("checks every nested member route", async () => {
    mocks.workspaceAccess.mockResolvedValue(null);
    expect((await post(`/${id}/members/owner`, { role: "member" }, "PATCH")).status).toBe(403);
    expect(mocks.updateMember).not.toHaveBeenCalled();
  });
  it("does not reveal invitation emails to members", async () => {
    expect((await workspaces.request(`/${id}/invites`, { headers })).status).toBe(403);
    expect(mocks.listInvites).not.toHaveBeenCalled();
  });
  it("shows member emails to managers and only the current email to members", async () => {
    mocks.listMembers.mockResolvedValue([
      { userId: "member", email: "member@example.test", role: "member" },
      { userId: "owner", email: "owner@example.test", role: "manager" },
    ]);
    let response = await workspaces.request(`/${id}/members`, { headers });
    expect(await response.json()).toEqual([
      expect.objectContaining({ userId: "member", email: "member@example.test" }),
      expect.objectContaining({ userId: "owner", email: "" }),
    ]);
    mocks.workspaceAccess.mockResolvedValue({ role: "manager", ownerUserId: "owner", kind: "team" });
    response = await workspaces.request(`/${id}/members`, { headers });
    expect((await response.json()).map((item: { email: string }) => item.email)).toEqual(["member@example.test", "owner@example.test"]);
  });
  it("binds acceptance to verified Auth email, never body or metadata", async () => {
    mocks.acceptInvite.mockResolvedValue({ id });
    const code = "a".repeat(43);
    expect((await post("/join", { code })).status).toBe(200);
    expect(mocks.acceptInvite).toHaveBeenCalledWith("member", "member@example.test", code);
    expect((await post("/join", { code, email: "owner@example.test" })).status).toBe(400);
    mocks.getUser.mockResolvedValue({ data: { user: { id: "member", email: "member@example.test", user_metadata: { email_confirmed_at: "yes" } } }, error: null });
    expect((await post("/join", { code })).status).toBe(403);
  });
  it("rejects unknown member properties and invalid timezones", async () => {
    expect((await post(`/${id}/members/member`, { ownerUserId: "member" }, "PATCH")).status).toBe(400);
    expect((await post("/", { name: "Company", kind: "team", timezone: "not-a-zone" })).status).toBe(400);
    expect(mocks.updateMember).not.toHaveBeenCalled();
    expect(mocks.createWorkspace).not.toHaveBeenCalled();
  });
  it("creates team workspaces only while preserving legacy personal records", async () => {
    expect((await post("/", { name: "Company", kind: "personal", timezone: "UTC" })).status).toBe(400);
    expect(mocks.createWorkspace).not.toHaveBeenCalled();
    mocks.createWorkspace.mockResolvedValue({ id });
    expect((await post("/", { name: "Company", kind: "team", timezone: "UTC" })).status).toBe(201);
    expect(mocks.createWorkspace).toHaveBeenCalledWith("member", "member@example.test", "Company", "UTC", "team");
  });
  it("lets a legacy personal owner explicitly convert without copying data", async () => {
    mocks.convertPersonalWorkspaceToTeam.mockResolvedValue(true);
    expect((await post(`/${id}/convert-to-team`, {})).status).toBe(200);
    expect(mocks.convertPersonalWorkspaceToTeam).toHaveBeenCalledWith(id, "member");
  });
});
