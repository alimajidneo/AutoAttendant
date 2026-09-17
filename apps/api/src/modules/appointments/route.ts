import { z } from 'zod';
import { reconcileCalcomAppointment } from '@receptionist/core/repositories/calcom.js';
import { isCalcomAppointment, cancelCalcomAppointment, readCalcomAppointment } from '@receptionist/core/providers/calcom-appointments.js';
import type { CalendarAgendaSource } from "@receptionist/shared";
import { Hono } from "hono";
import type { AppEnv } from "../../types.js";
import {
  reconcileEmployeeAppointmentNotCreated,
  cancelAppointmentById,
  getAppointmentById,
  listAppointments,
  listConfirmedAppointmentsForSync,
  deletePastAppointment,
} from "@receptionist/core/repositories/appointments.js";
import { getAgentCalendarAccess, getCalendarCredential } from "@receptionist/core/providers/calendarAccess.js";
import {
  deleteProviderCalendarEvent,
  listProviderCalendarEventIds,
  listProviderCalendarEvents,
  providerCalendarEventExists,
} from "@receptionist/core/providers/calendarProvider.js";
import { getAgentById } from "@receptionist/core/repositories/agents.js";
import { notifySlack } from "@receptionist/core/providers/slack.js";
import { requireManager } from "../../middleware/auth.js";

const DAY_MS = 86_400_000;

export const appointments = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await listAppointments(c.get("agentId"))))
  .delete("/history/:appointmentId", requireManager, async (c) => {
    const agentId = c.get("agentId");
    const id = c.req.param("appointmentId");
    const appointment = await getAppointmentById(id, agentId);
    if (!appointment) return c.json({ error: "Appointment not found" }, 404);
    if (appointment.employeeId && appointment.status === "requested") {
      return c.json({ error: "Booking is in progress or requires provider reconciliation. Generic cancellation and deletion are blocked." }, 409);
    }
    if (!appointment.endTime || appointment.endTime.getTime() > Date.now()) {
      return c.json({ error: "Only appointments whose end time has passed can be deleted from history" }, 409);
    }
    if (appointment.externalEventId && isCalcomAppointment(appointment)) {
      await cancelCalcomAppointment(agentId, appointment);
    } else if (appointment.externalEventId) {
      if (!appointment.externalCalendarId) return c.json({ error: "The original calendar is missing. Reconnect it before deleting." }, 409);
      const agent = await getAgentById(agentId);
      const connectionId = appointment.externalCalendarConnectionId ?? agent?.calendarPayload?.bookingConnectionId;
      const credential = connectionId
        ? appointment.employeeId
          ? await getCalendarCredential(agentId, connectionId, appointment.employeeId)
          : await getCalendarCredential(agentId, connectionId)
        : null;
      if (!credential) return c.json({ error: "Reconnect the appointment's calendar account before deleting." }, 409);
      await deleteProviderCalendarEvent(
        credential.provider,
        credential.token,
        appointment.externalCalendarId,
        appointment.externalEventId,
      );
    }
    if (!await deletePastAppointment(agentId, id)) {
      return c.json({ error: "Appointment changed. Refresh and try again." }, 409);
    }
    return c.json({ deleted: true, appointmentId: id });
  })
  .post("/:appointmentId/reconcile-calcom", requireManager, async c => {
    const body = z.object({ bookingUid: z.string().min(1).max(200).optional() }).strict().safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid reconciliation request' }, 400);
    const row = await reconcileCalcomAppointment(c.get('agentId'), c.req.param('appointmentId'), body.data.bookingUid);
    return row ? c.json({ status: row.status, appointmentId: row.id }) : c.json({ error: 'Current provider state could not be reconciled. Check the booking UID and original interval.' }, 409);
  })
  .post("/:appointmentId/reconcile-not-created", requireManager, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).length !== 1 || !("providerChecked" in body) || body.providerChecked !== true) {
      return c.json({ error: "Confirm that you checked the provider calendar and no event exists: {providerChecked:true}" }, 400);
    }
    const row = await reconcileEmployeeAppointmentNotCreated(c.get("agentId"), c.req.param("appointmentId"));
    if (!row) return c.json({ error: "Reconciliation requires an unresolved write or an in-flight write older than 24 hours. Refresh and check the provider calendar." }, 409);
    return c.json({ cancelled: true, appointmentId: row.id });
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

    if (!c.get("workspaceOwner")) {
      const rows = await listAppointments(c.get("agentId"));
      const events = rows.flatMap(item => item.startTime && item.endTime && item.status !== "cancelled"
        && item.startTime < timeMax && item.endTime > timeMin ? [{
          id: item.externalEventId ?? item.id, calendarId: item.externalCalendarId ?? "workspace",
          title: item.service, start: item.startTime.toISOString(), end: item.endTime.toISOString(), allDay: false,
        }] : []);
      return c.json({ connected: true, events, sources: [] });
    }

    const agent = await getAgentById(c.get("agentId"));
    if (!agent?.calendarExternalId) return c.json({ connected: false, events: [], sources: [] });
    const access = await getAgentCalendarAccess(agent.id, agent.calendarExternalId, agent.calendarPayload);
    if (!access) return c.json({ error: "Reconnect your calendar account" }, 409);
    const calendars = new Map<string, { provider: typeof access.booking.provider; token: string; connectionId: string; calendarId: string }>();
    const sources: CalendarAgendaSource[] = [];
    for (const group of access.conflicts) {
      const account = access.accounts.find(item => item.connectionId === group.connectionId);
      if (!account) return c.json({ error: "Calendar account unavailable" }, 409);
      for (const calendarId of group.calendarIds) {
        const key = `${group.provider}\u0000${calendarId}`;
        if (calendars.has(key)) continue;
        calendars.set(key, { provider: group.provider, token: group.token, connectionId: group.connectionId, calendarId });
        const reference = agent.calendarPayload?.conflictCalendars?.find(item => item.connectionId === group.connectionId && item.id === calendarId);
        sources.push({
          ...account, calendarId,
          calendarName: reference?.summary
            ?? (calendarId === agent.calendarExternalId ? agent.calendarPayload?.summary : undefined) ?? calendarId,
          ...(reference?.color ? { color: reference.color } : {}),
        });
      }
    }
    const results = await Promise.all([...calendars.values()].map(({ provider, token, calendarId }) =>
      listProviderCalendarEvents(provider, token, calendarId, timeMin.toISOString(), timeMax.toISOString()),
    ));
    return c.json({ connected: true, events: results.flat(), sources });
  })
  .post("/sync", requireManager, async (c) => {
    const agentId = c.get("agentId");
    const rows = await listConfirmedAppointmentsForSync(agentId);
    if (rows.length === 0) {
      return c.json({ checked: 0, cancelledIds: [], appointments: await listAppointments(agentId) });
    }

    const agent = await getAgentById(agentId);

    const calcomRows = rows.filter(isCalcomAppointment);
    const calcomStates = await Promise.all(calcomRows.map(async row => ({ row, ...(await readCalcomAppointment(agentId, row)) })));
    const byCalendar = new Map<string, typeof rows>();
    for (const row of rows) {
      if (isCalcomAppointment(row)) continue;
      if (!row.externalCalendarId || !row.externalEventId || !row.startTime || !row.endTime) continue;
      const connectionId = row.externalCalendarConnectionId ?? agent?.calendarPayload?.bookingConnectionId;
      if (!connectionId) return c.json({ error: "Reconnect the appointment's calendar account before refreshing" }, 409);
      const groupKey = `${connectionId}\u0000${row.externalCalendarId}`;
      const group = byCalendar.get(groupKey);
      if (group) group.push(row);
      else byCalendar.set(groupKey, [row]);
    }

    // Finish every provider read before changing local state. A partial provider
    // failure therefore cannot make only half the dashboard look cancelled.
    const liveByCalendar = new Map<string, Set<string>>();
    const credentials = new Map<string, ReturnType<typeof getCalendarCredential>>();
    await Promise.all(
      [...byCalendar].map(async ([groupKey, group]) => {
        const [connectionId, calendarId] = groupKey.split("\u0000") as [string, string];
        if (!credentials.has(connectionId)) credentials.set(connectionId, getCalendarCredential(agentId, connectionId));
        const credential = await credentials.get(connectionId);
        if (!credential) throw new Error("A calendar account must be reconnected");
        const starts = group.map((row) => row.startTime!.getTime());
        const ends = group.map((row) => row.endTime!.getTime());
        const live = await listProviderCalendarEventIds(
          credential.provider,
          credential.token,
          calendarId,
          new Date(Math.min(...starts) - DAY_MS).toISOString(),
          new Date(Math.max(...ends) + DAY_MS).toISOString(),
        );
        for (const row of group) {
          if (!live.has(row.externalEventId!) && await providerCalendarEventExists(
            credential.provider,
            credential.token,
            calendarId,
            row.externalEventId!,
          )) {
            live.add(row.externalEventId!);
          }
        }
        liveByCalendar.set(groupKey, live);
      }),
    );

    const cancelledIds: string[] = [];
    for (const { row, booking } of calcomStates) {
      if (booking.status === 'cancelled' || booking.status === 'rejected') {
        if (await cancelAppointmentById(row.id, agentId)) cancelledIds.push(row.id);
      }
    }
    for (const [groupKey, group] of byCalendar) {
      const live = liveByCalendar.get(groupKey)!;
      for (const row of group) {
        if (live.has(row.externalEventId!)) continue;
        const cancelled = await cancelAppointmentById(row.id, agentId);
        if (cancelled) cancelledIds.push(row.id);
      }
    }

    if (cancelledIds.length > 0) {
      await notifySlack(agentId, "cancellation").catch(err => console.error("[slack] cancellation alert failed:", err));
    }

    return c.json({
      checked: rows.length,
      cancelledIds,
      appointments: await listAppointments(agentId),
    });
  })
  .delete("/:appointmentId", requireManager, async (c) => {
    const agentId = c.get("agentId");
    const appointmentId = c.req.param("appointmentId");
    const appointment = await getAppointmentById(appointmentId, agentId);
    if (!appointment) return c.json({ error: "Appointment not found" }, 404);
    if (appointment.employeeId && appointment.status === "requested") {
      return c.json({ error: "Booking is in progress or requires provider reconciliation. Generic cancellation and deletion are blocked." }, 409);
    }
    if (appointment.status === "cancelled") return c.json({ cancelled: true, appointmentId });

    if (appointment.externalEventId && isCalcomAppointment(appointment)) {
      await cancelCalcomAppointment(agentId, appointment);
    } else if (appointment.externalEventId) {
      if (!appointment.externalCalendarId) {
        return c.json({ error: "This appointment has no saved calendar. Refresh the connection and try again." }, 409);
      }
      const agent = await getAgentById(agentId);
      const connectionId = appointment.externalCalendarConnectionId ?? agent?.calendarPayload?.bookingConnectionId;
      const credential = connectionId
        ? appointment.employeeId
          ? await getCalendarCredential(agentId, connectionId, appointment.employeeId)
          : await getCalendarCredential(agentId, connectionId)
        : null;
      if (!credential) return c.json({ error: "Reconnect the calendar account before cancelling" }, 409);
      await deleteProviderCalendarEvent(
        credential.provider,
        credential.token,
        appointment.externalCalendarId,
        appointment.externalEventId,
      );
    }

    const cancelled = await cancelAppointmentById(appointmentId, agentId);
    if (!cancelled) return c.json({ error: "Appointment not found" }, 404);
    await notifySlack(agentId, "cancellation").catch(err => console.error("[slack] cancellation alert failed:", err));
    return c.json({ cancelled: true, appointmentId });
  });
