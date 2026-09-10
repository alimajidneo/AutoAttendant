import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import {
  connectSlackWorkspace,
  exchangeSlackAuthorizationCode,
} from "@receptionist/core/providers/slack.js";
import { env } from "../../env.js";
import {
  readOAuthState,
  SLACK_OAUTH_COOKIE,
  SLACK_OAUTH_COOKIE_PATH,
} from "../calendar/oauth-state.js";

function settingsUrl(result: "connected" | "error", message?: string, workspace?: string) {
  const target = new URL("/settings", env.DASHBOARD_ORIGINS[0]!);
  target.searchParams.set("tab", "connections");
  target.searchParams.set("slack", result);
  if (workspace) target.searchParams.set("workspace", workspace);
  if (message) target.searchParams.set("message", message);
  return target.toString();
}

export const slackOAuthCallback = new Hono().get("/callback", async c => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  const verifier = getCookie(c, SLACK_OAUTH_COOKIE) ?? "";
  const state = readOAuthState(c.req.query("state") ?? "", verifier);
  const code = c.req.query("code");
  if (state) deleteCookie(c, SLACK_OAUTH_COOKIE, { path: SLACK_OAUTH_COOKIE_PATH });
  if (!state || !code || c.req.query("error")) {
    return c.redirect(settingsUrl("error", "Slack authorization was not completed."));
  }
  try {
    const redirectUri = `${env.PUBLIC_API_URL ?? new URL(c.req.url).origin}/api/slack/oauth/callback`;
    const installation = await exchangeSlackAuthorizationCode(code, redirectUri);
    await connectSlackWorkspace(state.agentId, installation);
    return c.redirect(settingsUrl("connected", undefined, state.agentId));
  } catch {
    console.error("[slack] OAuth callback failed");
    return c.redirect(settingsUrl("error", "Slack connection failed. Try installing DeskRoute again.", state.agentId));
  }
});
