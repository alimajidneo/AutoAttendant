import { beforeEach, expect, it, vi } from "vitest";
import { Hono } from "hono";

const mocks = vi.hoisted(() => ({
  exchange: vi.fn(), connect: vi.fn(), getLinkedEmployee: vi.fn(),
}));
vi.mock("@receptionist/core/providers/microsoftAuth.js", () => ({
  exchangeMicrosoftAuthorizationCode: mocks.exchange,
  connectMicrosoftCalendarAccount: mocks.connect,
}));
vi.mock("@receptionist/core/repositories/calcom.js", () => ({ getLinkedEmployee: mocks.getLinkedEmployee }));
vi.mock("@receptionist/core/env.js", () => ({ env: { TOKEN_ENCRYPTION_KEY: "34".repeat(32) } }));
vi.mock("../../env.js", () => ({ env: { DASHBOARD_ORIGINS: ["https://deskroute.example"], PUBLIC_API_URL: "https://deskroute.example" } }));

import { microsoftOAuthCallback } from "./microsoft-oauth-callback.js";
import { createOAuthState, MICROSOFT_OAUTH_COOKIE } from "./oauth-state.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const employeeId = "22222222-2222-4222-8222-222222222222";
const userId = "member-user";
const verifier = "a".repeat(43);
const app = new Hono().route("/api/microsoft/oauth", microsoftOAuthCallback);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exchange.mockResolvedValue({ refreshToken: "private", account: { id: "account", email: "member@example.test", name: "Member" } });
  mocks.getLinkedEmployee.mockResolvedValue({ id: employeeId, memberUserId: userId });
});

function callback() {
  const state = createOAuthState(workspaceId, verifier, { employeeId, userId });
  return app.request(`/api/microsoft/oauth/callback?${new URLSearchParams({ state, code: "authorization-code" })}`, {
    headers: { Cookie: `${MICROSOFT_OAUTH_COOKIE}=${verifier}` },
  });
}

it("binds a Microsoft grant to the linked member employee", async () => {
  const response = await callback();
  expect(response.headers.get("location")).toContain("/employee?");
  expect(mocks.getLinkedEmployee).toHaveBeenCalledWith(workspaceId, userId, employeeId);
  expect(mocks.connect).toHaveBeenCalledWith(workspaceId, "private", { id: "account", email: "member@example.test", name: "Member" }, employeeId, userId);
});

it("returns a cancelled member authorization to employee self service", async () => {
  const state = createOAuthState(workspaceId, verifier, { employeeId, userId });
  const response = await app.request(`/api/microsoft/oauth/callback?${new URLSearchParams({ state, error: "access_denied" })}`, {
    headers: { Cookie: `${MICROSOFT_OAUTH_COOKIE}=${verifier}` },
  });
  expect(response.headers.get("location")).toContain("/employee?");
  expect(response.headers.get("location")).toContain("calendar=error");
  expect(mocks.exchange).not.toHaveBeenCalled();
});

it("rejects the callback if the member was unlinked during authorization", async () => {
  mocks.getLinkedEmployee.mockResolvedValue(null);
  const response = await callback();
  expect(response.headers.get("location")).toContain("calendar=error");
  expect(mocks.exchange).not.toHaveBeenCalled();
  expect(mocks.connect).not.toHaveBeenCalled();
});
