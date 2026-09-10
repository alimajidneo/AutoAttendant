import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { connectGoogleCalendarAccount, exchangeGoogleAuthorizationCode } from "@receptionist/core/providers/googleAuth.js";
import { env } from "../../env.js";
import { readOAuthState, OAUTH_COOKIE, OAUTH_COOKIE_PATH } from "./oauth-state.js";

function settingsUrl(result: "connected" | "error", message?: string, workspace?: string) {
  const target = new URL("/settings", env.DASHBOARD_ORIGINS[0]!);
  target.searchParams.set("tab", "connections");
  target.searchParams.set("calendar", result);
  if (workspace) target.searchParams.set("workspace", workspace);
  if (message) target.searchParams.set("message", message);
  return target.toString();
}

export const calendarOAuthCallback = new Hono().get("/callback", async c => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  const verifier = getCookie(c, OAUTH_COOKIE) ?? "";
  const state = readOAuthState(c.req.query("state") ?? "", verifier);
  const code = c.req.query("code");
  if (state) deleteCookie(c, OAUTH_COOKIE, { path: OAUTH_COOKIE_PATH });
  if (!state || !code || c.req.query("error")) return c.redirect(settingsUrl("error", "Google authorization was not completed."));
  try {
    const redirectUri = `${env.PUBLIC_API_URL ?? new URL(c.req.url).origin}/api/calendar/oauth/callback`;
    const { refreshToken, account } = await exchangeGoogleAuthorizationCode(code, redirectUri, verifier);
    await connectGoogleCalendarAccount(state.agentId, refreshToken, account);
    return c.redirect(settingsUrl("connected", undefined, state.agentId));
  } catch {
    console.error("[calendar] OAuth callback failed");
    return c.redirect(settingsUrl("error", "Calendar connection failed. Try again and approve all Calendar permissions.", state.agentId));
  }
});
