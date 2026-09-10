import type { SlackAlertKind, SlackConnectionSummary } from "@receptionist/shared";
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { z } from "zod";
import { env as apiEnv } from "../../env.js";
import type { AppEnv } from "../../types.js";
import { env as coreEnv } from "@receptionist/core/env.js";
import {
  deleteSlackConnection,
  getSlackConnection,
  updateSlackSettings,
} from "@receptionist/core/repositories/slack-connections.js";
import {
  getSlackBotToken,
  listSlackChannels,
  postSlackMessage,
  revokeSlackToken,
  slackConnectionConfigured,
} from "@receptionist/core/providers/slack.js";
import { createOAuthState, SLACK_OAUTH_COOKIE, SLACK_OAUTH_COOKIE_PATH } from "../calendar/oauth-state.js";
import { requireWorkspaceOwner } from "../../middleware/calendar-owner.js";

const alertKind = z.enum(["booking", "cancellation", "request", "question", "call-error"]);
const settingsSchema = z.object({
  channelId: z.string().min(1),
  alertKinds: z.array(alertKind).max(5),
});

async function readSummary(agentId: string): Promise<SlackConnectionSummary> {
  const connection = await getSlackConnection(agentId);
  if (!connection) {
    return { connected: false, teamName: null, channelId: null, channelName: null, alertKinds: [], channels: [] };
  }
  const token = await getSlackBotToken(agentId);
  if (!token) throw new Error("Slack must be reconnected");
  return {
    connected: true,
    teamName: connection.teamName,
    channelId: connection.channelId,
    channelName: connection.channelName,
    alertKinds: connection.alertKinds,
    channels: await listSlackChannels(token),
  };
}

export const slack = new Hono<AppEnv>()
  .use("*", requireWorkspaceOwner)
  .get("/", async c => c.json(await readSummary(c.get("agentId"))))
  .get("/oauth/start", c => {
    if (!slackConnectionConfigured()) return c.json({ error: "Slack is not configured on the server" }, 503);
    const redirectUri = `${apiEnv.PUBLIC_API_URL ?? new URL(c.req.url).origin}/api/slack/oauth/callback`;
    const verifier = randomBytes(32).toString("base64url");
    setCookie(c, SLACK_OAUTH_COOKIE, verifier, {
      httpOnly: true,
      secure: new URL(redirectUri).protocol === "https:",
      sameSite: "Lax",
      path: SLACK_OAUTH_COOKIE_PATH,
      maxAge: 600,
    });
    const query = new URLSearchParams({
      client_id: coreEnv.SLACK_CLIENT_ID!,
      redirect_uri: redirectUri,
      scope: "chat:write,channels:read,groups:read",
      state: createOAuthState(c.get("agentId"), verifier),
    });
    c.header("Cache-Control", "no-store");
    return c.json({ url: `https://slack.com/oauth/v2/authorize?${query}` });
  })
  .patch("/", async c => {
    const parsed = settingsSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const token = await getSlackBotToken(c.get("agentId"));
    if (!token) return c.json({ error: "Connect Slack first" }, 409);
    const channel = (await listSlackChannels(token)).find(item => item.id === parsed.data.channelId);
    if (!channel) return c.json({ error: "Invite DeskRoute to that channel, then try again" }, 400);
    const row = await updateSlackSettings(
      c.get("agentId"),
      channel,
      parsed.data.alertKinds as SlackAlertKind[],
    );
    if (!row) return c.json({ error: "Connect Slack first" }, 409);
    return c.json(await readSummary(c.get("agentId")));
  })
  .post("/test", async c => {
    const row = await getSlackConnection(c.get("agentId"));
    const token = await getSlackBotToken(c.get("agentId"));
    if (!row?.channelId || !token) return c.json({ error: "Choose and save a Slack channel first" }, 409);
    await postSlackMessage(token, row.channelId, "DeskRoute is connected. Notifications for this workspace will appear here.");
    return c.json({ sent: true });
  })
  .delete("/", async c => {
    let token: string | null = null;
    try { token = await getSlackBotToken(c.get("agentId")); }
    catch (error) { console.error("[slack] stored token could not be read during disconnect:", error); }
    if (token) await revokeSlackToken(token).catch(error => console.error("[slack] token revocation failed:", error));
    await deleteSlackConnection(c.get("agentId"));
    return c.json({ connected: false });
  });
