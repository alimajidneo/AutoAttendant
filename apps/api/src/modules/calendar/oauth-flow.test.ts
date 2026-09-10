import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../types.js";

const mocks = vi.hoisted(() => ({
  exchangeGoogleAuthorizationCode: vi.fn(), connectGoogleCalendarAccount: vi.fn(),
  googleConnectionConfigured: vi.fn(() => true), getCalendarConnectionTokens: vi.fn(),
  listCalendars: vi.fn(), updateAgent: vi.fn(), getAgentById: vi.fn(), deleteCalendarConnection: vi.fn(),
}));
vi.mock("@receptionist/core/providers/googleAuth.js", () => mocks);
vi.mock("@receptionist/core/providers/microsoftAuth.js", () => ({ microsoftConnectionConfigured: vi.fn(() => false) }));
vi.mock("@receptionist/core/providers/microsoftCalendar.js", () => ({ MicrosoftCalendarScopeMissingError: class extends Error {} }));
vi.mock("@receptionist/core/providers/calendarAccess.js", () => ({ getAllCalendarConnectionTokens: mocks.getCalendarConnectionTokens }));
vi.mock("@receptionist/core/providers/calendarProvider.js", () => ({ listProviderCalendars: (_provider: string, token: string) => mocks.listCalendars(token) }));
vi.mock("@receptionist/core/repositories/agents.js", () => mocks);
vi.mock("@receptionist/core/repositories/calendar-connections.js", () => mocks);
vi.mock("@receptionist/core/providers/calendar.js", () => ({ ...mocks, CalendarScopeMissingError: class extends Error {} }));
vi.mock("@receptionist/core/env.js", () => ({ env: { GOOGLE_CLIENT_ID: "client", TOKEN_ENCRYPTION_KEY: "34".repeat(32) } }));
vi.mock("../../env.js", () => ({ env: { DASHBOARD_ORIGINS: ["https://deskroute.example"], PUBLIC_API_URL: "https://deskroute.example" } }));

import { calendar } from "./route.js";
import { calendarOAuthCallback } from "./oauth-callback.js";
import { OAUTH_COOKIE, oauthChallenge } from "./oauth-state.js";
import { CalendarScopeMissingError } from "@receptionist/core/providers/calendar.js";

const owner = "11111111-1111-4111-8111-111111111111";
const connectionA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const connectionB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const app = new Hono<AppEnv>()
  .route("/api/calendar/oauth", calendarOAuthCallback)
  .use("/api/admin/*", async (c, next) => { c.set("agentId", owner); c.set("workspaceOwner", true); await next(); })
  .route("/api/admin/calendar", calendar);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exchangeGoogleAuthorizationCode.mockResolvedValue({ refreshToken: "private", account: { sub: "google-owner" } });
});

async function begin() {
  const response = await app.request("/api/admin/calendar/oauth/start");
  const url = new URL((await response.json()).url);
  const cookie = response.headers.get("set-cookie")!;
  const verifier = cookie.split(";")[0]!.split("=")[1]!;
  return { response, url, cookie, verifier };
}

function callback(state: string, cookie?: string) {
  return app.request(`/api/calendar/oauth/callback?${new URLSearchParams({ state, code: "authorization-code" })}`, {
    headers: cookie ? { Cookie: cookie.split(";")[0]! } : {},
  });
}

describe("browser-bound Google connection", () => {
  it("sets a private expiring cookie and sends only its hash to Google", async () => {
    const { response, url, cookie, verifier } = await begin();
    expect(cookie).toContain(`${OAUTH_COOKIE}=`);
    for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Max-Age=600", "Path=/api/calendar/oauth"]) expect(cookie).toContain(flag);
    expect(url.searchParams.get("code_challenge")).toBe(oauthChallenge(verifier));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.toString()).not.toContain(verifier);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("exchanges and saves only in the browser that began the flow", async () => {
    const { url, cookie, verifier } = await begin();
    const result = await callback(url.searchParams.get("state")!, cookie);
    expect(result.headers.get("location")).toContain("calendar=connected");
    expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(mocks.exchangeGoogleAuthorizationCode).toHaveBeenCalledWith("authorization-code", "https://deskroute.example/api/calendar/oauth/callback", verifier);
    expect(mocks.connectGoogleCalendarAccount).toHaveBeenCalledWith(owner, "private", { sub: "google-owner" });
  });

  it("rejects a copied authorization link opened in another browser", async () => {
    const first = await begin();
    const second = await begin();
    for (const cookie of [undefined, second.cookie]) {
      const result = await callback(first.url.searchParams.get("state")!, cookie);
      expect(result.headers.get("location")).toContain("calendar=error");
    }
    expect(mocks.exchangeGoogleAuthorizationCode).not.toHaveBeenCalled();
    expect(mocks.connectGoogleCalendarAccount).not.toHaveBeenCalled();
  });

  it("does not expose a provider error in the redirect", async () => {
    const { url, cookie } = await begin();
    mocks.exchangeGoogleAuthorizationCode.mockRejectedValueOnce(new Error("PRIVATE TOKEN"));
    const result = await callback(url.searchParams.get("state")!, cookie);
    expect(result.headers.get("location")).not.toContain("PRIVATE");
  });
});

describe("calendar selection boundaries", () => {
  it("does not expose encrypted credentials and flags invalid permissions", async () => {
    mocks.getCalendarConnectionTokens.mockResolvedValue([{
      row: { id: connectionA, accountEmail: "owner@example.com", accountName: "Owner", encryptedRefreshToken: "PRIVATE" }, token: "SECRET",
    }]);
    mocks.listCalendars.mockRejectedValueOnce(new CalendarScopeMissingError());
    const result = await app.request("/api/admin/calendar/list");
    const body = await result.json();
    expect(body.connections[0].reconnectRequired).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE|SECRET/);
  });

  it("rejects a calendar connection belonging to a different owner", async () => {
    mocks.getCalendarConnectionTokens.mockResolvedValue([{ row: { id: connectionA }, token: "token-a" }]);
    mocks.listCalendars.mockResolvedValue([{ id: "calendar", writable: true }]);
    const result = await app.request("/api/admin/calendar", { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ booking: { connectionId: connectionB, calendarId: "calendar" }, conflicts: [] }),
    });
    expect(result.status).toBe(400);
    expect(mocks.updateAgent).not.toHaveBeenCalled();
    expect(mocks.getCalendarConnectionTokens).toHaveBeenCalledWith(owner);
  });
});
