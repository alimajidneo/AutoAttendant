import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../types.js";

const mocks = vi.hoisted(() => ({
  getEmployeeCalcomSelf: vi.fn(),
  getLinkedEmployee: vi.fn(),
  saveCalcomOAuthGrant: vi.fn(),
  startCalcomOAuthState: vi.fn(),
  consumeCalcomOAuthState: vi.fn(),
  invalidateCalcomOAuthStates: vi.fn(),
  reconcileCalcomOAuthSetup: vi.fn(),
  disconnectEmployeeCalcom: vi.fn(),
  exchangeCalcomAuthorizationCode: vi.fn(),
  calcomOAuthConfigured: vi.fn(() => true),
}));
vi.mock("@receptionist/core/repositories/calcom.js", () => mocks);
vi.mock("@receptionist/core/providers/googleAuth.js", () => ({ googleConnectionConfigured: () => true }));
vi.mock("@receptionist/core/providers/microsoftAuth.js", () => ({ microsoftConnectionConfigured: () => true }));
vi.mock("@receptionist/core/providers/calcom.js", async importOriginal => ({
  ...await importOriginal<typeof import("@receptionist/core/providers/calcom.js")>(),
  exchangeCalcomAuthorizationCode: mocks.exchangeCalcomAuthorizationCode,
  calcomOAuthConfigured: mocks.calcomOAuthConfigured,
}));
vi.mock("@receptionist/core/env.js", () => ({ env: {
  CALCOM_OAUTH_CLIENT_ID: "deskroute-client", CALCOM_OAUTH_WRITE_APPROVED: true,
  CALCOM_WEBHOOK_SECRET: "w".repeat(32), TOKEN_ENCRYPTION_KEY: "34".repeat(32),
} }));
vi.mock("../../env.js", () => ({ env: { DASHBOARD_ORIGINS: ["https://deskroute.example"], PUBLIC_API_URL: "https://api.deskroute.example" } }));

import { employeeCalcom } from "./employee-route.js";
import { calcomOAuthCallback } from "./oauth-callback.js";
import { CALCOM_OAUTH_COOKIE } from "./oauth-state.js";
import { env as coreEnv } from "@receptionist/core/env.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const employeeId = "22222222-2222-4222-8222-222222222222";
const connectionId = "33333333-3333-4333-8333-333333333333";
const employee = { id: employeeId, displayName: "Thomas", memberUserId: "thomas", connection: null };

const app = new Hono<AppEnv>()
  .route("/api/calcom/oauth", calcomOAuthCallback)
  .use("/api/admin/employee/*", async (c, next) => {
    c.set("agentId", workspaceId); c.set("workspaceRole", "member"); c.set("workspaceOwner", false);
    c.set("authUser", { id: "thomas", email: "thomas@example.test", email_confirmed_at: "2026-01-01",
      app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01" });
    await next();
  })
  .route("/api/admin/employee", employeeCalcom);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calcomOAuthConfigured.mockReturnValue(true);
  mocks.getEmployeeCalcomSelf.mockResolvedValue(employee);
  mocks.getLinkedEmployee.mockResolvedValue(employee);
  mocks.startCalcomOAuthState.mockImplementation(async (_workspaceId, _employeeId, _userId, stateHash, browserChallengeHash) => ({
    stateHash, browserChallengeHash, intent: "connect", startingConnectionId: null, startingProviderUserId: null, startingLifecycleGeneration: null,
  }));
  mocks.exchangeCalcomAuthorizationCode.mockResolvedValue({
    tokens: { accessToken: "ACCESS", refreshToken: "REFRESH", expiresAt: Date.now() + 3600_000 },
    account: { id: 42, email: "thomas@cal.example", username: "thomas" },
  });
  mocks.saveCalcomOAuthGrant.mockResolvedValue({ id: connectionId });
  mocks.reconcileCalcomOAuthSetup.mockResolvedValue({ ready: true });
});

async function begin() {
  const response = await app.request("/api/admin/employee/calcom/oauth/start");
  const body = await response.json() as { url: string };
  const url = new URL(body.url);
  const cookie = response.headers.get("set-cookie")!;
  const browserChallenge = cookie.split(";")[0]!.split("=")[1]!;
  return { response, url, cookie, browserChallenge };
}

describe("employee self-service Cal.com OAuth", () => {
  it("returns clear readiness without credentials and reports missing server configuration", async () => {
    mocks.getEmployeeCalcomSelf.mockResolvedValue({ ...employee, connection: { id: connectionId, ready: false, status: "setup_required", encryptedCredential: "PRIVATE" } });
    let response = await app.request("/api/admin/employee");
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("PRIVATE");
    mocks.calcomOAuthConfigured.mockReturnValue(false);
    response = await app.request("/api/admin/employee/calcom/oauth/start");
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("not configured");
  });

  it("fails self-service closed on the explicit write-approval gate before storing state", async () => {
    coreEnv.CALCOM_OAUTH_WRITE_APPROVED = false;
    try {
      const readiness = await app.request("/api/admin/employee");
      expect(await readiness.json()).toMatchObject({ configured: false });
      expect((await app.request("/api/admin/employee/calcom/oauth/start")).status).toBe(503);
      expect(mocks.startCalcomOAuthState).not.toHaveBeenCalled();
    } finally { coreEnv.CALCOM_OAUTH_WRITE_APPROVED = true; }
  });

  it("fails an already-started callback closed if write approval is withdrawn before exchange", async () => {
    const { url, cookie } = await begin();
    mocks.consumeCalcomOAuthState.mockResolvedValueOnce({ agentId: workspaceId, employeeId, userId: "thomas", intent: "connect",
      startingConnectionId: null, startingProviderUserId: null, startingLifecycleGeneration: null });
    coreEnv.CALCOM_OAUTH_WRITE_APPROVED = false;
    try {
      const response = await app.request(`/api/calcom/oauth/callback?${new URLSearchParams({ state: url.searchParams.get("state")!, code: "provider-code" })}`, {
        headers: { Cookie: cookie.split(";")[0]! },
      });
      expect(response.headers.get("location")).toContain("calcom=error");
      expect(mocks.exchangeCalcomAuthorizationCode).not.toHaveBeenCalled();
    } finally { coreEnv.CALCOM_OAUTH_WRITE_APPROVED = true; }
  });

  it("uses Cal.com standard confidential authorize URL with an expiring browser-binding cookie and durable opaque state", async () => {
    const { response, url, cookie } = await begin();
    expect(url.origin + url.pathname).toBe("https://app.cal.com/auth/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("deskroute-client");
    expect(url.searchParams.get("redirect_uri")).toBe("https://api.deskroute.example/api/calcom/oauth/callback");
    expect(url.searchParams.get("scope")).toBe("READ_PROFILE,READ_BOOKING");
    expect(url.searchParams.has("code_challenge")).toBe(false);
    expect(url.searchParams.has("code_challenge_method")).toBe(false);
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.startCalcomOAuthState).toHaveBeenCalledOnce();
    expect(mocks.startCalcomOAuthState.mock.calls[0]).not.toContain(url.searchParams.get("state"));
    expect(mocks.startCalcomOAuthState.mock.calls[0]).not.toContain(cookie.split(";")[0]!.split("=")[1]!);
    for (const flag of [CALCOM_OAUTH_COOKIE, "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=600", "Path=/api/calcom/oauth"]) expect(cookie).toContain(flag);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts the callback only for the linked member browser and performs setup once", async () => {
    const { url, cookie } = await begin();
    mocks.consumeCalcomOAuthState.mockResolvedValueOnce({ agentId: workspaceId, employeeId, userId: "thomas", intent: "connect",
      startingConnectionId: null, startingProviderUserId: null, startingLifecycleGeneration: null });
    const response = await app.request(`/api/calcom/oauth/callback?${new URLSearchParams({ state: url.searchParams.get("state")!, code: "provider-code" })}`, {
      headers: { Cookie: cookie.split(";")[0]! },
    });
    expect(response.headers.get("location")).toContain("calcom=connected");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(mocks.getLinkedEmployee).toHaveBeenCalledWith(workspaceId, "thomas", employeeId);
    expect(mocks.exchangeCalcomAuthorizationCode).toHaveBeenCalledWith("provider-code", "https://api.deskroute.example/api/calcom/oauth/callback");
    expect(mocks.saveCalcomOAuthGrant).toHaveBeenCalledWith(workspaceId, employeeId, "thomas", expect.any(Object), expect.objectContaining({ id: 42 }), expect.objectContaining({ intent: "connect" }));
    expect(mocks.invalidateCalcomOAuthStates).toHaveBeenCalledWith(workspaceId, employeeId);
    expect(mocks.reconcileCalcomOAuthSetup).toHaveBeenCalledWith(workspaceId, employeeId, connectionId, "https://api.deskroute.example/api/calcom/webhooks/33333333-3333-4333-8333-333333333333", "thomas");
    mocks.consumeCalcomOAuthState.mockResolvedValueOnce(null);
    await app.request(`/api/calcom/oauth/callback?${new URLSearchParams({ state: url.searchParams.get("state")!, code: "replay-code" })}`, {
      headers: { Cookie: cookie.split(";")[0]! },
    });
    expect(mocks.exchangeCalcomAuthorizationCode).toHaveBeenCalledOnce();
  });

  it("rejects copied state and a removed employee link before provider exchange", async () => {
    const first = await begin(); const second = await begin();
    mocks.consumeCalcomOAuthState.mockResolvedValueOnce(null);
    let response = await app.request(`/api/calcom/oauth/callback?${new URLSearchParams({ state: first.url.searchParams.get("state")!, code: "provider-code" })}`, {
      headers: { Cookie: second.cookie.split(";")[0]! },
    });
    expect(response.headers.get("location")).toContain("calcom=error");
    mocks.consumeCalcomOAuthState.mockResolvedValueOnce({ agentId: workspaceId, employeeId, userId: "thomas", intent: "connect",
      startingConnectionId: null, startingProviderUserId: null, startingLifecycleGeneration: null });
    mocks.getLinkedEmployee.mockResolvedValue(null);
    response = await app.request(`/api/calcom/oauth/callback?${new URLSearchParams({ state: second.url.searchParams.get("state")!, code: "provider-code" })}`, {
      headers: { Cookie: second.cookie.split(";")[0]! },
    });
    expect(response.headers.get("location")).toContain("calcom=error");
    expect(mocks.exchangeCalcomAuthorizationCode).not.toHaveBeenCalled();
  });

  it("scopes reconciliation and disconnect to the authenticated member link", async () => {
    mocks.getEmployeeCalcomSelf.mockResolvedValue({ ...employee, connection: { id: connectionId, authKind: "oauth" } });
    expect((await app.request("/api/admin/employee/calcom/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(200);
    expect(mocks.reconcileCalcomOAuthSetup).toHaveBeenCalledWith(workspaceId, employeeId, connectionId, expect.stringContaining(connectionId), "thomas");
    expect((await app.request("/api/admin/employee/calcom", { method: "DELETE" })).status).toBe(200);
    expect(mocks.disconnectEmployeeCalcom).toHaveBeenCalledWith(workspaceId, "thomas", employeeId, connectionId,
      `https://api.deskroute.example/api/calcom/webhooks/${connectionId}`);
    mocks.getEmployeeCalcomSelf.mockResolvedValue(null);
    expect((await app.request("/api/admin/employee/calcom", { method: "DELETE" })).status).toBe(404);
  });

  it("does not accept an employee ID on self-service routes", async () => {
    expect((await app.request(`/api/admin/employee/calcom/oauth/start?employeeId=${employeeId}`)).status).toBe(400);
    expect((await app.request("/api/admin/employee/calcom/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId }) })).status).toBe(400);
    expect(mocks.reconcileCalcomOAuthSetup).not.toHaveBeenCalled();
  });
});
