import { providerWriteError } from './provider-write-error.js';
import type { CalendarAgendaEvent, CalendarOption } from "@receptionist/shared";

const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

export type BusyRange = { start: Date; end: Date };

/** Raised when the token is valid but was minted without the calendar scope. */
export class CalendarScopeMissingError extends Error {
  constructor() {
    super("[calendar] the Google token carries no calendar scope");
    this.name = "CalendarScopeMissingError";
  }
}

/** Lists every visible calendar. Read-only calendars can block availability;
 * only writable ones may be selected as the booking destination. */
export async function listCalendars(accessToken: string): Promise<Omit<CalendarOption, "connectionId" | "accountEmail" | "provider">[]> {
  const calendars: Omit<CalendarOption, "connectionId" | "accountEmail" | "provider">[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: "250", fields: "nextPageToken,items(id,summary,timeZone,primary,accessRole)" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`${GOOGLE_CALENDAR_BASE}/users/me/calendarList?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000),
    });
    if (res.status === 401 || res.status === 403) throw new CalendarScopeMissingError();
    if (!res.ok) throw new Error(`[calendar] calendarList failed: ${res.status}`);
    const data = await res.json() as {
      nextPageToken?: string;
      items?: Array<{ id: string; summary?: string; timeZone?: string; primary?: boolean; accessRole?: string }>;
    };
    calendars.push(...(data.items ?? []).map(item => ({
      id: item.id, summary: item.summary ?? item.id, timeZone: item.timeZone,
      primary: item.primary === true, writable: item.accessRole === "writer" || item.accessRole === "owner",
    })));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return calendars;
}

/** Only a fetch. Google says what is taken; `domain/scheduling.ts` says what exists. */
export async function fetchBusyRanges(
  accessToken: string,
  calendarId: string | readonly string[],
  timeMinIso: string,
  timeMaxIso: string
): Promise<BusyRange[]> {
  const res = await fetch(`${GOOGLE_CALENDAR_BASE}/freeBusy`, {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      items: (Array.isArray(calendarId) ? calendarId : [calendarId]).map((id) => ({ id })),
    }),
  });

  if (!res.ok) {
    throw new Error(`[calendar] freeBusy failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }>;
  };

  const calendarIds = Array.isArray(calendarId) ? calendarId : [calendarId];
  const ranges: BusyRange[] = [];
  for (const id of calendarIds) {
    const calendar = data.calendars?.[id];
    if (!calendar || calendar.errors?.length || !Array.isArray(calendar.busy)) {
      throw new Error("[calendar] availability could not be verified");
    }
    for (const block of calendar.busy) {
      if (typeof block?.start !== "string" || typeof block?.end !== "string") {
        throw new Error("[calendar] availability could not be verified");
      }
      const start = new Date(block?.start);
      const end = new Date(block?.end);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
        throw new Error("[calendar] availability could not be verified");
      }
      ranges.push({ start, end });
    }
  }
  return ranges;
}

export async function createCalendarEvent(
  accessToken: string,
  calendarId: string,
  event: {
    summary: string;
    /** The padded block: freeBusy would report bare setup and cleanup as free. */
    startIso: string;
    endIso: string;
    timezone: string;
    description?: string;
  }
): Promise<string> {
  const res = await fetch(
    `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: event.summary,
        description: event.description ?? "Booked via AI Receptionist",
        start: { dateTime: event.startIso, timeZone: event.timezone },
        end: { dateTime: event.endIso, timeZone: event.timezone },
      }),
    }
  );

  if (!res.ok) {
    throw providerWriteError(res.status);
  }

  const data = (await res.json()) as { id: string };
  if (!data.id) throw new Error("[calendar] event creation was not confirmed");
  return data.id;
}

type GoogleEvent = {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

async function fetchCalendarEvents(
  accessToken: string,
  calendarId: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      singleEvents: "true",
      showDeleted: "false",
      maxResults: "2500",
      fields: "nextPageToken,items(id,summary,start,end)",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(
      `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) {
      throw new Error(`[calendar] listEvents failed: ${res.status}`);
    }

    const data = (await res.json()) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
    };
    events.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return events;
}

/** IDs of live events in a bounded window. Used only when the owner asks to refresh. */
export async function listCalendarEventIds(
  accessToken: string,
  calendarId: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<Set<string>> {
  const events = await fetchCalendarEvents(accessToken, calendarId, timeMinIso, timeMaxIso);
  return new Set(events.flatMap((event) => (event.id ? [event.id] : [])));
}

export async function listCalendarEvents(
  accessToken: string,
  calendarId: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<CalendarAgendaEvent[]> {
  const events = await fetchCalendarEvents(accessToken, calendarId, timeMinIso, timeMaxIso);
  return events.flatMap((event) => {
    const start = event.start?.dateTime ?? event.start?.date;
    const end = event.end?.dateTime ?? event.end?.date;
    if (!event.id || !start || !end) return [];
    return [{
      id: event.id,
      title: event.summary?.trim() || "Busy",
      start,
      end,
      allDay: Boolean(event.start?.date),
      calendarId,
    }];
  });
}

export async function deleteCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const res = await fetch(
    `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`[calendar] deleteEvent failed: ${res.status}`);
  }
}

/** A moved event is still live, even when absent from the original date window. */
export async function calendarEventExists(accessToken: string, calendarId: string, eventId: string): Promise<boolean> {
  const res = await fetch(
    `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?fields=id,status`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) },
  );
  if (res.status === 404 || res.status === 410) return false;
  if (!res.ok) throw new Error(`[calendar] getEvent failed: ${res.status}`);
  const event = await res.json() as { id?: string; status?: string };
  if (!event.id || !event.status) throw new Error("[calendar] event status could not be verified");
  return event.status !== "cancelled";
}
