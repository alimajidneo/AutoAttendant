import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const mocks = vi.hoisted(() => ({
  userId: "owner-test" as string | null,
  createAgent: vi.fn(),
  resolveAgentByAuthUserId: vi.fn(),
  addPhoneNumber: vi.fn(),
  replaceServices: vi.fn(),
  purchasePhoneNumber: vi.fn(),
  releasePhoneNumber: vi.fn(),
}));

vi.mock("@receptionist/core/providers/supabase.js", () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: mocks.userId ? { id: mocks.userId } : null }, error: null }) } },
}));
vi.mock("@receptionist/core/repositories/agents.js", () => mocks);
vi.mock("@receptionist/core/repositories/services.js", () => mocks);
vi.mock("@receptionist/core/providers/telephony.js", () => ({
  ...mocks,
  searchPhoneNumbers: vi.fn(),
  InvalidAreaCode: class extends Error {},
}));

import { onboarding } from "./route.js";

const app = new Hono().route("/onboarding", onboarding);
const profile = { name: "Ali", industry: "Personal", timezone: "Asia/Karachi" };
const submit = (body: object) => app.request("/onboarding", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer test-session" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.userId = "owner-test";
  mocks.resolveAgentByAuthUserId.mockResolvedValue(null);
  mocks.createAgent.mockResolvedValue({ id: "agent-test" });
  mocks.purchasePhoneNumber.mockResolvedValue({ e164_format: "+14155550123" });
});

describe("browser-first onboarding", () => {
  it("creates an authenticated attendant without contacting the phone provider", async () => {
    const response = await submit(profile);
    expect(response.status).toBe(200);
    expect(mocks.createAgent).toHaveBeenCalledWith(expect.objectContaining({
      authUserId: "owner-test", businessName: "Ali", timezone: "Asia/Karachi",
    }));
    expect(mocks.purchasePhoneNumber).not.toHaveBeenCalled();
    expect(mocks.addPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.releasePhoneNumber).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated setup without writes or purchases", async () => {
    mocks.userId = null;
    expect((await submit(profile)).status).toBe(401);
    expect(mocks.createAgent).not.toHaveBeenCalled();
    expect(mocks.purchasePhoneNumber).not.toHaveBeenCalled();
  });

  it("rejects an existing owner's second setup", async () => {
    mocks.resolveAgentByAuthUserId.mockResolvedValue({ id: "existing" });
    expect((await submit(profile)).status).toBe(409);
    expect(mocks.createAgent).not.toHaveBeenCalled();
    expect(mocks.purchasePhoneNumber).not.toHaveBeenCalled();
  });

  it("preserves explicit phone provisioning for existing API clients", async () => {
    expect((await submit({ ...profile, phoneNumber: "+14155550123" })).status).toBe(200);
    expect(mocks.purchasePhoneNumber).toHaveBeenCalledWith("+14155550123");
    expect(mocks.addPhoneNumber).toHaveBeenCalledWith({
      agentId: "agent-test", e164: "+14155550123", provider: "livekit",
    });
  });

  it("rejects blank names and invalid timezones before creating an attendant", async () => {
    expect((await submit({ ...profile, name: "   " })).status).toBe(400);
    expect((await submit({ ...profile, timezone: "invalid/zone" })).status).toBe(400);
    expect(mocks.createAgent).not.toHaveBeenCalled();
  });
});
