import type { CalendarProvider } from "@receptionist/shared";
import {
  calendarEventExists, createCalendarEvent, deleteCalendarEvent, fetchBusyRanges,
  listCalendarEventIds, listCalendarEvents, listCalendars,
} from "./calendar.js";
import {
  createMicrosoftCalendarEvent, deleteMicrosoftCalendarEvent, fetchMicrosoftBusyRanges,
  listMicrosoftCalendarEventIds, listMicrosoftCalendarEvents, listMicrosoftCalendars,
  microsoftCalendarEventExists,
} from "./microsoftCalendar.js";

type EventInput = Parameters<typeof createCalendarEvent>[2];

export const listProviderCalendars = (provider: CalendarProvider, token: string, signal?: AbortSignal) =>
  provider === "google" ? listCalendars(token, signal) : listMicrosoftCalendars(token, signal);

export const fetchProviderBusyRanges = (provider: CalendarProvider, token: string, ids: string | readonly string[], min: string, max: string, signal?: AbortSignal) =>
  provider === "google" ? fetchBusyRanges(token, ids, min, max, signal) : fetchMicrosoftBusyRanges(token, ids, min, max, signal);

export const createProviderCalendarEvent = (provider: CalendarProvider, token: string, calendarId: string, event: EventInput, signal?: AbortSignal) =>
  provider === "google" ? createCalendarEvent(token, calendarId, event, signal) : createMicrosoftCalendarEvent(token, calendarId, event, signal);

export const deleteProviderCalendarEvent = (provider: CalendarProvider, token: string, calendarId: string, eventId: string) =>
  provider === "google" ? deleteCalendarEvent(token, calendarId, eventId) : deleteMicrosoftCalendarEvent(token, calendarId, eventId);

export const listProviderCalendarEvents = (provider: CalendarProvider, token: string, calendarId: string, min: string, max: string) =>
  provider === "google" ? listCalendarEvents(token, calendarId, min, max) : listMicrosoftCalendarEvents(token, calendarId, min, max);

export const listProviderCalendarEventIds = (provider: CalendarProvider, token: string, calendarId: string, min: string, max: string) =>
  provider === "google" ? listCalendarEventIds(token, calendarId, min, max) : listMicrosoftCalendarEventIds(token, calendarId, min, max);

export const providerCalendarEventExists = (provider: CalendarProvider, token: string, calendarId: string, eventId: string) =>
  provider === "google" ? calendarEventExists(token, calendarId, eventId) : microsoftCalendarEventExists(token, calendarId, eventId);
