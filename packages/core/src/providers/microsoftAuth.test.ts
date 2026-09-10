import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptToken, encryptToken } from "./token-encryption.js";

const mocks = vi.hoisted(() => ({
  getCalendarConnection: vi.fn(),
  listCalendarConnections: vi.fn(),
  saveCalendarConnection: vi.fn(),
  updateCalendarConnectionCredential: vi.fn(),
}));
vi.mock("../repositories/calendar-connections.js", () => mocks);
vi.mock("../env.js", () => ({ env: {
  MICROSOFT_CLIENT_ID: "microsoft-client",
  MICROSOFT_CLIENT_SECRET: "microsoft-secret",
  TOKEN_ENCRYPTION_KEY: "56".repeat(32),
} }));

import {
  connectMicrosoftCalendarAccount,
  exchangeMicrosoftAuthorizationCode,
  tokenForMicrosoftConnection,
} from "./microsoftAuth.js";

const request = vi.fn();
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", request); });
afterEach(() => vi.unstubAllGlobals());

describe("Microsoft delegated calendar credentials", () => {
  it("uses PKCE, requests offline calendar access, and accepts a personal account", async () => {
    request
      .mockResolvedValueOnce(response({ access_token: "access", refresh_token: "refresh", expires_in: 3600,
        scope: "openid profile email offline_access User.Read Calendars.ReadWrite" }))
      .mockResolvedValueOnce(response({ id: "microsoft-user", displayName: "Account Owner", userPrincipalName: "owner@outlook.com" }));

    await expect(exchangeMicrosoftAuthorizationCode("code", "https://deskroute.test/callback", "verifier"))
      .resolves.toEqual({
        refreshToken: "refresh",
        account: { id: "microsoft-user", email: "owner@outlook.com", name: "Account Owner" },
      });
    const body = request.mock.calls[0]![1].body as URLSearchParams;
    expect(body.get("code_verifier")).toBe("verifier");
    expect(body.get("scope")).toContain("Calendars.ReadWrite");
    expect(request.mock.calls[0]![0]).toContain("/common/oauth2/v2.0/token");
  });

  it("encrypts the refresh credential before saving it", async () => {
    mocks.saveCalendarConnection.mockImplementation(async input => input);
    const stored = await connectMicrosoftCalendarAccount("agent-1", "refresh-token", {
      id: "account-1", email: "owner@example.com", name: null,
    });
    expect(stored.provider).toBe("microsoft");
    expect(decryptToken(stored.encryptedRefreshToken, stored.encryptionOwner, "56".repeat(32)))
      .toBe("refresh-token");
  });

  it("stores a rotated refresh token returned by Microsoft", async () => {
    const row = {
      id: "connection-1",
      agentId: "agent-1",
      provider: "microsoft",
      encryptionOwner: "connection-1",
      encryptedRefreshToken: encryptToken("old-refresh", "connection-1", "56".repeat(32)),
    };
    request.mockResolvedValue(response({ access_token: "access", refresh_token: "new-refresh", expires_in: 3600 }));
    mocks.updateCalendarConnectionCredential.mockImplementation(async (_agentId, _id, encryptedRefreshToken, encryptionOwner) => ({
      ...row, encryptedRefreshToken, encryptionOwner,
    }));

    await expect(tokenForMicrosoftConnection("agent-1", row as never)).resolves.toBe("access");
    const encrypted = mocks.updateCalendarConnectionCredential.mock.calls[0]![2];
    expect(decryptToken(encrypted, "connection-1", "56".repeat(32))).toBe("new-refresh");
  });
});
