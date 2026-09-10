import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../types.js";

const mocks = vi.hoisted(() => ({
  getSlackConnection: vi.fn(),
  updateSlackSettings: vi.fn(),
  deleteSlackConnection: vi.fn(),
  getSlackBotToken: vi.fn(),
  listSlackChannels: vi.fn(),
  postSlackMessage: vi.fn(),
  revokeSlackToken: vi.fn(),
}));
vi.mock("@receptionist/core/repositories/slack-connections.js", () => mocks);
vi.mock("@receptionist/core/providers/slack.js", () => ({
  ...mocks,
  slackConnectionConfigured: () => true,
}));
vi.mock("@receptionist/core/env.js", () => ({ env: {
  SLACK_CLIENT_ID: "client-id",
  SLACK_CLIENT_SECRET: "private-secret",
  TOKEN_ENCRYPTION_KEY: "34".repeat(32),
} }));
vi.mock("../../env.js", () => ({ env: {
  PUBLIC_API_URL: "https://api.deskroute.test",
  DASHBOARD_ORIGINS: ["https://deskroute.test"],
} }));

import { slack } from "./route.js";

function app(workspaceOwner = true) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("agentId", "11111111-1111-4111-8111-111111111111");
      c.set("workspaceOwner", workspaceOwner);
      await next();
    })
    .route("/slack", slack);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSlackConnection.mockResolvedValue({
    agentId: "11111111-1111-4111-8111-111111111111",
    teamName: "Team",
    channelId: "channel-1",
    channelName: "reception",
    alertKinds: ["booking"],
    encryptedBotToken: "PRIVATE",
  });
  mocks.getSlackBotToken.mockResolvedValue("xoxb-private");
  mocks.listSlackChannels.mockResolvedValue([{ id: "channel-1", name: "reception", private: false }]);
  mocks.updateSlackSettings.mockResolvedValue({ agentId: "11111111-1111-4111-8111-111111111111" });
});

describe("workspace Slack settings", () => {
  it("returns channel settings without exposing a bot credential", async () => {
    const response = await app().request("/slack");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ connected: true, teamName: "Team", channelId: "channel-1" });
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE|xoxb-private/);
  });

  it("allows only the workspace owner to manage the installation", async () => {
    expect((await app(false).request("/slack")).status).toBe(403);
    expect(mocks.getSlackConnection).not.toHaveBeenCalled();
  });

  it("uses a browser-bound state and requests only the intended bot scopes", async () => {
    const response = await app().request("/slack/oauth/start");
    const body = await response.json();
    const url = new URL(body.url);
    expect(url.searchParams.get("scope")).toBe("chat:write,channels:read,groups:read");
    expect(url.searchParams.get("redirect_uri")).toBe("https://api.deskroute.test/api/slack/oauth/callback");
    expect(url.searchParams.get("state")).toEqual(expect.any(String));
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(body.url).not.toContain("private-secret");
  });

  it("rejects a channel the installed bot cannot access", async () => {
    const response = await app().request("/slack", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId: "other-channel", alertKinds: ["booking"] }),
    });
    expect(response.status).toBe(400);
    expect(mocks.updateSlackSettings).not.toHaveBeenCalled();
  });
});
