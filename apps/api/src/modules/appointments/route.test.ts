import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../types.js";

const mocks = vi.hoisted(() => ({
  listAppointments: vi.fn(),
  getAppointmentById: vi.fn(),
  cancelAppointmentById: vi.fn(),
  deletePastAppointment: vi.fn(),
  listConfirmedAppointmentsForSync: vi.fn(),
  getAgentCalendarAccess: vi.fn(),
  getCalendarConnectionToken: vi.fn(),
  calendarEventExists: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  listCalendarEvents: vi.fn(),
  listCalendarEventIds: vi.fn(),
  listCalendars: vi.fn(),
  getAgentById: vi.fn(),
}));

vi.mock("@receptionist/core/repositories/appointments.js", () => mocks);
vi.mock("@receptionist/core/providers/calendarAccess.js", () => ({
  getAgentCalendarAccess: mocks.getAgentCalendarAccess,
  getCalendarCredential: mocks.getCalendarConnectionToken,
}));
vi.mock("@receptionist/core/providers/calendarProvider.js", () => ({
  providerCalendarEventExists: mocks.calendarEventExists,
  deleteProviderCalendarEvent: mocks.deleteCalendarEvent,
  listProviderCalendarEvents: mocks.listCalendarEvents,
  listProviderCalendarEventIds: mocks.listCalendarEventIds,
}));
vi.mock("@receptionist/core/providers/slack.js", () => ({ notifySlack: vi.fn(async () => false) }));
vi.mock("@receptionist/core/repositories/agents.js", () => mocks);

import { appointments } from "./route.js";

const app = new Hono<AppEnv>()
  .use("*", async (c, next) => {
    c.set("agentId", "agent-1");
    c.set("workspaceOwner", true);
    c.set("workspaceRole", "manager");
    c.set("authUser", { id: "owner-1" } as never);
    await next();
  })
  .route("/appointments", appointments);
app.onError((_error, c) => c.json({ error: "failed" }, 500));

const memberApp = new Hono<AppEnv>()
  .use("*", async (c, next) => {
    c.set("agentId", "agent-1");
    c.set("workspaceOwner", false);
    c.set("workspaceRole", "member");
    c.set("authUser", { id: "member-1" } as never);
    await next();
  })
  .route("/appointments", appointments);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAgentCalendarAccess.mockResolvedValue({
    accounts: [{ connectionId: "connection-1", provider: "google", accountEmail: "first@example.test", colorIndex: 0 }],
    booking: { connectionId: "connection-1", provider: "google", calendarId: "cal-1", token: "token-1" },
    conflicts: [{ connectionId: "connection-1", provider: "google", calendarIds: ["cal-1"], token: "token-1" }],
  });
  mocks.getAgentById.mockResolvedValue({ id: "agent-1", calendarExternalId: "cal-1", calendarPayload: { bookingConnectionId: "connection-1" } });
  mocks.listCalendars.mockResolvedValue([{ id: "cal-1", summary: "Primary", primary: true }]);
  mocks.listAppointments.mockResolvedValue([]);
  mocks.getCalendarConnectionToken.mockResolvedValue({ connectionId: "connection-1", provider: "google", token: "token-1" });
  mocks.calendarEventExists.mockResolvedValue(false);
});

describe("dashboard appointment cancellation", () => {
  it("deletes the Google event before changing the local status", async () => {
    mocks.getAppointmentById.mockResolvedValue({
      id: "appt-1",
      status: "confirmed",
      externalEventId: "evt-1",
      externalCalendarId: "cal-1",
    });
    mocks.cancelAppointmentById.mockResolvedValue({ id: "appt-1" });

    const response = await app.request("/appointments/appt-1", { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(mocks.deleteCalendarEvent.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.cancelAppointmentById.mock.invocationCallOrder[0],
    );
  });

  it("leaves the appointment confirmed when Google rejects deletion", async () => {
    mocks.getAppointmentById.mockResolvedValue({
      id: "appt-1",
      status: "confirmed",
      externalEventId: "evt-1",
      externalCalendarId: "cal-1",
    });
    mocks.deleteCalendarEvent.mockRejectedValue(new Error("Google unavailable"));

    const response = await app.request("/appointments/appt-1", { method: "DELETE" });

    expect(response.status).toBe(500);
    expect(mocks.cancelAppointmentById).not.toHaveBeenCalled();
  });
});

describe("explicit calendar refresh", () => {
  it("cancels local rows whose Google events were removed", async () => {
    mocks.listConfirmedAppointmentsForSync.mockResolvedValue([
      {
        id: "still-there",
        startTime: new Date("2026-09-10T15:00:00Z"),
        endTime: new Date("2026-09-10T16:00:00Z"),
        externalEventId: "evt-1",
        externalCalendarId: "cal-1",
      },
      {
        id: "removed",
        startTime: new Date("2026-09-11T15:00:00Z"),
        endTime: new Date("2026-09-11T16:00:00Z"),
        externalEventId: "evt-2",
        externalCalendarId: "cal-1",
      },
    ]);
    mocks.listCalendarEventIds.mockResolvedValue(new Set(["evt-1"]));
    mocks.cancelAppointmentById.mockResolvedValue({ id: "removed" });

    const response = await app.request("/appointments/sync", { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checked: 2,
      cancelledIds: ["removed"],
      appointments: [],
    });
    expect(mocks.cancelAppointmentById).toHaveBeenCalledWith("removed", "agent-1");
  });
});

describe("calendar view", () => {
  it("returns events from the calendar selected by this owner", async () => {
    mocks.listCalendarEvents.mockResolvedValue([
      {
        id: "personal-1",
        title: "Dentist",
        start: "2026-09-10T15:00:00Z",
        end: "2026-09-10T16:00:00Z",
        allDay: false,
        calendarId: "cal-1",
      },
    ]);

    const response = await app.request(
      "/appointments/calendar?timeMin=2026-09-01T00:00:00.000Z&timeMax=2026-10-01T00:00:00.000Z",
    );

    expect(response.status).toBe(200);
    expect((await response.json()).events[0]?.title).toBe("Dentist");
    expect(mocks.listCalendarEvents).toHaveBeenCalledWith(
      "google",
      "token-1",
      "cal-1",
      "2026-09-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("lets a member read shared bookings without exposing owner calendar events", async () => {
    mocks.listAppointments.mockResolvedValue([{ id: "shared", service: "Demo", status: "confirmed",
      startTime: new Date("2026-09-10T15:00:00Z"), endTime: new Date("2026-09-10T16:00:00Z") }]);
    const response = await memberApp.request(
      "/appointments/calendar?timeMin=2026-09-01T00:00:00.000Z&timeMax=2026-10-01T00:00:00.000Z",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ events: [{ title: "Demo", calendarId: "workspace" }], sources: [] });
    expect(mocks.getAgentCalendarAccess).not.toHaveBeenCalled();
    expect(mocks.listCalendarEvents).not.toHaveBeenCalled();
  });

  it("keeps appointment mutations manager-only", async () => {
    expect((await memberApp.request("/appointments/shared", { method: "DELETE" })).status).toBe(403);
    expect((await memberApp.request("/appointments/sync", { method: "POST" })).status).toBe(403);
    expect(mocks.cancelAppointmentById).not.toHaveBeenCalled();
  });
});

describe("saved calendar identity and moved events", () => {
  it("cancels using the original account after the booking destination changes", async () => {
    mocks.getAppointmentById.mockResolvedValue({ id: "old", status: "confirmed", externalEventId: "old-event",
      externalCalendarId: "old-calendar", externalCalendarConnectionId: "old-connection" });
    mocks.getCalendarConnectionToken.mockResolvedValue({ connectionId: "old-connection", provider: "google", token: "old-token" });
    mocks.cancelAppointmentById.mockResolvedValue({ id: "old" });
    const result = await app.request("/appointments/old", { method: "DELETE" });
    expect(result.status).toBe(200);
    expect(mocks.getCalendarConnectionToken).toHaveBeenCalledWith("agent-1", "old-connection");
    expect(mocks.deleteCalendarEvent).toHaveBeenCalledWith("google", "old-token", "old-calendar", "old-event");
    expect(mocks.getAgentCalendarAccess).not.toHaveBeenCalled();
  });

  it("does not cancel locally after the original account is disconnected", async () => {
    mocks.getAppointmentById.mockResolvedValue({ id: "old", status: "confirmed", externalEventId: "old-event",
      externalCalendarId: "old-calendar", externalCalendarConnectionId: "old-connection" });
    mocks.getCalendarConnectionToken.mockResolvedValue(null);
    expect((await app.request("/appointments/old", { method: "DELETE" })).status).toBe(409);
    expect(mocks.cancelAppointmentById).not.toHaveBeenCalled();
    expect(mocks.deleteCalendarEvent).not.toHaveBeenCalled();
  });

  it("does not mistake a moved Google event for a deletion", async () => {
    mocks.listConfirmedAppointmentsForSync.mockResolvedValue([{
      id: "moved", externalEventId: "moved-event", externalCalendarId: "cal-1", externalCalendarConnectionId: "connection-1",
      startTime: new Date("2026-09-10T15:00:00Z"), endTime: new Date("2026-09-10T16:00:00Z"),
    }]);
    mocks.listCalendarEventIds.mockResolvedValue(new Set());
    mocks.calendarEventExists.mockResolvedValue(true);
    const result = await app.request("/appointments/sync", { method: "POST" });
    expect(result.status).toBe(200);
    expect(mocks.calendarEventExists).toHaveBeenCalledWith("google", "token-1", "cal-1", "moved-event");
    expect(mocks.cancelAppointmentById).not.toHaveBeenCalled();
  });

  it("leaves every local appointment unchanged when deletion verification fails", async () => {
    mocks.listConfirmedAppointmentsForSync.mockResolvedValue([{
      id: "uncertain", externalEventId: "event", externalCalendarId: "cal-1", externalCalendarConnectionId: "connection-1",
      startTime: new Date("2026-09-10T15:00:00Z"), endTime: new Date("2026-09-10T16:00:00Z"),
    }]);
    mocks.listCalendarEventIds.mockResolvedValue(new Set());
    mocks.calendarEventExists.mockRejectedValue(new Error("provider unavailable"));
    expect((await app.request("/appointments/sync", { method: "POST" })).status).toBe(500);
    expect(mocks.cancelAppointmentById).not.toHaveBeenCalled();
  });
});


describe("past appointment history deletion", () => {
  it("deletes an ended local appointment without calling Google when it has no linked event", async () => {
    mocks.getAppointmentById.mockResolvedValue({ id: "past", endTime: new Date(Date.now() - 1000) });
    mocks.deletePastAppointment.mockResolvedValue(true);
    const response = await app.request("/appointments/history/past", { method: "DELETE" });
    expect(response.status).toBe(200);
    expect(mocks.getAppointmentById).toHaveBeenCalledWith("past", "agent-1");
    expect(mocks.deletePastAppointment).toHaveBeenCalledWith("agent-1", "past");
    expect(mocks.deleteCalendarEvent).not.toHaveBeenCalled();
    expect(mocks.getCalendarConnectionToken).not.toHaveBeenCalled();
  });

  it("does not delete another owner's appointment", async () => {
    mocks.getAppointmentById.mockResolvedValue(null);
    expect((await app.request("/appointments/history/other", { method: "DELETE" })).status).toBe(404);
    expect(mocks.deletePastAppointment).not.toHaveBeenCalled();
  });

  it.each([null, new Date(Date.now() + 86_400_000)])("rejects unknown or future end times: %s", async endTime => {
    mocks.getAppointmentById.mockResolvedValue({ id: "ongoing", endTime });
    expect((await app.request("/appointments/history/ongoing", { method: "DELETE" })).status).toBe(409);
    expect(mocks.deletePastAppointment).not.toHaveBeenCalled();
  });

  it("reports a conflict if the row changes before the guarded deletion", async () => {
    mocks.getAppointmentById.mockResolvedValue({ id: "past", endTime: new Date(Date.now() - 1000) });
    mocks.deletePastAppointment.mockResolvedValue(false);
    expect((await app.request("/appointments/history/past", { method: "DELETE" })).status).toBe(409);
  });
});

describe("multiple-account calendar display", () => {
  it("reads every selected calendar across accounts and reads shared calendars only once", async () => {
    mocks.getAgentCalendarAccess.mockResolvedValue({ accounts: [
      { connectionId: "connection-1", provider: "google", accountEmail: "first@example.test", colorIndex: 0 },
      { connectionId: "connection-2", provider: "google", accountEmail: "second@example.test", colorIndex: 1 },
    ], conflicts: [
      { connectionId: "connection-1", provider: "google", token: "token-1", calendarIds: ["cal-1", "shared"] },
      { connectionId: "connection-2", provider: "google", token: "token-2", calendarIds: ["cal-2", "shared"] },
    ] });
    mocks.listCalendarEvents.mockImplementation(async (_provider, _token, calendarId) => [{ id: "event", calendarId }]);
    const response = await app.request("/appointments/calendar?timeMin=2026-09-01T00:00:00Z&timeMax=2026-10-01T00:00:00Z");
    expect(response.status).toBe(200);
    expect(mocks.listCalendarEvents).toHaveBeenCalledTimes(3);
    expect(mocks.listCalendarEvents).toHaveBeenCalledWith("google", "token-2", "cal-2", "2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z");
    const body = await response.json();
    expect(body.events.map((event: { calendarId: string }) => event.calendarId)).toEqual(["cal-1", "shared", "cal-2"]);
    expect(body.sources.find((source: { calendarId: string }) => source.calendarId === "cal-2")).toMatchObject({
      connectionId: "connection-2", accountEmail: "second@example.test", colorIndex: 1,
    });
    expect(JSON.stringify(body)).not.toContain("token-");
  });
});


describe("calendar source legend", () => {
  it("returns selected sources even when the displayed month has no events", async () => {
    mocks.listCalendarEvents.mockResolvedValue([]);
    const response = await app.request("/appointments/calendar?timeMin=2026-09-01&timeMax=2026-10-01");
    const body = await response.json();
    expect(body.events).toEqual([]);
    expect(body.sources).toEqual([{ connectionId: "connection-1", provider: "google", accountEmail: "first@example.test", colorIndex: 0, calendarId: "cal-1", calendarName: "cal-1" }]);
  });
});


describe("past Google event deletion", () => {
  const past = { id: "past", endTime: new Date(0), externalEventId: "event-old", externalCalendarId: "cal-old", externalCalendarConnectionId: "connection-old" };
  it("uses the saved account and deletes Google before the local record", async () => {
    mocks.getAppointmentById.mockResolvedValue(past);
    mocks.deletePastAppointment.mockResolvedValue(true);
    expect((await app.request("/appointments/history/past", { method: "DELETE" })).status).toBe(200);
    expect(mocks.getCalendarConnectionToken).toHaveBeenCalledWith("agent-1", "connection-old");
    expect(mocks.deleteCalendarEvent).toHaveBeenCalledWith("google", "token-1", "cal-old", "event-old");
    expect(mocks.deleteCalendarEvent.mock.invocationCallOrder[0]).toBeLessThan(mocks.deletePastAppointment.mock.invocationCallOrder[0]);
  });
  it("keeps local history after a provider failure", async () => {
    mocks.getAppointmentById.mockResolvedValue(past);
    mocks.deleteCalendarEvent.mockRejectedValue(new Error("provider offline"));
    expect((await app.request("/appointments/history/past", { method: "DELETE" })).status).toBe(500);
    expect(mocks.deletePastAppointment).not.toHaveBeenCalled();
  });
  it("keeps history when the original account is disconnected", async () => {
    mocks.getAppointmentById.mockResolvedValue(past);
    mocks.getCalendarConnectionToken.mockResolvedValue(null);
    expect((await app.request("/appointments/history/past", { method: "DELETE" })).status).toBe(409);
    expect(mocks.deletePastAppointment).not.toHaveBeenCalled();
  });
});
