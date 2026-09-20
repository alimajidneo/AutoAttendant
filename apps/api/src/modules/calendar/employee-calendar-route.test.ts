import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../types.js";

const mocks = vi.hoisted(() => ({
  getEmployeeCalcomSelf: vi.fn(),
}));
vi.mock("@receptionist/core/repositories/calcom.js", () => ({
  ...mocks,
  getEmployeeCalcomSelf: mocks.getEmployeeCalcomSelf,
}));
vi.mock("@receptionist/core/providers/googleAuth.js", () => ({ googleConnectionConfigured: () => true }));
vi.mock("@receptionist/core/providers/microsoftAuth.js", () => ({ microsoftConnectionConfigured: () => true }));
vi.mock("@receptionist/core/env.js", () => ({ env: {
  GOOGLE_CLIENT_ID: "google-client", MICROSOFT_CLIENT_ID: "microsoft-client", TOKEN_ENCRYPTION_KEY: "34".repeat(32),
} }));
vi.mock("../../env.js", () => ({ env: { PUBLIC_API_URL: "https://deskroute.example" } }));

import { employeeCalcom } from "../calcom/employee-route.js";
import { readOAuthState } from "./oauth-state.js";

const agentId = "11111111-1111-4111-8111-111111111111";
const employeeId = "22222222-2222-4222-8222-222222222222";
const userId = "member-user";
const app = new Hono<AppEnv>()
  .use("*", async (c, next) => {
    c.set("agentId", agentId);
    c.set("authUser", { id: userId } as AppEnv["Variables"]["authUser"]);
    await next();
  })
  .route("/employee", employeeCalcom);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmployeeCalcomSelf.mockResolvedValue({ id: employeeId, displayName: "Member", connection: null,
    directConnections: [{ id: "own", employeeId, provider: "google", accountEmail: "member@example.test", accountName: "Member" }] });
});

describe("member direct-calendar self service", () => {
  it("lists only the linked employee's accounts and provider readiness", async () => {
    const response = await app.request("/employee");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      directCalendars: {
        providers: { google: true, microsoft: true },
        connections: [{ id: "own", provider: "google", accountEmail: "member@example.test" }],
      },
    });
  });

  it.each([
    ["google", "/employee/calendar/oauth/google/start", "https://accounts.google.com/"],
    ["microsoft", "/employee/calendar/oauth/microsoft/start", "https://login.microsoftonline.com/"],
  ])("binds %s authorization to the current member and linked employee", async (_provider, path, origin) => {
    const response = await app.request(path);
    expect(response.status).toBe(200);
    const url = new URL((await response.json()).url);
    expect(url.href.startsWith(origin)).toBe(true);
    const cookie = response.headers.get("set-cookie")!;
    const verifier = cookie.split(";")[0]!.split("=")[1]!;
    expect(readOAuthState(url.searchParams.get("state")!, verifier)).toMatchObject({ agentId, employeeId, userId });
  });

  it("rejects calendar authorization until a manager links the member to an employee", async () => {
    mocks.getEmployeeCalcomSelf.mockResolvedValue(null);
    expect((await app.request("/employee/calendar/oauth/google/start")).status).toBe(404);
    expect((await app.request("/employee/calendar/oauth/microsoft/start")).status).toBe(404);
  });
});
