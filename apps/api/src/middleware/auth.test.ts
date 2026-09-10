import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../types.js";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), listWorkspaces: vi.fn(), workspaceAccess: vi.fn() }));
vi.mock("@receptionist/core/providers/supabase.js", () => ({ supabase: { auth: { getUser: mocks.getUser } } }));
vi.mock("@receptionist/core/repositories/workspaces.js", () => mocks);
import { authenticate, requireAgent, requireManager } from "./auth.js";
import { requireCalendarOwner } from "./calendar-owner.js";
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const app = new Hono<AppEnv>().use(authenticate).use(requireAgent)
  .get("/", c => c.json({ agentId: c.get("agentId") }))
  .get("/manager", requireManager, c => c.json({ ok: true }))
  .get("/calendar", requireCalendarOwner, c => c.json({ ok: true }));
const headers = { Authorization: "Bearer verified" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-a" } }, error: null });
  mocks.listWorkspaces.mockResolvedValue([{ id }]);
  mocks.workspaceAccess.mockResolvedValue({ role: "manager", ownerUserId: "owner-a" });
});
describe("workspace authentication", () => {
  it("rejects missing credentials", async () => {
    expect((await app.request("/")).status).toBe(401);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.listWorkspaces).not.toHaveBeenCalled();
  });
  it.each(["invalid", "expired", "anonymous"])("rejects %s sessions", async kind => {
    mocks.getUser.mockResolvedValue(kind === "anonymous" ? { data: { user: { id: "a", is_anonymous: true } }, error: null } : { data: { user: null }, error: new Error(kind) });
    expect((await app.request("/", { headers })).status).toBe(401);
    expect(mocks.workspaceAccess).not.toHaveBeenCalled();
  });
  it("defaults to a membership and ignores agent query parameters", async () => {
    const response = await app.request(`/?agentId=${other}`, { headers });
    expect(await response.json()).toEqual({ agentId: id });
    expect(mocks.getUser).toHaveBeenCalledWith("verified");
    expect(mocks.workspaceAccess).toHaveBeenCalledWith(id, "owner-a");
  });
  it("checks a selected workspace against current membership", async () => {
    expect((await app.request("/", { headers: { ...headers, "X-Workspace-Id": other } })).status).toBe(200);
    expect(mocks.workspaceAccess).toHaveBeenCalledWith(other, "owner-a");
    mocks.workspaceAccess.mockResolvedValue(null);
    expect((await app.request("/", { headers: { ...headers, "X-Workspace-Id": other } })).status).toBe(403);
  });
  it("rejects malformed workspace headers", async () => {
    expect((await app.request("/", { headers: { ...headers, "X-Workspace-Id": "invalid" } })).status).toBe(400);
    expect(mocks.workspaceAccess).not.toHaveBeenCalled();
  });
  it("denies member access to business records regardless of user metadata", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "member", user_metadata: { role: "manager" } } }, error: null });
    mocks.workspaceAccess.mockResolvedValue({ role: "member", ownerUserId: "owner-a" });
    expect((await app.request("/manager", { headers })).status).toBe(403);
    expect((await app.request("/calendar", { headers })).status).toBe(403);
  });
  it("allows a manager to configure the business but keeps owner calendars private", async () => {
    mocks.workspaceAccess.mockResolvedValue({ role: "manager", ownerUserId: "different-owner" });
    expect((await app.request("/manager", { headers })).status).toBe(200);
    expect((await app.request("/calendar", { headers })).status).toBe(403);
  });
});
