import { providerWriteError } from './provider-write-error.js';
import type { CalendarAgendaEvent, CalendarOption } from "@receptionist/shared";
import type { BusyRange } from "./calendar.js";
import { randomUUID } from "node:crypto";

const GRAPH = "https://graph.microsoft.com/v1.0";
const requestSignal = (signal?: AbortSignal) => signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
export class MicrosoftCalendarScopeMissingError extends Error {}

async function graphJson<T>(accessToken: string, url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' },
    signal: requestSignal(signal),
  });
  if (response.status === 401 || response.status === 403) throw new MicrosoftCalendarScopeMissingError();
  if (!response.ok) throw new Error(`[microsoft-calendar] request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export async function listMicrosoftCalendars(
  accessToken: string,
  signal?: AbortSignal,
): Promise<Omit<CalendarOption, "connectionId" | "accountEmail" | "provider">[]> {
  const calendars: Omit<CalendarOption, "connectionId" | "accountEmail" | "provider">[] = [];
  let url: string | undefined = `${GRAPH}/me/calendars?$select=id,name,isDefaultCalendar,canEdit&$top=100`;
  while (url) {
    const data: { value?: Array<{ id?: string; name?: string; isDefaultCalendar?: boolean; canEdit?: boolean }>; "@odata.nextLink"?: string } = await graphJson(accessToken, url, signal);
    calendars.push(...(data.value ?? []).flatMap(item => item.id ? [{
      id: item.id,
      summary: item.name?.trim() || "Microsoft calendar",
      primary: item.isDefaultCalendar === true,
      writable: item.canEdit === true,
    }] : []));
    url = data["@odata.nextLink"];
  }
  return calendars;
}

type GraphEvent = {
  id?: string;
  subject?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
};

async function listMicrosoftEvents(
  accessToken: string,
  calendarId: string,
  timeMinIso: string,
  timeMaxIso: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    startDateTime: timeMinIso,
    endDateTime: timeMaxIso,
    $select: "id,subject,isAllDay,isCancelled,showAs,start,end",
    $top: "500",
  });
  const events: GraphEvent[] = [];
  let url: string | undefined = `${GRAPH}/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${params}`;
  while (url) {
    const data: { value?: GraphEvent[]; "@odata.nextLink"?: string } = await graphJson(accessToken, url, signal);
    if (!Array.isArray(data.value)) throw new Error("[microsoft-calendar] availability could not be verified");
    events.push(...data.value);
    url = data["@odata.nextLink"];
  }
  return events;
}

function instant(value?: string) {
  if (!value) return null;
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

export async function fetchMicrosoftBusyRanges(
  accessToken: string,
  calendarIds: string | readonly string[],
  timeMinIso: string,
  timeMaxIso: string,
  signal?: AbortSignal,
): Promise<BusyRange[]> {
  const ids = Array.isArray(calendarIds) ? calendarIds : [calendarIds];
  const groups = await Promise.all(ids.map(id => listMicrosoftEvents(accessToken, id, timeMinIso, timeMaxIso, signal)));
  return groups.flatMap(events => events.flatMap(event => {
    if (event.isCancelled || event.showAs === "free") return [];
    const start = instant(event.start?.dateTime);
    const end = instant(event.end?.dateTime);
    if (!start || !end || end <= start) throw new Error("[microsoft-calendar] availability could not be verified");
    return [{ start, end }];
  }));
}

export async function createMicrosoftCalendarEvent(
  accessToken: string,
  calendarId: string,
  event: { summary: string; startIso: string; endIso: string; timezone: string; description?: string },
  signal?: AbortSignal,
) {
  const response = await fetch(`${GRAPH}/me/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    signal: requestSignal(signal),
    body: JSON.stringify({
      subject: event.summary,
      body: { contentType: "text", content: event.description ?? "Booked via DeskRoute" },
      start: { dateTime: event.startIso.replace(/Z$/, ""), timeZone: "UTC" },
      end: { dateTime: event.endIso.replace(/Z$/, ""), timeZone: "UTC" },
      transactionId: randomUUID(),
    }),
  });
  if (!response.ok) throw providerWriteError(response.status);
  const data = await response.json() as { id?: string };
  if (!data.id) throw new Error("[microsoft-calendar] event creation was not confirmed");
  return data.id;
}

export async function listMicrosoftCalendarEvents(
  accessToken: string,
  calendarId: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<CalendarAgendaEvent[]> {
  const events = await listMicrosoftEvents(accessToken, calendarId, timeMinIso, timeMaxIso);
  return events.flatMap(event => {
    if (!event.id || event.isCancelled) return [];
    const start = instant(event.start?.dateTime);
    const end = instant(event.end?.dateTime);
    if (!start || !end) return [];
    return [{ id: event.id, calendarId, title: event.subject?.trim() || "Busy", start: start.toISOString(), end: end.toISOString(), allDay: event.isAllDay === true }];
  });
}

export async function listMicrosoftCalendarEventIds(accessToken: string, calendarId: string, timeMinIso: string, timeMaxIso: string) {
  const events = await listMicrosoftEvents(accessToken, calendarId, timeMinIso, timeMaxIso);
  return new Set(events.flatMap(event => event.id && !event.isCancelled ? [event.id] : []));
}

export async function deleteMicrosoftCalendarEvent(accessToken: string, calendarId: string, eventId: string) {
  const response = await fetch(`${GRAPH}/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`[microsoft-calendar] deleteEvent failed: ${response.status}`);
  }
}

export async function microsoftCalendarEventExists(accessToken: string, calendarId: string, eventId: string) {
  const response = await fetch(`${GRAPH}/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?$select=id,isCancelled`, {
    headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000),
  });
  if (response.status === 404 || response.status === 410) return false;
  if (!response.ok) throw new Error(`[microsoft-calendar] getEvent failed: ${response.status}`);
  const event = await response.json() as { id?: string; isCancelled?: boolean };
  return Boolean(event.id) && event.isCancelled !== true;
}
