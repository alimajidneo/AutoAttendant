import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptToken } from "./token-encryption.js";

const mocks = vi.hoisted(() => ({
  getSlackConnection: vi.fn(),
  saveSlackConnection: vi.fn(),
}));
vi.mock("../repositories/slack-connections.js", () => mocks);
vi.mock("../env.js", () => ({ env: {
  SLACK_CLIENT_ID: "slack-client",
  SLACK_CLIENT_SECRET: "slack-secret",
  TOKEN_ENCRYPTION_KEY: "78".repeat(32),
} }));

import {
  exchangeSlackAuthorizationCode,
  listSlackChannels,
  notifySlack,
} from "./slack.js";

const request = vi.fn();
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", request); });
afterEach(() => vi.unstubAllGlobals());

describe("Slack integration", () => {
  it("exchanges the server authorization code without returning the bot token", async () => {
    request.mockResolvedValue(response({ ok: true, access_token: "xoxb-private", bot_user_id: "bot-1", team: { id: "team-1", name: "Neodym" } }));
    const result = await exchangeSlackAuthorizationCode("code", "https://deskroute.test/callback");
    expect(result).toEqual({ botToken: "xoxb-private", botUserId: "bot-1", teamId: "team-1", teamName: "Neodym" });
    const body = request.mock.calls[0]![1].body as URLSearchParams;
    expect(body.get("client_secret")).toBe("slack-secret");
    expect(request.mock.calls[0]![0]).toBe("https://slack.com/api/oauth.v2.access");
  });

  it("offers only channels that the bot has joined", async () => {
    request.mockResolvedValue(response({ ok: true, channels: [
      { id: "joined", name: "reception", is_member: true, is_private: false },
      { id: "not-joined", name: "private", is_member: false, is_private: true },
    ], response_metadata: { next_cursor: "" } }));
    await expect(listSlackChannels("token")).resolves.toEqual([
      { id: "joined", name: "reception", private: false },
    ]);
  });

  it("posts a generic alert without caller or calendar details", async () => {
    mocks.getSlackConnection.mockResolvedValue({
      agentId: "agent-1", channelId: "channel-1", alertKinds: ["booking"], encryptionOwner: "agent-1",
      encryptedBotToken: encryptToken("xoxb-private", "agent-1", "78".repeat(32)),
    });
    request.mockResolvedValue(response({ ok: true }));
    await expect(notifySlack("agent-1", "booking")).resolves.toBe(true);
    const body = JSON.parse(request.mock.calls[0]![1].body as string);
    expect(body).toMatchObject({ channel: "channel-1", text: "DeskRoute booked a new appointment." });
    expect(JSON.stringify(body)).not.toMatch(/caller|phone|transcript|calendar/i);
  });
});
