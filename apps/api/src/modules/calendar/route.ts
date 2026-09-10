import { requireCalendarOwner } from "../../middleware/calendar-owner.js";
import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { setCookie } from "hono/cookie";
import type { AppEnv } from "../../types.js";
import { env as apiEnv } from "../../env.js";
import { env as coreEnv } from "@receptionist/core/env.js";
import { getAgentById, updateAgent } from "@receptionist/core/repositories/agents.js";
import { deleteCalendarConnection } from "@receptionist/core/repositories/calendar-connections.js";
import { CalendarScopeMissingError } from "@receptionist/core/providers/calendar.js";
import { MicrosoftCalendarScopeMissingError } from "@receptionist/core/providers/microsoftCalendar.js";
import {
  googleConnectionConfigured,
} from "@receptionist/core/providers/googleAuth.js";
import { microsoftConnectionConfigured } from "@receptionist/core/providers/microsoftAuth.js";
import { getAllCalendarConnectionTokens } from "@receptionist/core/providers/calendarAccess.js";
import { listProviderCalendars } from "@receptionist/core/providers/calendarProvider.js";
import { calendarSelectSchema } from "../../schemas.js";
import {
  createOAuthState,
  MICROSOFT_OAUTH_COOKIE,
  MICROSOFT_OAUTH_COOKIE_PATH,
  oauthChallenge,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
} from "./oauth-state.js";

const calendarScopes = [
  "openid", "email", "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

export const calendar = new Hono<AppEnv>().use("*", requireCalendarOwner)
  .get("/oauth/start", c => {
    if (!googleConnectionConfigured()) return c.json({ error: "Calendar connection is not configured on the server" }, 503);
    const redirectUri = `${apiEnv.PUBLIC_API_URL ?? new URL(c.req.url).origin}/api/calendar/oauth/callback`;
    const verifier = randomBytes(32).toString("base64url");
    setCookie(c, OAUTH_COOKIE, verifier, {
      httpOnly: true, secure: new URL(redirectUri).protocol === "https:",
      sameSite: "Lax", path: OAUTH_COOKIE_PATH, maxAge: 600,
    });
    c.header("Cache-Control", "no-store");
    const params = new URLSearchParams({
      client_id: coreEnv.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri,
      response_type: "code", access_type: "offline", prompt: "consent select_account",
      include_granted_scopes: "true", scope: calendarScopes.join(" "),
      state: createOAuthState(c.get("agentId"), verifier),
      code_challenge: oauthChallenge(verifier), code_challenge_method: "S256",
    });
    return c.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  })
  .get("/oauth/microsoft/start", c => {
    if (!microsoftConnectionConfigured()) return c.json({ error: "Microsoft Calendar is not configured on the server" }, 503);
    const redirectUri = `${apiEnv.PUBLIC_API_URL ?? new URL(c.req.url).origin}/api/microsoft/oauth/callback`;
    const verifier = randomBytes(32).toString("base64url");
    setCookie(c, MICROSOFT_OAUTH_COOKIE, verifier, {
      httpOnly: true, secure: new URL(redirectUri).protocol === "https:",
      sameSite: "Lax", path: MICROSOFT_OAUTH_COOKIE_PATH, maxAge: 600,
    });
    c.header("Cache-Control", "no-store");
    const params = new URLSearchParams({
      client_id: coreEnv.MICROSOFT_CLIENT_ID!, redirect_uri: redirectUri,
      response_type: "code", response_mode: "query",
      scope: "openid profile email offline_access User.Read Calendars.ReadWrite",
      state: createOAuthState(c.get("agentId"), verifier), prompt: "select_account",
      code_challenge: oauthChallenge(verifier), code_challenge_method: "S256",
    });
    return c.json({ url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}` });
  })
  .get("/list", async c => {
    const connectionTokens = await getAllCalendarConnectionTokens(c.get("agentId"));
    const results = await Promise.all(connectionTokens.map(async ({ row, token }) => {
      const connection = {
        id: row.id, provider: row.provider, accountEmail: row.accountEmail, accountName: row.accountName,
        reconnectRequired: !token,
      };
      if (!token) return { connection, calendars: [] };
      try {
        const calendars = await listProviderCalendars(row.provider, token);
        return { connection, calendars: calendars.map(item => ({ ...item, provider: row.provider, connectionId: row.id, accountEmail: row.accountEmail })) };
      } catch (error) {
        if (error instanceof CalendarScopeMissingError || error instanceof MicrosoftCalendarScopeMissingError) {
          return { connection: { ...connection, reconnectRequired: true }, calendars: [] };
        }
        throw error;
      }
    }));
    return c.json({ connected: results.length > 0, connections: results.map(result => result.connection), calendars: results.flatMap(result => result.calendars) });
  })
  .patch("/", async c => {
    const parsed = calendarSelectSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const available = await getAllCalendarConnectionTokens(c.get("agentId"));
    const listed = (await Promise.all(available.map(async ({ row, token }) => {
      if (!token) return [];
      return (await listProviderCalendars(row.provider, token)).map(calendar => ({ ...calendar, provider: row.provider, connectionId: row.id }));
    }))).flat();
    const key = (connectionId: string, calendarId: string) => `${connectionId}\u0000${calendarId}`;
    const byKey = new Map(listed.map(item => [key(item.connectionId, item.id), item]));
    const booking = byKey.get(key(parsed.data.booking.connectionId, parsed.data.booking.calendarId));
    if (!booking?.writable) return c.json({ error: "Select a writable booking calendar" }, 400);
    const requested = new Map(parsed.data.conflicts.map(item => [key(item.connectionId, item.calendarId), item]));
    requested.set(key(booking.connectionId, booking.id), { connectionId: booking.connectionId, calendarId: booking.id });
    const conflicts = [...requested.values()].map(item => byKey.get(key(item.connectionId, item.calendarId)));
    if (conflicts.some(item => !item)) return c.json({ error: "One or more calendars are unavailable. Reconnect the account and try again." }, 400);

    await updateAgent(c.get("agentId"), {
      calendarProvider: booking.provider,
      calendarExternalId: booking.id,
      calendarPayload: {
        summary: booking.summary,
        ...(booking.timeZone ? { timeZone: booking.timeZone } : {}),
        bookingConnectionId: booking.connectionId,
        conflictCalendars: conflicts.map(item => ({
          connectionId: item!.connectionId, id: item!.id, summary: item!.summary,
          ...(item!.timeZone ? { timeZone: item!.timeZone } : {}),
        })),
      },
    });
    return c.json({ connected: true, calendarExternalId: booking.id });
  })
  .delete("/:connectionId", async c => {
    const agentId = c.get("agentId");
    const connectionId = c.req.param("connectionId");
    const agent = await getAgentById(agentId);
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    await deleteCalendarConnection(agentId, connectionId);
    if (agent.calendarPayload?.bookingConnectionId === connectionId) {
      await updateAgent(agentId, { calendarProvider: null, calendarExternalId: null, calendarPayload: null });
    } else if (agent.calendarPayload) {
      await updateAgent(agentId, {
        calendarPayload: {
          ...agent.calendarPayload,
          conflictCalendars: agent.calendarPayload.conflictCalendars?.filter(item => item.connectionId !== connectionId),
        },
      });
    }
    return c.json({ connected: true });
  });
