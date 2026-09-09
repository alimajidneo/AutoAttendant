import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { createAgentTools } from "./tools.js";
import { makeAgentConfig, makeAgentDeps } from "./fixtures.js";
import { createEscalation } from "@receptionist/core/repositories/escalations.js";
import { setCallerName } from "@receptionist/core/repositories/callers.js";
import { createCalendarEvent, deleteCalendarEvent, fetchBusyRanges } from "@receptionist/core/providers/calendar.js";
import {
  cancelAppointmentById,
  createAppointment,
  getAppointmentById,
} from "@receptionist/core/repositories/appointments.js";

/**
 * Every tool's `execute` must return a value to the model. A tool that resolves
 * to a closure reports success with no output, and typecheck cannot see it.
 */

const okCalendar = () =>
  makeAgentDeps({
    calendarExternalId: "cal-1",
    getCalendarAccess: async () => ({
      booking: { connectionId: "00000000-0000-4000-8000-000000000001", calendarId: "primary", token: "token-1" },
      conflicts: [{ connectionId: "00000000-0000-4000-8000-000000000001", calendarIds: ["primary"], token: "token-1" }],
    }),
  });

beforeEach(() => {
  vi.restoreAllMocks();
  // `restoreAllMocks` only undoes spies, so plain `vi.fn()` history survives and
  // `mock.calls[0]` becomes the first test's call.
  vi.clearAllMocks();
});

afterEach(() => vi.useRealTimers());

vi.mock("@receptionist/core/providers/calendar.js", () => ({
  fetchBusyRanges: vi.fn(async () => []),
  createCalendarEvent: vi.fn(async () => "evt-1"),
  deleteCalendarEvent: vi.fn(async () => {}),
}));

vi.mock("@receptionist/core/repositories/appointments.js", () => ({
  createAppointment: vi.fn(async () => ({ id: "appt-1" })),
  getUpcomingByPhone: vi.fn(async () => []),
  getAppointmentById: vi.fn(async () => null),
  cancelAppointmentById: vi.fn(async () => null),
}));

vi.mock("@receptionist/core/repositories/escalations.js", () => ({
  createEscalation: vi.fn(async () => ({ id: "esc-1" })),
}));

vi.mock("@receptionist/core/repositories/callers.js", () => ({
  setCallerName: vi.fn(async () => null),
}));

/** The RunContext the SDK passes; only `session` is touched by these tools. */
const runCtx = () => ({ ctx: { session: { say: vi.fn(), shutdown: vi.fn() } } }) as never;

/** Escalation also reaches for `speechHandle`, to stop being interrupted. */
const escalationCtx = () =>
  ({ ctx: { speechHandle: {}, session: { say: vi.fn() } } }) as never;

describe("every tool returns a result to the model", () => {
  it("checks calendars from every connected Google account", async () => {
    const deps = okCalendar();
    deps.getCalendarAccess = async () => ({
      booking: { connectionId: "connection-1", calendarId: "cal-1", token: "token-1" },
      conflicts: [
        { connectionId: "connection-1", calendarIds: ["cal-1", "cal-2"], token: "token-1" },
        { connectionId: "connection-2", calendarIds: ["work"], token: "token-2" },
      ],
    });
    const tools = createAgentTools(deps);
    await tools.checkAvailability.execute(
      { service: "Meeting", preferredDate: null, preferredTime: null, partOfDay: null },
      runCtx(),
    );
    expect(fetchBusyRanges).toHaveBeenCalledTimes(2);
    expect(fetchBusyRanges).toHaveBeenCalledWith("token-1", ["cal-1", "cal-2"], expect.any(String), expect.any(String));
    expect(fetchBusyRanges).toHaveBeenCalledWith("token-2", ["work"], expect.any(String), expect.any(String));
  });

  it("checkAvailability returns slots, not a function", async () => {
    const tools = createAgentTools(okCalendar());
    const result = await tools.checkAvailability.execute(
      { service: "Haircut", preferredDate: null, preferredTime: null, partOfDay: null },
      runCtx()
    );

    expect(typeof result, "a tool must never resolve to a function").not.toBe("function");
    expect(result).toBeDefined();
    // Either real slots or an explicit note — never undefined, never a closure.
    expect(result).toEqual(
      expect.objectContaining({ ...(("slots" in result!) ? {} : { note: expect.anything() }) })
    );
    expect("slots" in result! || "note" in result! || "error" in result!).toBe(true);
  });

  it("bookAppointment returns a result for an unknown slot", async () => {
    const tools = createAgentTools(okCalendar());
    const result = await tools.bookAppointment.execute(
      { slotId: "nope", callerName: "Prabhat", bookingAnswers: [] },
      runCtx()
    );

    expect(typeof result).not.toBe("function");
    expect(result).toHaveProperty("error");
  });

  it("bookAppointment returns a result for a held slot", async () => {
    const deps = okCalendar();
    const tools = createAgentTools(deps);

    // Offer a slot first, exactly as a real call does.
    const offered = (await tools.checkAvailability.execute(
      { service: "Haircut", preferredDate: null, preferredTime: null, partOfDay: null },
      runCtx()
    )) as { slots?: { slotId: string }[] };

    const slotId = offered.slots?.[0]?.slotId;
    expect(slotId, "checkAvailability produced no bookable slot").toBeDefined();

    const result = await tools.bookAppointment.execute(
      { slotId: slotId!, callerName: "Prabhat", bookingAnswers: [] },
      runCtx()
    );

    expect(typeof result).not.toBe("function");
    expect(result).toEqual(expect.objectContaining({ booked: true }));
  });

  it("lookupAppointments returns a result", async () => {
    const tools = createAgentTools(makeAgentDeps({ callerPhone: "+14155550123" }));
    const result = await tools.lookupAppointments.execute({}, runCtx());

    expect(typeof result).not.toBe("function");
    expect(result).toHaveProperty("appointments");
  });

  it("cancelAppointment returns a result", async () => {
    const tools = createAgentTools(okCalendar());
    const result = await tools.cancelAppointment.execute(
      { appointmentId: "appt-1" },
      runCtx()
    );

    expect(typeof result).not.toBe("function");
    expect(result).toHaveProperty("error");
  });

  it("createEscalation returns a result", async () => {
    const tools = createAgentTools(makeAgentDeps());
    const result = await tools.createEscalation.execute(
      { question: "Do you have parking?", callerName: null, transcriptExcerpt: null },
      escalationCtx()
    );

    expect(typeof result).not.toBe("function");
    expect(result).toEqual({ escalated: true });
  });
});

describe("requested appointment time", () => {
  it("offers an available exact time before earlier slots", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
    const tools = createAgentTools(okCalendar());

    const result = (await tools.checkAvailability.execute(
      {
        service: "Haircut",
        preferredDate: "2026-09-09",
        preferredTime: "11:00",
        partOfDay: null,
      },
      runCtx(),
    )) as { slots?: Array<{ time: string }> };

    expect(result.slots?.[0]?.time).toContain("11:00 AM");
  });
});

describe("general appointments", () => {
  it("offers and books a purpose that is not a declared service", async () => {
    const tools = createAgentTools(okCalendar());
    const offered = (await tools.checkAvailability.execute(
      {
        service: "Project consultation",
        preferredDate: null,
        preferredTime: null,
        partOfDay: null,
      },
      runCtx(),
    )) as { service?: string; slots?: Array<{ slotId: string }> };

    expect(offered.service).toBe("Project consultation");
    expect(offered.slots?.[0]?.slotId).toBeDefined();

    await tools.bookAppointment.execute(
      { slotId: offered.slots![0]!.slotId, callerName: "Dana", bookingAnswers: [] },
      runCtx(),
    );
    expect(vi.mocked(createAppointment)).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: null,
        serviceName: "Project consultation",
      }),
    );
  });
});

describe("appointment intake", () => {
  it("does not book until every configured question has an answer", async () => {
    const deps = okCalendar();
    deps.agent = makeAgentConfig({ bookingQuestions: ["What would you like to discuss?"] });
    const tools = createAgentTools(deps);
    const offered = (await tools.checkAvailability.execute(
      { service: "Consultation", preferredDate: null, preferredTime: null, partOfDay: null },
      runCtx(),
    )) as { slots?: Array<{ slotId: string }> };

    const missing = await tools.bookAppointment.execute(
      { slotId: offered.slots![0]!.slotId, callerName: "Dana", bookingAnswers: [] },
      runCtx(),
    );
    expect(missing).toEqual(expect.objectContaining({ questions: deps.agent.bookingQuestions }));
    expect(createAppointment).not.toHaveBeenCalled();

    await tools.bookAppointment.execute(
      {
        slotId: offered.slots![0]!.slotId,
        callerName: "Dana",
        bookingAnswers: ["A product demonstration"],
      },
      runCtx(),
    );
    expect(createAppointment).toHaveBeenCalledWith(expect.objectContaining({
      bookingDetails: [{
        question: "What would you like to discuss?",
        answer: "A product demonstration",
      }],
    }));
  });
});

describe("appointment cancellation", () => {
  it("removes the Google event before marking the appointment cancelled", async () => {
    vi.mocked(getAppointmentById).mockResolvedValueOnce({
      id: "appt-1",
      agentId: "11111111-1111-1111-1111-111111111111",
      status: "confirmed",
      callerPhone: "+14155550123",
      externalEventId: "evt-1",
      externalCalendarId: "cal-1",
    } as never);
    vi.mocked(cancelAppointmentById).mockResolvedValueOnce({ id: "appt-1" } as never);
    const tools = createAgentTools(okCalendar());

    const result = await tools.cancelAppointment.execute(
      { appointmentId: "appt-1" },
      runCtx(),
    );

    expect(result).toEqual({ cancelled: true, appointmentId: "appt-1" });
    expect(vi.mocked(deleteCalendarEvent).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(cancelAppointmentById).mock.invocationCallOrder[0]!,
    );
  });
});

/** Asking is enforced by the schema, so the model cannot escalate without
 *  confronting the field. */
describe("the caller's name", () => {
  it("is recorded on the escalation when the caller gives one", async () => {
    const tools = createAgentTools(makeAgentDeps());
    await tools.createEscalation.execute(
      { question: "Do you take cats?", callerName: "Dana", transcriptExcerpt: null },
      escalationCtx()
    );

    expect(vi.mocked(createEscalation).mock.calls[0]?.[0]).toMatchObject({
      callerName: "Dana",
    });
  });

  it("is null when they were asked and declined", async () => {
    const tools = createAgentTools(makeAgentDeps());
    await tools.createEscalation.execute(
      { question: "Do you take cats?", callerName: null, transcriptExcerpt: null },
      escalationCtx()
    );

    expect(vi.mocked(createEscalation).mock.calls[0]?.[0]).toMatchObject({
      callerName: null,
    });
  });

  it("falls back to the name already on the client row", async () => {
    // A returning caller who does not say their name again is still known.
    const tools = createAgentTools(
      makeAgentDeps({ caller: { id: "cli-1", name: "Marcus" } as never })
    );
    await tools.createEscalation.execute(
      { question: "Do you take cats?", callerName: null, transcriptExcerpt: null },
      escalationCtx()
    );

    expect(vi.mocked(createEscalation).mock.calls[0]?.[0]).toMatchObject({
      callerName: "Marcus",
    });
  });

  it("is remembered for the next call, through the same helper booking uses", async () => {
    // The point of extracting `resolveCallerName`: escalation persists the name
    // exactly as booking does, rather than carrying a second copy that drifts.
    vi.mocked(setCallerName).mockResolvedValueOnce({
      id: "cli-1",
      name: "Dana",
    } as never);

    const tools = createAgentTools(
      makeAgentDeps({ caller: { id: "cli-1", name: null } as never })
    );
    await tools.createEscalation.execute(
      { question: "Do you take cats?", callerName: "  Dana  ", transcriptExcerpt: null },
      escalationCtx()
    );

    expect(vi.mocked(setCallerName)).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      "cli-1",
      "Dana",
    );
  });
});

describe("cross-account scheduling privacy", () => {
  it("excludes 11 AM when the second account is busy and offers it when free", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
    const deps = okCalendar();
    deps.getCalendarAccess = async () => ({
      booking: { connectionId: "work", calendarId: "cal-1", token: "work-token" },
      conflicts: [
        { connectionId: "work", calendarIds: ["cal-1"], token: "work-token" },
        { connectionId: "personal", calendarIds: ["home"], token: "personal-token" },
      ],
    });
    const tools = createAgentTools(deps);
    vi.mocked(fetchBusyRanges).mockImplementationOnce(async () => [])
      .mockImplementationOnce(async () => [{ start: new Date("2026-09-09T15:00:00Z"), end: new Date("2026-09-09T16:00:00Z") }]);
    const args = { service: "Meeting", preferredDate: "2026-09-09", preferredTime: "11:00", partOfDay: null } as const;
    const blocked = await tools.checkAvailability.execute(args, runCtx()) as { slots: Array<{ time: string }> };
    expect(blocked.slots.some(slot => slot.time.includes("11:00 AM"))).toBe(false);
    const free = await tools.checkAvailability.execute(args, runCtx()) as { slots: Array<{ time: string }> };
    expect(free.slots[0]?.time).toContain("11:00 AM");
    expect(JSON.stringify(free)).not.toMatch(/personal-token|work-token|home|cal-1/);
  });

  it("does not create an event when a selected account fails on the final recheck", async () => {
    const tools = createAgentTools(okCalendar());
    const offered = await tools.checkAvailability.execute({ service: "Meeting", preferredDate: null, preferredTime: null, partOfDay: null }, runCtx()) as { slots: Array<{ slotId: string }> };
    vi.mocked(fetchBusyRanges).mockRejectedValueOnce(new Error("calendar unavailable"));
    const result = await tools.bookAppointment.execute({ slotId: offered.slots[0]!.slotId, callerName: "Dana", bookingAnswers: [] }, runCtx());
    expect(result).toHaveProperty("booked", false);
    expect(createCalendarEvent).not.toHaveBeenCalled();
    expect(createAppointment).not.toHaveBeenCalledWith(expect.objectContaining({ status: "confirmed" }));
  });

  it("prevents one caller cancelling another caller's appointment", async () => {
    vi.mocked(getAppointmentById).mockResolvedValueOnce({ id: "private", status: "confirmed", callerPhone: "+14155550999" } as never);
    const result = await createAgentTools(okCalendar()).cancelAppointment.execute({ appointmentId: "private" }, runCtx());
    expect(result).toHaveProperty("error");
    expect(cancelAppointmentById).not.toHaveBeenCalled();
    expect(deleteCalendarEvent).not.toHaveBeenCalled();
  });
});
