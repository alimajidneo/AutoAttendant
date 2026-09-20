import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import {
  connectMicrosoftCalendarAccount,
  exchangeMicrosoftAuthorizationCode,
} from "@receptionist/core/providers/microsoftAuth.js";
import { getLinkedEmployee } from "@receptionist/core/repositories/calcom.js";
import { env } from "../../env.js";
import {
  MICROSOFT_OAUTH_COOKIE,
  MICROSOFT_OAUTH_COOKIE_PATH,
  readOAuthState,
} from "./oauth-state.js";

function settingsUrl(result: "connected" | "error", message?: string, workspace?: string, employee = false) {
  const target = new URL(employee ? "/employee" : "/settings", env.DASHBOARD_ORIGINS[0]!);
  if (!employee) target.searchParams.set("tab", "connections");
  target.searchParams.set("calendar", result);
  target.searchParams.set("provider", "microsoft");
  if (workspace) target.searchParams.set("workspace", workspace);
  if (message) target.searchParams.set("message", message);
  return target.toString();
}

export const microsoftOAuthCallback = new Hono().get("/callback", async c => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  const verifier = getCookie(c, MICROSOFT_OAUTH_COOKIE) ?? "";
  const state = readOAuthState(c.req.query("state") ?? "", verifier);
  const code = c.req.query("code");
  if (state) deleteCookie(c, MICROSOFT_OAUTH_COOKIE, { path: MICROSOFT_OAUTH_COOKIE_PATH });
  const employeeFlow = !!state?.employeeId;
  if (!state || !code || c.req.query("error")) {
    return c.redirect(settingsUrl("error", "Microsoft authorization was not completed.", state?.agentId, employeeFlow));
  }
  try {
    if (state.employeeId && (!state.userId || !await getLinkedEmployee(state.agentId, state.userId, state.employeeId))) {
      return c.redirect(settingsUrl("error", "Your workspace account is no longer linked to that employee.", state.agentId, true));
    }
    const redirectUri = `${env.PUBLIC_API_URL ?? new URL(c.req.url).origin}/api/microsoft/oauth/callback`;
    const { refreshToken, account } = await exchangeMicrosoftAuthorizationCode(code, redirectUri, verifier);
    if (state.employeeId) await connectMicrosoftCalendarAccount(state.agentId, refreshToken, account, state.employeeId, state.userId);
    else await connectMicrosoftCalendarAccount(state.agentId, refreshToken, account);
    return c.redirect(settingsUrl("connected", undefined, state.agentId, employeeFlow));
  } catch {
    console.error("[microsoft-calendar] OAuth callback failed");
    return c.redirect(settingsUrl("error", "Microsoft Calendar connection failed. Try again and approve Calendar access.", state.agentId, employeeFlow));
  }
});
