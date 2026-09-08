import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../types.js";
import { getAgentById, updateAgent } from "@receptionist/core/repositories/agents.js";
import { listCalendars, CalendarScopeMissingError } from "@receptionist/core/providers/calendar.js";
import {
  getGoogleOAuthToken,
  connectGoogleCredentials,
  googleConnectionConfigured,
  GoogleReconnectRequired,
  forgetGoogleOAuthToken,
} from "@receptionist/core/providers/googleAuth.js";
import { calendarSelectSchema } from "../../schemas.js";

export const calendar = new Hono<AppEnv>()
  .post("/connect", async (c) => {
    if (!googleConnectionConfigured()) return c.json({ error: "Calendar connection is not configured on the server" }, 503);
    const parsed = z.object({ refreshToken: z.string().min(1).max(4096) }).safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "A Google refresh token is required" }, 400);
    const user = c.get("authUser");
    const subject = user.identities?.find(i => i.provider === "google")?.identity_data?.sub;
    if (typeof subject !== "string") return c.json({ error: "Sign in with Google first" }, 400);
    try { await connectGoogleCredentials(user.id, subject, parsed.data.refreshToken); }
    catch (error) {
      if (error instanceof GoogleReconnectRequired) return c.json({ error: "Reconnect Google Calendar with the same account and approve all Calendar permissions" }, 400);
      throw error;
    }
    return c.json({ connected: true });
  })
  .get("/list", async (c) => {
    const token = await getGoogleOAuthToken(c.get("authUser").id);
    // No token and a sign-in token without calendar scope are the same answer.
    if (!token) return c.json({ connected: false, calendars: [] });

    try {
      return c.json({ connected: true, calendars: await listCalendars(token) });
    } catch (err) {
      if (err instanceof CalendarScopeMissingError) {
        return c.json({ connected: false, calendars: [] });
      }
      throw err;
    }
  })
  .patch("/", async (c) => {
    const parsed = calendarSelectSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const { calendarId } = parsed.data;
    const token = await getGoogleOAuthToken(c.get("authUser").id);
    if (!token) return c.json({ error: "Reconnect Google Calendar" }, 409);
    const selected = (await listCalendars(token)).find(item => item.id === calendarId);
    if (!selected) return c.json({ error: "Select a writable calendar from your account" }, 400);
    const { summary, timeZone } = selected;

    // The display name is stored beside the id so Settings renders a name
    // without a round trip to Google on every load.
    await updateAgent(c.get("agentId"), {
      calendarProvider: "google",
      calendarExternalId: calendarId,
      calendarPayload: { summary, ...(timeZone ? { timeZone } : {}) },
    });

    return c.json({ connected: true, calendarExternalId: calendarId });
  })
  // Existing appointments stay: they are commitments in a calendar the owner
  // still holds. The agent stops offering new ones.
  .delete("/", async (c) => {
    const agentId = c.get("agentId");
    const agent = await getAgentById(agentId);
    if (!agent) return c.json({ error: "Agent not found" }, 404);

    await updateAgent(agentId, {
      calendarProvider: null,
      calendarExternalId: null,
      calendarPayload: null,
    });

    await forgetGoogleOAuthToken(c.get("authUser").id);
    return c.json({ connected: false });
  });
