import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMicrosoftCalendarEvent,
  fetchMicrosoftBusyRanges,
  listMicrosoftCalendars,
} from "./microsoftCalendar.js";

const request = vi.fn();
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", request); });
afterEach(() => vi.unstubAllGlobals());

describe("Microsoft Calendar", () => {
  it("lists only explicitly editable calendars", async () => {
    request.mockResolvedValue(response({ value: [
      { id: "main", name: "Calendar", isDefaultCalendar: true, canEdit: true },
      { id: "read-only", name: "Birthdays", canEdit: false },
      { id: "unknown", name: "Shared" },
    ] }));
    const calendars = await listMicrosoftCalendars("token");
    expect(calendars.map(item => [item.id, item.writable])).toEqual([
      ["main", true], ["read-only", false], ["unknown", false],
    ]);
  });

  it("treats busy and tentative events as conflicts while ignoring free and cancelled events", async () => {
    request.mockResolvedValue(response({ value: [
      { id: "busy", showAs: "busy", start: { dateTime: "2026-09-10T09:00:00" }, end: { dateTime: "2026-09-10T10:00:00" } },
      { id: "tentative", showAs: "tentative", start: { dateTime: "2026-09-10T11:00:00" }, end: { dateTime: "2026-09-10T12:00:00" } },
      { id: "free", showAs: "free", start: { dateTime: "2026-09-10T13:00:00" }, end: { dateTime: "2026-09-10T14:00:00" } },
      { id: "cancelled", isCancelled: true, start: { dateTime: "2026-09-10T15:00:00" }, end: { dateTime: "2026-09-10T16:00:00" } },
    ] }));
    const busy = await fetchMicrosoftBusyRanges("token", "calendar", "2026-09-10T00:00:00Z", "2026-09-11T00:00:00Z");
    expect(busy.map(item => item.start.toISOString())).toEqual([
      "2026-09-10T09:00:00.000Z", "2026-09-10T11:00:00.000Z",
    ]);
  });

  it("creates an event in the selected calendar with UTC boundaries", async () => {
    request.mockResolvedValue(response({ id: "event-1" }));
    await expect(createMicrosoftCalendarEvent("token", "calendar", {
      summary: "Demo", startIso: "2026-09-10T09:00:00.000Z", endIso: "2026-09-10T09:30:00.000Z",
      timezone: "America/New_York", description: "Booked by DeskRoute",
    })).resolves.toBe("event-1");
    const body = JSON.parse(request.mock.calls[0]![1].body as string);
    expect(body.start).toEqual({ dateTime: "2026-09-10T09:00:00.000", timeZone: "UTC" });
    expect(body.transactionId).toEqual(expect.any(String));
  });
});

it('fails closed when a calendar page is partial instead of treating it as empty', async () => {
  request.mockResolvedValue(response({}));
  await expect(fetchMicrosoftBusyRanges('token', ['calendar'], '2026-09-14T10:00:00Z', '2026-09-14T11:00:00Z')).rejects.toThrow();
});
