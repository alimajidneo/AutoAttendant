import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBusyRanges } from "./calendar.js";

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
});
