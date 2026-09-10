import type { CalendarAgendaSource } from "@receptionist/shared";
import { Hono } from "hono";
import type { AppEnv } from "../../types.js";
import {
  cancelAppointmentById,
  getAppointmentById,
  listAppointments,
  listConfirmedAppointmentsForSync,
  deletePastAppointment,
} from "@receptionist/core/repositories/appointments.js";
import {
  deleteCalendarEvent,
  listCalendarEvents,
  listCalendarEventIds,
  calendarEventExists,
} from "@receptionist/core/providers/calendar.js";
import { getAgentCalendarAccess, getCalendarConnectionToken } from "@receptionist/core/providers/googleAuth.js";
import { getAgentById } from "@receptionist/core/repositories/agents.js";

const DAY_MS = 86_400_000;

export const appointments = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await listAppointments(c.get("agentId"))))
  .delete("/history/:appointmentId", async (c) => {
    const agentId = c.get("agentId");
    const id = c.req.param("appointmentId");
    const appointment = await getAppointmentById(id, agentId);
    if (!appointment) return c.json({ error: "Appointment not found" }, 404);
    if (!appointment.endTime || appointment.endTime.getTime() > Date.now()) {
      return c.json({ error: "Only appointments whose end time has passed can be deleted from history" }, 409);
    }
    if (!await deletePastAppointment(agentId, id)) {
      return c.json({ error: "Appointment changed. Refresh and try again." }, 409);
    }
    return c.json({ deleted: true, appointmentId: id });
  })
  .get("/calendar", async (c) => {
    const timeMin = new Date(c.req.query("timeMin") ?? "");
    const timeMax = new Date(c.req.query("timeMax") ?? "");
    if (
      !Number.isFinite(timeMin.getTime()) ||
      !Number.isFinite(timeMax.getTime()) ||
      timeMax <= timeMin ||
      timeMax.getTime() - timeMin.getTime() > 45 * DAY_MS
    ) {
      return c.json({ error: "Choose a valid calendar range of 45 days or less" }, 400);
    }

    const agent = await getAgentById(c.get("agentId"));
    if (!agent?.calendarExternalId) return c.json({ error: "Connect Google Calendar first" }, 409);
    const access = await getAgentCalendarAccess(agent.id, agent.calendarExternalId, agent.calendarPayload);
    if (!access) return c.json({ error: "Reconnect Google Calendar" }, 409);
    const calendars = new Map<string, string>();
    const sources: CalendarAgendaSource[] = [];
    for (const group of access.conflicts) {
      const account = access.accounts.find(item => item.connectionId === group.connectionId);
      if (!account) return c.json({ error: "Calendar account unavailable" }, 409);
      for (const calendarId of group.calendarIds) {
        if (calendars.has(calendarId)) continue;
        calendars.set(calendarId, group.token);
        const reference = agent.calendarPayload?.conflictCalendars?.find(item => item.connectionId === group.connectionId && item.id === calendarId);
        sources.push({ ...account, calendarId, calendarName: reference?.summary
          ?? (calendarId === agent.calendarExternalId ? agent.calendarPayload?.summary : undefined) ?? calendarId });
      }
    }
    const results = await Promise.all([...calendars].map(([calendarId, token]) =>
      listCalendarEvents(token, calendarId, timeMin.toISOString(), timeMax.toISOString()),
    ));
    return c.json({ events: results.flat(), sources });
  })
  .post("/sync", async (c) => {
    const agentId = c.get("agentId");
    const rows = await listConfirmedAppointmentsForSync(agentId);
    if (rows.length === 0) {
      return c.json({ checked: 0, cancelledIds: [], appointments: await listAppointments(agentId) });
    }

    const agent = await getAgentById(agentId);

    const byCalendar = new Map<string, typeof rows>();
    for (const row of rows) {
      if (!row.externalCalendarId || !row.externalEventId || !row.startTime || !row.endTime) continue;
      const connectionId = row.externalCalendarConnectionId ?? agent?.calendarPayload?.bookingConnectionId;
      if (!connectionId) return c.json({ error: "Reconnect the appointment's Google account before refreshing" }, 409);
      const groupKey = `${connectionId}\u0000${row.externalCalendarId}`;
      const group = byCalendar.get(groupKey);
      if (group) group.push(row);
      else byCalendar.set(groupKey, [row]);
    }

    // Finish every Google read before changing local state. A partial provider
    // failure therefore cannot make only half the dashboard look cancelled.
    const liveByCalendar = new Map<string, Set<string>>();
    const tokens = new Map<string, Promise<string | null>>();
    await Promise.all(
      [...byCalendar].map(async ([groupKey, group]) => {
        const [connectionId, calendarId] = groupKey.split("\u0000") as [string, string];
        if (!tokens.has(connectionId)) tokens.set(connectionId, getCalendarConnectionToken(agentId, connectionId));
        const token = await tokens.get(connectionId);
        if (!token) throw new Error("A calendar account must be reconnected");
        const starts = group.map((row) => row.startTime!.getTime());
        const ends = group.map((row) => row.endTime!.getTime());
        const live = await listCalendarEventIds(
          token,
          calendarId,
          new Date(Math.min(...starts) - DAY_MS).toISOString(),
          new Date(Math.max(...ends) + DAY_MS).toISOString(),
        );
        for (const row of group) {
          if (!live.has(row.externalEventId!) && await calendarEventExists(token, calendarId, row.externalEventId!)) {
            live.add(row.externalEventId!);
          }
        }
        liveByCalendar.set(groupKey, live);
      }),
    );

    const cancelledIds: string[] = [];
    for (const [groupKey, group] of byCalendar) {
      const live = liveByCalendar.get(groupKey)!;
      for (const row of group) {
        if (live.has(row.externalEventId!)) continue;
        const cancelled = await cancelAppointmentById(row.id, agentId);
        if (cancelled) cancelledIds.push(row.id);
      }
    }

    return c.json({
      checked: rows.length,
      cancelledIds,
      appointments: await listAppointments(agentId),
    });
  })
  .delete("/:appointmentId", async (c) => {
    const agentId = c.get("agentId");
    const appointmentId = c.req.param("appointmentId");
    const appointment = await getAppointmentById(appointmentId, agentId);
    if (!appointment) return c.json({ error: "Appointment not found" }, 404);
    if (appointment.status === "cancelled") return c.json({ cancelled: true, appointmentId });

    if (appointment.externalEventId) {
      if (!appointment.externalCalendarId) {
        return c.json({ error: "This appointment has no saved calendar. Refresh the connection and try again." }, 409);
      }
      const agent = await getAgentById(agentId);
      const connectionId = appointment.externalCalendarConnectionId ?? agent?.calendarPayload?.bookingConnectionId;
      const token = connectionId
        ? await getCalendarConnectionToken(agentId, connectionId)
        : null;
      if (!token) return c.json({ error: "Reconnect Google Calendar before cancelling" }, 409);
      await deleteCalendarEvent(
        token,
        appointment.externalCalendarId,
        appointment.externalEventId,
      );
    }

    const cancelled = await cancelAppointmentById(appointmentId, agentId);
    if (!cancelled) return c.json({ error: "Appointment not found" }, 404);
    return c.json({ cancelled: true, appointmentId });
  });
