import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptToken, decryptToken } from "./token-encryption.js";

const mocks = vi.hoisted(() => ({
  getCalendarConnection: vi.fn(),
  listCalendarConnections: vi.fn(),
  saveCalendarConnection: vi.fn(),
}));
vi.mock("../repositories/calendar-connections.js", () => mocks);
vi.mock("../env.js", () => ({ env: {
  GOOGLE_CLIENT_ID: "test-client",
  GOOGLE_CLIENT_SECRET: "test-secret",
  TOKEN_ENCRYPTION_KEY: "12".repeat(32),
} }));

import {
  connectGoogleCalendarAccount,
  exchangeGoogleAuthorizationCode,
  getCalendarConnectionToken,
  getAgentCalendarAccess,
  GoogleReconnectRequired,
} from "./googleAuth.js";

const request = vi.fn();
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", request); });
afterEach(() => vi.unstubAllGlobals());

describe("independent Google Calendar accounts", () => {
  it("renews the token with the connection's encryption owner", async () => {
    mocks.getCalendarConnection.mockResolvedValue({
      encryptedRefreshToken: encryptToken("refresh-2", "connection-2", "12".repeat(32)),
      id: "connection-2", provider: "google", encryptionOwner: "connection-2",
    });
    request.mockResolvedValue(response({ access_token: "renewed-2" }));
    expect(await getCalendarConnectionToken("agent-1", "connection-2")).toBe("renewed-2");
    expect(request.mock.calls[0][1].body.get("refresh_token")).toBe("refresh-2");
  });

  it("returns null after Google revokes one account", async () => {
    mocks.getCalendarConnection.mockResolvedValue({
      encryptedRefreshToken: encryptToken("revoked", "connection-3", "12".repeat(32)),
      id: "connection-3", provider: "google", encryptionOwner: "connection-3",
    });
    request.mockResolvedValue(response({ error: "invalid_grant" }, 400));
    expect(await getCalendarConnectionToken("agent-1", "connection-3")).toBeNull();
  });

  it("exchanges a server authorization code and verifies calendar scopes", async () => {
    request
      .mockResolvedValueOnce(response({ access_token: "access", refresh_token: "refresh",
        scope: ["calendar.events", "calendar.calendarlist.readonly", "calendar.freebusy"]
          .map(scope => `https://www.googleapis.com/auth/${scope}`).join(" "),
      }))
      .mockResolvedValueOnce(response({ sub: "google-2", email: "work@example.com", name: "Work Owner" }));
    await expect(exchangeGoogleAuthorizationCode("code", "http://localhost/callback", "verifier")).resolves.toEqual({
      refreshToken: "refresh",
      account: { sub: "google-2", email: "work@example.com", name: "Work Owner" },
    });
    expect(request.mock.calls[0]![1].body.get("code_verifier")).toBe("verifier");
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(call => call[0]).join(" ")).not.toContain("access_token=");
  });

  it("rejects a partial calendar grant", async () => {
    request
      .mockResolvedValueOnce(response({ access_token: "access", refresh_token: "refresh" }))
      .mockResolvedValueOnce(response({ sub: "google-2", email: "work@example.com" }))
      .mockResolvedValueOnce(response({ aud: "test-client", scope: "openid email" }));
    await expect(exchangeGoogleAuthorizationCode("code", "http://localhost/callback", "verifier"))
      .rejects.toBeInstanceOf(GoogleReconnectRequired);
  });

  it("encrypts each account using its own connection identifier", async () => {
    mocks.saveCalendarConnection.mockImplementation(async input => input);
    const stored = await connectGoogleCalendarAccount("agent-1", "refresh-4", {
      sub: "google-4", email: "four@example.com", name: null,
    });
    expect(stored.agentId).toBe("agent-1");
    expect(stored.accountEmail).toBe("four@example.com");
    expect(decryptToken(stored.encryptedRefreshToken, stored.encryptionOwner, "12".repeat(32)))
      .toBe("refresh-4");
  });
});

function connection(id: string, refresh = id) {
  return { id, provider: "google", encryptionOwner: id,
    encryptedRefreshToken: encryptToken(refresh, id, "12".repeat(32)) };
}

describe("cached credential boundaries", () => {
  it("does not return a cached token to a different owner", async () => {
    mocks.getCalendarConnection.mockResolvedValueOnce(connection("private-cache"));
    request.mockResolvedValue(response({ access_token: "private-token" }));
    expect(await getCalendarConnectionToken("owner-a", "private-cache")).toBe("private-token");
    mocks.getCalendarConnection.mockResolvedValueOnce(null);
    expect(await getCalendarConnectionToken("owner-b", "private-cache")).toBeNull();
    expect(mocks.getCalendarConnection).toHaveBeenLastCalledWith("owner-b", "private-cache");
  });

  it("stops using a cached credential after disconnection", async () => {
    mocks.getCalendarConnection.mockResolvedValueOnce(connection("removed-cache"));
    request.mockResolvedValue(response({ access_token: "removed-token" }));
    await getCalendarConnectionToken("owner-a", "removed-cache");
    mocks.getCalendarConnection.mockResolvedValueOnce(null);
    expect(await getCalendarConnectionToken("owner-a", "removed-cache")).toBeNull();
  });

  it("renews a reconnected credential without waiting for the old cache to expire", async () => {
    mocks.getCalendarConnection.mockResolvedValueOnce(connection("rotated-cache", "old"));
    request.mockResolvedValueOnce(response({ access_token: "old-token" }));
    await getCalendarConnectionToken("owner-a", "rotated-cache");
    mocks.getCalendarConnection.mockResolvedValueOnce(connection("rotated-cache", "new"));
    request.mockResolvedValueOnce(response({ access_token: "new-token" }));
    expect(await getCalendarConnectionToken("owner-a", "rotated-cache")).toBe("new-token");
  });
});

describe("selected cross-account access", () => {
  const payload = { bookingConnectionId: "booking", conflictCalendars: [
    { connectionId: "booking", id: "work" }, { connectionId: "personal", id: "home" },
  ] };

  it("uses one owner-scoped database list and refreshes only selected accounts", async () => {
    mocks.listCalendarConnections.mockResolvedValue([
      connection("booking"), connection("personal"), connection("unused"),
    ]);
    request.mockImplementation(async (_url, options) => response({ access_token: options.body.get("refresh_token") }));
    const access = await getAgentCalendarAccess("selection-owner", "work", payload);
    expect(access?.conflicts).toEqual([
      { connectionId: "booking", calendarIds: ["work"], token: "booking" },
      { connectionId: "personal", calendarIds: ["home"], token: "personal" },
    ]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(mocks.listCalendarConnections).toHaveBeenCalledWith("selection-owner");
    expect(mocks.getCalendarConnection).not.toHaveBeenCalled();
  });

  it("rejects a missing selected account instead of dropping its conflicts", async () => {
    mocks.listCalendarConnections.mockResolvedValue([connection("booking")]);
    request.mockResolvedValue(response({ access_token: "booking-token" }));
    expect(await getAgentCalendarAccess("missing-owner", "work", payload)).toBeNull();
  });

  it("rejects a selected calendar whose account reference is missing", async () => {
    expect(await getAgentCalendarAccess("owner", "work", {
      bookingConnectionId: "booking", conflictCalendars: [{ id: "personal" }],
    })).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});
