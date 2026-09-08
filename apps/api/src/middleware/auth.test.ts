import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../types.js";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), resolveAgentByAuthUserId: vi.fn() }));
vi.mock("@receptionist/core/providers/supabase.js", () => ({ supabase: { auth: { getUser: mocks.getUser } } }));
vi.mock("@receptionist/core/repositories/agents.js", () => mocks);
import { authenticate, requireAgent } from "./auth.js";
const app = new Hono<AppEnv>().use(authenticate).use(requireAgent).get("/", c => c.json({ agentId: c.get("agentId") }));
beforeEach(() => vi.resetAllMocks());
describe("owner authentication", () => {
  it("rejects missing credentials before looking up a business", async () => {
    expect((await app.request("/")).status).toBe(401);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.resolveAgentByAuthUserId).not.toHaveBeenCalled();
  });
  it.each(["invalid", "expired", "anonymous"])("rejects %s sessions", async (kind) => {
    mocks.getUser.mockResolvedValue(kind === "anonymous" ? { data: { user: { id: "a", is_anonymous: true } }, error: null } : { data: { user: null }, error: new Error(kind) });
    expect((await app.request("/", { headers: { Authorization: `Bearer ${kind}` } })).status).toBe(401);
    expect(mocks.resolveAgentByAuthUserId).not.toHaveBeenCalled();
  });
  it("uses only the verified user id, ignoring a requested agent id", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-a" } }, error: null });
    mocks.resolveAgentByAuthUserId.mockResolvedValue({ id: "business-a" });
    const response = await app.request("/?agentId=business-b", { headers: { Authorization: "Bearer verified" } });
    expect(await response.json()).toEqual({ agentId: "business-a" });
    expect(mocks.getUser).toHaveBeenCalledWith("verified");
    expect(mocks.resolveAgentByAuthUserId).toHaveBeenCalledWith("owner-a");
  });
});
