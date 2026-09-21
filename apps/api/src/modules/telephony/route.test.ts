import { beforeEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../types.js";

const mocks = vi.hoisted(() => ({ getAgentById: vi.fn(), listPhoneNumbers: vi.fn(),
  removePhoneNumber: vi.fn(), addPhoneNumber: vi.fn(), releasePhoneNumber: vi.fn(),
  searchPhoneNumbers: vi.fn(), purchasePhoneNumber: vi.fn() }));
vi.mock("@receptionist/core/repositories/agents.js", () => mocks);
vi.mock("@receptionist/core/providers/telephony.js", () => ({ ...mocks, InvalidAreaCode: class extends Error {} }));

import { telephony } from "./route.js";
const app = new Hono<AppEnv>()
  .use("*", async (c, next) => { c.set("agentId", "workspace"); await next(); })
  .route("/", telephony);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAgentById.mockResolvedValue({ id: "workspace" });
  mocks.listPhoneNumbers.mockResolvedValue([{ e164: "+15550001111" }]);
});

it("keeps a phone number visible if the provider could not release it", async () => {
  mocks.releasePhoneNumber.mockRejectedValue(new Error("provider unavailable"));
  expect((await app.request("/", { method: "DELETE" })).status).toBe(500);
  expect(mocks.removePhoneNumber).not.toHaveBeenCalled();
});

it("removes a phone number only after its provider release succeeds", async () => {
  mocks.releasePhoneNumber.mockResolvedValue(undefined);
  expect((await app.request("/", { method: "DELETE" })).status).toBe(200);
  expect(mocks.releasePhoneNumber).toHaveBeenCalledWith("+15550001111");
  expect(mocks.removePhoneNumber).toHaveBeenCalledWith("workspace", "+15550001111");
});
