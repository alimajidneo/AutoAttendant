import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteCalendarEvent,
  listCalendars,
  calendarEventExists,
  fetchBusyRanges,
  listCalendarEvents,
  listCalendarEventIds,
} from "./calendar.js";

afterEach(() => vi.unstubAllGlobals());
describe("Calendar availability", () => {
  it.each([
    { calendars: {} },
    { calendars: { selected: { errors: [{ reason: "notFound" }] } } },
    { calendars: { selected: {} } },
  ])("does not treat an unavailable calendar as free time", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(fetchBusyRanges("token", "selected", "2026-09-08T12:00:00Z", "2026-09-08T13:00:00Z")).rejects.toThrow("availability could not be verified");
  });
  it("accepts an explicitly empty busy list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ calendars: { selected: { busy: [] } } }))));
    expect(await fetchBusyRanges("token", "selected", "2026-09-08T12:00:00Z", "2026-09-08T13:00:00Z")).toEqual([]);
  });

  it("combines busy time from every selected calendar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      calendars: {
        work: { busy: [{ start: "2026-09-08T12:00:00Z", end: "2026-09-08T13:00:00Z" }] },
        personal: { busy: [{ start: "2026-09-08T15:00:00Z", end: "2026-09-08T16:00:00Z" }] },
      },
    }))));

    const ranges = await fetchBusyRanges(
      "token",
      ["work", "personal"],
      "2026-09-08T12:00:00Z",
      "2026-09-08T17:00:00Z",
    );

    expect(ranges.map((range) => range.start.toISOString())).toEqual([
      "2026-09-08T12:00:00.000Z",
      "2026-09-08T15:00:00.000Z",
    ]);
  });

  it("fails closed when any selected calendar cannot be checked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      calendars: { work: { busy: [] }, personal: { errors: [{ reason: "notFound" }] } },
    }))));

    await expect(fetchBusyRanges(
      "token",
      ["work", "personal"],
      "2026-09-08T12:00:00Z",
      "2026-09-08T17:00:00Z",
    )).rejects.toThrow("availability could not be verified");
  });
});

describe("Calendar events", () => {
  it.each([404, 410])("treats a missing event (%s) as already deleted", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status })));

    await expect(deleteCalendarEvent("token", "cal", "evt")).resolves.toBeUndefined();
  });

  it("collects event ids across Google pagination", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ id: "evt-1" }], nextPageToken: "next" })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ id: "evt-2" }] })),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listCalendarEventIds("token", "cal", "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z"),
    ).resolves.toEqual(new Set(["evt-1", "evt-2"]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns timed and all-day events for the calendar view", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "timed",
                summary: "Team meeting",
                start: { dateTime: "2026-09-09T15:00:00Z" },
                end: { dateTime: "2026-09-09T16:00:00Z" },
              },
              {
                id: "all-day",
                summary: "Personal day",
                start: { date: "2026-09-10" },
                end: { date: "2026-09-11" },
              },
            ],
          }),
        ),
      ),
    );

    await expect(
      listCalendarEvents("token", "cal", "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z"),
    ).resolves.toEqual([
      {
        id: "timed",
        title: "Team meeting",
        start: "2026-09-09T15:00:00Z",
        end: "2026-09-09T16:00:00Z",
        allDay: false,
        calendarId: "cal",
      },
      {
        id: "all-day",
        title: "Personal day",
        start: "2026-09-10",
        end: "2026-09-11",
        allDay: true,
        calendarId: "cal",
      },
    ]);
  });
});

describe("provider response boundaries", () => {
  it.each([
    { start: "invalid", end: "2026-09-09T16:00:00Z" },
    { start: "2026-09-09T16:00:00Z", end: "2026-09-09T15:00:00Z" },
    { start: null, end: "2026-09-09T15:00:00Z" },
  ])("rejects malformed busy periods", async block => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ calendars: { selected: { busy: [block] } } }))));
    await expect(fetchBusyRanges("token", "selected", "2026-09-09T12:00:00Z", "2026-09-09T17:00:00Z")).rejects.toThrow("availability could not be verified");
  });

  it("does not expose the provider's raw error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("PRIVATE EVENT / SECRET TOKEN", { status: 403 })));
    await expect(fetchBusyRanges("token", "selected", "2026-09-09T12:00:00Z", "2026-09-09T17:00:00Z")).rejects.toThrow(/^\[calendar\] freeBusy failed: 403$/);
  });

  it("includes calendars beyond Google's first page", async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      items: [{ id: "work", summary: "Work", accessRole: "owner" }], nextPageToken: "page-2",
    }))).mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "shared", summary: "Shared", accessRole: "reader" }] })));
    vi.stubGlobal("fetch", request);
    expect((await listCalendars("token")).map(item => [item.id, item.writable])).toEqual([["work", true], ["shared", false]]);
    expect(new URL(request.mock.calls[1]![0]).searchParams.get("pageToken")).toBe("page-2");
  });

  it.each([404, 410])("recognizes deleted events (%s)", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status })));
    expect(await calendarEventExists("token", "calendar", "event")).toBe(false);
  });

  it("keeps a confirmed event that has moved outside the date window", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "event", status: "confirmed" }))));
    expect(await calendarEventExists("token", "calendar", "event")).toBe(true);
  });
});
