import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getGoogleCredentials: vi.fn(), saveGoogleCredentials: vi.fn(), deleteGoogleCredentials: vi.fn() }));
vi.mock("../repositories/google-credentials.js", () => mocks);
vi.mock("../env.js", () => ({ env: { GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", TOKEN_ENCRYPTION_KEY: "12".repeat(32) } }));
import { connectGoogleCredentials, getGoogleOAuthToken, GoogleReconnectRequired } from "./googleAuth.js";
import { encryptToken, decryptToken } from "./token-encryption.js";
const request = vi.fn();
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", request); });
afterEach(() => vi.unstubAllGlobals());
describe("durable Google Calendar access", () => {
  it("returns no token for an unconnected owner", async () => {
    mocks.getGoogleCredentials.mockResolvedValue(null);
    expect(await getGoogleOAuthToken("a")).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
  it("renews stored credentials without a dashboard session", async () => {
    mocks.getGoogleCredentials.mockResolvedValue({ encryptedRefreshToken: encryptToken("refresh", "a", "12".repeat(32)) });
    request.mockResolvedValue(response({ access_token: "renewed" }));
    expect(await getGoogleOAuthToken("a")).toBe("renewed");
    expect(request.mock.calls[0][1].body.get("refresh_token")).toBe("refresh");
  });
  it("requires reconnect after Google revokes the grant", async () => {
    mocks.getGoogleCredentials.mockResolvedValue({ encryptedRefreshToken: encryptToken("refresh", "a", "12".repeat(32)) });
    request.mockResolvedValue(response({ error: "invalid_grant" }, 400));
    expect(await getGoogleOAuthToken("a")).toBeNull();
  });
  it("rejects credentials from a different Google identity", async () => {
    request.mockResolvedValueOnce(response({ access_token: "token" })).mockResolvedValueOnce(response({ sub: "other" }));
    await expect(connectGoogleCredentials("a", "expected", "refresh")).rejects.toBeInstanceOf(GoogleReconnectRequired);
    expect(mocks.saveGoogleCredentials).not.toHaveBeenCalled();
  });
  it("rejects a partial Calendar grant", async () => {
    request.mockResolvedValueOnce(response({ access_token: "token" })).mockResolvedValueOnce(response({ sub: "expected" })).mockResolvedValueOnce(response({ aud: "test-client", scope: "openid" }));
    await expect(connectGoogleCredentials("a", "expected", "refresh")).rejects.toBeInstanceOf(GoogleReconnectRequired);
    expect(mocks.saveGoogleCredentials).not.toHaveBeenCalled();
  });
  it("stores an encrypted credential only after identity and permissions are verified", async () => {
    request.mockResolvedValueOnce(response({ access_token: "token" })).mockResolvedValueOnce(response({ sub: "expected" })).mockResolvedValueOnce(response({ aud: "test-client", scope: ["calendar.events", "calendar.calendarlist.readonly", "calendar.freebusy"].map(s => `https://www.googleapis.com/auth/${s}`).join(" ") }));
    await connectGoogleCredentials("a", "expected", "refresh");
    const stored = mocks.saveGoogleCredentials.mock.calls[0];
    expect(stored.slice(0, 2)).toEqual(["a", "expected"]);
    expect(decryptToken(stored[2], "a", "12".repeat(32))).toBe("refresh");
  });
});
