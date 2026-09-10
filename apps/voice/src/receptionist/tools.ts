import { llm } from "@livekit/agents";
import { z } from "zod";
import type { AgentDeps } from "./deps.js";
import { getCalendarCredential } from "@receptionist/core/providers/calendarAccess.js";
import { createEscalation } from "@receptionist/core/repositories/escalations.js";
import { setCallerName } from "@receptionist/core/repositories/callers.js";
import {
  createProviderCalendarEvent,
  deleteProviderCalendarEvent,
  fetchProviderBusyRanges,
} from "@receptionist/core/providers/calendarProvider.js";
import {
  describeAppointmentWindow,
  describeDate,
  describeSlot,
  filterByBusy,
  findService,
  generateCandidateSlots,
  isOpenOn,
  rankSlotsForPreferredTime,
} from "@receptionist/core/domain/scheduling.js";
import {
  createAppointment,
  getUpcomingByPhone,
  cancelAppointmentById,
  getAppointmentById,
} from "@receptionist/core/repositories/appointments.js";
import { notifySlack } from "@receptionist/core/providers/slack.js";

/** How many times the agent reads out at once. More than three is unfollowable. */
const MAX_SLOTS_OFFERED = 3;

/** How far ahead to search when the caller did not name a day. */
const DEFAULT_SEARCH_DAYS = 14;
const GENERAL_APPOINTMENT_MINUTES = 30;

export function createAgentTools(deps: AgentDeps) {
  const agentId = deps.agent.id;
  const timeZone = deps.agent.timezone;
  const intakeQuestions = deps.agent.bookingQuestions;

  async function calendarAccess() {
    try { return await deps.getCalendarAccess(); }
    catch { return null; }
  }

  /**
   * A name given now beats one already stored, because people correct themselves.
   * Remembering it needs a caller row, which an anonymous caller does not have.
   */
  async function resolveCallerName(spoken: string | null): Promise<string | null> {
    const given = spoken?.trim() || null;

    if (given && deps.caller) {
      const updated = await setCallerName(agentId, deps.caller.id, given);
      if (updated) deps.caller = updated;
    }

    return given ?? deps.caller?.name ?? null;
  }

  /** No hold phrase: speech is a queue, so one stands in front of the tool's
   *  answer and the answer is discarded. */

  return {
    ...(deps.browserTransfer ? {
      transferDirectory: llm.tool({
        description: "When the caller asks for a person or department, list currently available teammates. Ask which person if several match. Never invent a destination.",
        parameters: z.object({}),
        execute: async () => deps.browserTransfer!.directory(),
      }),
      requestTransfer: llm.tool({
        description: "After the caller agrees, request a browser handoff to a teammate ID returned by transferDirectory. This requests acceptance; it does not mean the call is transferred. If unavailable, offer a message or appointment. Only one transfer attempt per test call.",
        parameters: z.object({ targetUserId: z.string() }),
        execute: async ({ targetUserId }) => deps.browserTransfer!.request(targetUserId),
      }),
    } : {}),
    createEscalation: llm.tool({
      description:
        "Record a question you could not answer, so the business owner can answer it later. " +
        "Use this only after checking everything you were given — the services, hours and knowledge in your instructions. " +
        "Also use it when the caller wants something you have no way to do, such as booking when no calendar is connected. " +
        "Say the fallback line to the caller first; this tool records the question, it does not reply to anyone. " +
        "Before calling this, ask for the caller's name — 'Can I take your name?' — because somebody has to ring them back. " +
        "At most once per question per call.",
      parameters: z.object({
        question: z.string().describe("The caller's question, as asked."),
        callerName: z
          .string()
          .nullable()
          .describe(
            "The name of the person to ring back. Ask for it before recording the question if you do not already know it. Pass null only if they were asked and declined.",
          ),
        transcriptExcerpt: z
          .string()
          .nullable()
          .describe("A short excerpt of recent conversation for context."),
      }),
      execute: async ({ question, callerName, transcriptExcerpt }, { ctx }) => {
        ctx.speechHandle.allowInterruptions = false;
        // `escalations.call_id` is a foreign key to a row written after the
        // greeting, so this waits rather than moving the insert onto the call path.
        const callRowExists = await deps.callRowReady;
        await createEscalation({
          agentId,
          // Unlinked rather than lost: without the row, the FK would reject the
          // insert and the tool would throw mid-call.
          callId: callRowExists ? deps.callId : null,
          callerId: deps.caller?.id ?? null,
          callerPhone: deps.callerPhone,
          callerName: await resolveCallerName(callerName),
          question,
          transcriptExcerpt,
        });
        deps.callState.wasEscalated = true;
        void notifySlack(agentId, "question").catch(err => console.error("[slack] question alert failed:", err));
        return { escalated: true };
      },
    }),

    rememberCallerName: llm.tool({
      description:
        "Remember the caller's name for future calls, when they offer it in conversation. " +
        "Do NOT ask for a name just to call this — only use a name the caller actually said. " +
        "You do not need this before booking: bookAppointment takes the name itself. " +
        "At most once per call.",
      parameters: z.object({
        name: z
          .string()
          .describe(
            "The caller's name as they said it, first name alone is fine. Not a spelling, not a title.",
          ),
      }),
      execute: async ({ name }) => {
        // No client row for an anonymous caller, so there is nothing to attach
        // a name to. Say nothing to the caller about it.
        if (!deps.caller) return { saved: false };

        const updated = await setCallerName(agentId, deps.caller.id, name);
        if (!updated) return { saved: false };

        // Keep in-memory deps in step so the rest of this call uses the name.
        deps.caller = updated;
        return { saved: true };
      },
    }),

    checkAvailability: llm.tool({
      description:
        "Find real, bookable times for a declared service or a general appointment. " +
        "You must call this before saying any time out loud — you have no way to know what is free otherwise, and a time you invent is a customer turning up to a closed door. " +
        "If the caller names an exact time, always pass it as preferredTime. General appointments that are not on the service list use 30 minutes. " +
        "Returns up to three slots, each with an id. Read the times to the caller in plain words and keep the ids to yourself.",
      parameters: z.object({
        service: z
          .string()
          .describe("The declared service or general appointment purpose, as the caller said it."),
        preferredDate: z
          .string()
          .nullable()
          .describe(
            "The date the caller asked for, as YYYY-MM-DD. Null if they did not name one.",
          ),
        preferredTime: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .nullable()
          .describe(
            "Required. The exact local time the caller asked for, as HH:mm; for example 11 AM is 11:00. Null only when they did not name a time.",
          ),
        partOfDay: z
          .enum(["morning", "afternoon", "evening"])
          .nullable()
          .describe("Only if the caller asked for a broad window and did not name an exact time. Null otherwise."),
      }),
      execute: async ({ service, preferredDate, preferredTime, partOfDay }) => {
        const calendarId = deps.calendarExternalId;
        if (!calendarId) {
          return {
            error:
              "No calendar is connected, so times cannot be checked. Create an escalation so the team can follow up.",
          };
        }

        const listed = findService(deps.services, service);
        const generalName = service.trim().slice(0, 120) || "Appointment";
        const matched = listed ?? {
          id: "general-appointment",
          name: generalName,
          price: "",
          durationMinutes: GENERAL_APPOINTMENT_MINUTES,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
          requiredResources: [],
        };

        const access = await calendarAccess();
        if (!access) {
          return {
            error:
              "Calendar authentication unavailable. Create an escalation.",
          };
        }

        const now = new Date();
        const hours = deps.agent.businessHours;
        const policy = {
          minNoticeMinutes: deps.agent.minNoticeMinutes,
          maxAdvanceDays: deps.agent.maxAdvanceDays,
        };

        // A closed day is not a dead end. Say so, then keep looking forward —
        // the caller still wants an appointment.
        const closedNote =
          preferredDate && !isOpenOn(hours, preferredDate)
            ? `The business is closed on ${describeDate(preferredDate, timeZone)}. Say so, then offer these instead.`
            : undefined;

        const candidates = generateCandidateSlots({
          hours,
          policy,
          service: matched,
          timeZone,
          now,
          fromDate: preferredDate ?? undefined,
          days: preferredDate && !closedNote ? 0 : DEFAULT_SEARCH_DAYS,
          partOfDay: preferredTime ? null : partOfDay,
        });

        if (candidates.length === 0) {
          return {
            slots: [],
            note: `No times are available${
              preferredDate
                ? ` around ${describeDate(preferredDate, timeZone)}`
                : ""
            }. Offer to have the team call back, or create an escalation.`,
          };
        }

        let free = candidates;
        try {
          const busy = (await Promise.all(access.conflicts.map(group => fetchProviderBusyRanges(
            group.provider, group.token, group.calendarIds,
            candidates[0]!.blockStart.toISOString(), candidates.at(-1)!.blockEnd.toISOString(),
          )))).flat();
          free = filterByBusy(candidates, busy);
        } catch (err) {
          console.error("[agent] freeBusy lookup failed:", err);
          return {
            error: "Could not check the calendar. Create an escalation.",
          };
        }

        if (free.length === 0) {
          return {
            slots: [],
            note: "Everything in that window is booked. Offer a different day.",
          };
        }

        const offered = rankSlotsForPreferredTime(
          free,
          preferredDate,
          preferredTime,
          timeZone,
        ).slice(0, MAX_SLOTS_OFFERED).map((slot) => {
          const slotId = `slot_${deps.slots.nextId++}`;
          deps.slots.held.set(slotId, {
            slot,
            service: matched,
            serviceId: listed?.id ?? null,
          });
          return { slotId, time: describeSlot(slot, timeZone) };
        });

        return {
          service: matched.name,
          slots: offered,
          ...(closedNote ? { note: closedNote } : {}),
        };
      },
    }),

    bookAppointment: llm.tool({
      description:
        "Confirm a booking for a slot that checkAvailability already offered. " +
        "Before calling this you need two things: the caller has chosen one of the times you read out, and you know their name. " +
        "If you do not have a name yet, ask for it now — 'Can I take your name?' — because the booking goes in the diary under it. " +
        (intakeQuestions.length
          ? `Also ask every configured appointment question, in this order: ${intakeQuestions.map((question, index) => `${index + 1}. ${question}`).join(" ")} `
          : "There are no additional appointment questions. ") +
        "Never invent a slotId, and never call this for a time you did not offer.",
      parameters: z.object({
        slotId: z
          .string()
          .describe(
            "The id of the slot the caller chose, exactly as checkAvailability returned it.",
          ),
        callerName: z
          .string()
          .nullable()
          .describe(
            "The name to put in the diary. Ask the caller for it before booking if you do not already know it. Pass null only if they were asked and declined to give one.",
          ),
        bookingAnswers: z
          .array(z.string().trim().min(1).max(500))
          .max(10)
          .describe(
            "The caller's answers to the configured appointment questions, in the same order. Pass an empty array when no questions are configured.",
          ),
      }),
      execute: async ({ slotId, callerName, bookingAnswers }) => {
        const held = deps.slots.held.get(slotId);
        if (!held) {
          // The model made one up, or referred to an offer from before a
          // re-check. Either way, do not book something never offered.
          return {
            error:
              "That time is no longer held. Call checkAvailability again and offer the caller a fresh set of times.",
          };
        }

        const { slot, service, serviceId } = held;
        if (bookingAnswers.length !== intakeQuestions.length) {
          return {
            error: "Collect every configured appointment detail before booking.",
            questions: intakeQuestions,
          };
        }
        const bookingDetails = intakeQuestions.map((question, index) => ({
          question,
          answer: bookingAnswers[index]!,
        }));
        const access = await calendarAccess();
        const bookedName = await resolveCallerName(callerName);

        const appointmentBase = {
          agentId,
          callerId: deps.caller?.id ?? null,
          callerPhone: deps.callerPhone,
          callerName: bookedName,
          serviceId,
          serviceName: service.name,
          startTime: slot.start,
          endTime: slot.end,
          bookingDetails,
        };

        if (!access || !deps.calendarExternalId) {
          await createAppointment({
            ...appointmentBase,
            status: "requested",
          });
          void notifySlack(agentId, "request").catch(err => console.error("[slack] request alert failed:", err));
          deps.callState.wasBooked = true;
          return {
            booked: false,
            reason:
              "Calendar not connected — appointment request saved, team will confirm.",
          };
        }

        try {
          // The slot was computed while the caller was deciding, so it is
          // re-checked immediately before the write.
          const busy = (await Promise.all(access.conflicts.map(group => fetchProviderBusyRanges(
            group.provider, group.token, group.calendarIds, slot.blockStart.toISOString(), slot.blockEnd.toISOString(),
          )))).flat();
          if (filterByBusy([slot], busy).length === 0) {
            deps.slots.held.delete(slotId);
            return {
              error:
                "That time was taken while you were talking. Call checkAvailability again and offer what is left.",
            };
          }

          const padded =
            service.bufferBeforeMinutes > 0 || service.bufferAfterMinutes > 0
              ? ` (appointment ${describeSlot(slot, timeZone)}; includes setup and cleanup)`
              : "";

          const eventId = await createProviderCalendarEvent(
            access.booking.provider,
            access.booking.token,
            access.booking.calendarId,
            {
              // The title leads with the appointment window: the event spans the
              // padded block and Google renders it in the viewer's timezone.
              summary: `${service.name} ${describeAppointmentWindow(slot, timeZone)} — ${
                bookedName ?? deps.callerPhone ?? "name not given"
              }`,
              // The block, not the appointment: the event must reserve setup and
              // cleanup or the next booking lands on top of them.
              startIso: slot.blockStart.toISOString(),
              endIso: slot.blockEnd.toISOString(),
              timezone: timeZone,
              description: [
                `Booked by the AI receptionist${padded}`,
                ...bookingDetails.map(({ question, answer }) => `${question}\n${answer}`),
              ].join("\n\n"),
            },
          );

          await createAppointment({
            ...appointmentBase,
            status: "confirmed",
            externalEventId: eventId,
            externalCalendarId: access.booking.calendarId,
            externalCalendarConnectionId: access.booking.connectionId,
          });
          deps.callState.wasBooked = true;
          deps.slots.held.delete(slotId);
          void notifySlack(agentId, "booking").catch(err => console.error("[slack] booking alert failed:", err));

          return { booked: true, time: describeSlot(slot, timeZone) };
        } catch (err) {
          console.error("[agent] bookAppointment failed:", err);
          await createAppointment({
            ...appointmentBase,
            status: "requested",
          });
          deps.callState.wasBooked = true;
          void notifySlack(agentId, "request").catch(slackError => console.error("[slack] request alert failed:", slackError));
          return {
            booked: false,
            reason:
              "Booking failed — appointment request saved, team will confirm.",
          };
        }
      },
    }),

    lookupAppointments: llm.tool({
      description:
        "Look up a caller's upcoming appointments by their phone number. Use when a caller asks about existing bookings or wants to cancel/reschedule.",
      parameters: z.object({}),
      execute: async () => {
        // No identity to look up. A shared placeholder key would read one
        // caller's appointments to another.
        if (!deps.callerPhone) {
          return {
            appointments: [],
            message:
              "This caller's number is withheld, so their bookings cannot be looked up. " +
              "Ask the caller to read out the phone number their appointment was booked under.",
          };
        }
        const upcoming = await getUpcomingByPhone(
          agentId,
          deps.callerPhone!,
        );
        if (upcoming.length === 0) {
          return {
            appointments: [],
            message: "No upcoming appointments found.",
          };
        }
        return {
          appointments: upcoming.map((a) => ({
            id: a.id,
            service: a.service,
            startTime: a.startTime?.toISOString() ?? null,
            endTime: a.endTime?.toISOString() ?? null,
            status: a.status,
          })),
        };
      },
    }),

    cancelAppointment: llm.tool({
      description:
        "Cancel a confirmed appointment. Only call after you have read the appointment details back to the caller and they explicitly confirmed they want to cancel.",
      parameters: z.object({
        appointmentId: z
          .string()
          .describe("The ID of the appointment to cancel."),
      }),
      execute: async ({ appointmentId }) => {
        const appointment = await getAppointmentById(appointmentId, agentId);
        if (!appointment || !deps.callerPhone || appointment.callerPhone !== deps.callerPhone) {
          return { error: "Appointment not found for this caller. Offer to take a message for the team." };
        }
        if (appointment.status === "cancelled") {
          return { cancelled: true, appointmentId };
        }

        if (appointment.externalEventId) {
          const calendarId = appointment.externalCalendarId ?? deps.calendarExternalId;
          const fallback = (await calendarAccess())?.booking;
          const credential = appointment.externalCalendarConnectionId
            ? await getCalendarCredential(agentId, appointment.externalCalendarConnectionId)
            : fallback;
          if (!calendarId || !credential) {
            return { error: "The calendar could not be reached, so the appointment was not cancelled." };
          }
          try {
            await deleteProviderCalendarEvent(
              credential.provider,
              credential.token,
              calendarId,
              appointment.externalEventId,
            );
          } catch (err) {
            console.error("[agent] deleteCalendarEvent failed:", err);
            return { error: "The calendar could not be updated, so the appointment was not cancelled." };
          }
        }

        const cancelled = await cancelAppointmentById(appointmentId, agentId);
        if (!cancelled) return { error: "Appointment not found." };

        void notifySlack(agentId, "cancellation").catch(err => console.error("[slack] cancellation alert failed:", err));

        return { cancelled: true, appointmentId };
      },
    }),

    endCall: llm.tool({
      description:
        "End the phone call. Use only after the caller has clearly indicated they are done — for example, said goodbye, thank you, or that's all.",
      parameters: z.object({}),
      execute: async (_params, { ctx }) => {
        const farewell = deps.agent.farewell;
        if (farewell) {
          ctx.session.say(farewell, { allowInterruptions: false });
        }
        ctx.session.shutdown({ drain: true });
      },
    }),
  };
}
