import { afterEach, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({ env: {
  CALCOM_OAUTH_CLIENT_ID: "client", CALCOM_OAUTH_CLIENT_SECRET: "secret",
  CALCOM_OAUTH_WRITE_APPROVED: true, TOKEN_ENCRYPTION_KEY: "34".repeat(32),
} }));

import { calcomOAuthConfigured, exchangeCalcomAuthorizationCode, refreshCalcomOAuthTokens } from "./calcom.js";

afterEach(() => vi.unstubAllGlobals());

it("exchanges a Cal.com code with the exact form contract and verifies identity", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "ACCESS", token_type: "bearer", refresh_token: "REFRESH", expires_in: 3600 })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: "success", data: { id: 42, email: "thomas@example.test", username: "thomas" } })));
  vi.stubGlobal("fetch", fetch);
  const result = await exchangeCalcomAuthorizationCode("code", "https://api.example/api/calcom/oauth/callback");
  expect(result.account).toEqual({ id: 42, email: "thomas@example.test", username: "thomas" });
  expect(result.tokens).toMatchObject({ accessToken: "ACCESS", refreshToken: "REFRESH" });
  const request = fetch.mock.calls[0]!;
  expect(request[0]).toBe("https://api.cal.com/v2/auth/oauth2/token");
  expect(Object.fromEntries((request[1]!.body as URLSearchParams).entries())).toEqual({
    code: "code", client_id: "client", client_secret: "secret", grant_type: "authorization_code",
    redirect_uri: "https://api.example/api/calcom/oauth/callback",
  });
  expect((request[1]!.body as URLSearchParams).has("code_verifier")).toBe(false);
  expect(JSON.stringify(request)).not.toContain("REFRESH");
});

it("refreshes once, requires a rotated refresh token, and never returns provider errors", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "NEW_ACCESS", token_type: "bearer", refresh_token: "NEW_REFRESH", expires_in: 1800 })));
  vi.stubGlobal("fetch", fetch);
  const tokens = await refreshCalcomOAuthTokens("OLD_REFRESH");
  expect(tokens).toMatchObject({ accessToken: "NEW_ACCESS", refreshToken: "NEW_REFRESH" });
  expect(fetch).toHaveBeenCalledOnce();
  expect(Object.fromEntries((fetch.mock.calls[0]![1]!.body as URLSearchParams).entries())).toEqual({
    grant_type: "refresh_token", client_id: "client", client_secret: "secret", refresh_token: "OLD_REFRESH",
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "PRIVATE" }), { status: 401 })));
  await expect(refreshCalcomOAuthTokens("OLD_REFRESH")).rejects.not.toThrow("PRIVATE");
});

it("rejects a token response without the verified bearer type or rotated refresh token", async () => {
  for (const data of [
    { access_token: "ACCESS", refresh_token: "REFRESH", expires_in: 1800 },
    { access_token: "ACCESS", token_type: "bearer", expires_in: 1800 },
  ]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(data))));
    await expect(refreshCalcomOAuthTokens("OLD_REFRESH")).rejects.toThrow("Cal.com response unavailable");
  }
});

it("recognizes the complete server OAuth configuration", () => {
  expect(calcomOAuthConfigured()).toBe(true);
});
