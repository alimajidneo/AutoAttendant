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

export const listProviderCalendars = (provider: CalendarProvider, token: string) =>
  provider === "google" ? listCalendars(token) : listMicrosoftCalendars(token);

export const fetchProviderBusyRanges = (provider: CalendarProvider, token: string, ids: string | readonly string[], min: string, max: string) =>
  provider === "google" ? fetchBusyRanges(token, ids, min, max) : fetchMicrosoftBusyRanges(token, ids, min, max);

export const createProviderCalendarEvent = (provider: CalendarProvider, token: string, calendarId: string, event: EventInput) =>
  provider === "google" ? createCalendarEvent(token, calendarId, event) : createMicrosoftCalendarEvent(token, calendarId, event);

export const deleteProviderCalendarEvent = (provider: CalendarProvider, token: string, calendarId: string, eventId: string) =>
  provider === "google" ? deleteCalendarEvent(token, calendarId, eventId) : deleteMicrosoftCalendarEvent(token, calendarId, eventId);

export const listProviderCalendarEvents = (provider: CalendarProvider, token: string, calendarId: string, min: string, max: string) =>
  provider === "google" ? listCalendarEvents(token, calendarId, min, max) : listMicrosoftCalendarEvents(token, calendarId, min, max);

export const listProviderCalendarEventIds = (provider: CalendarProvider, token: string, calendarId: string, min: string, max: string) =>
  provider === "google" ? listCalendarEventIds(token, calendarId, min, max) : listMicrosoftCalendarEventIds(token, calendarId, min, max);

export const providerCalendarEventExists = (provider: CalendarProvider, token: string, calendarId: string, eventId: string) =>
  provider === "google" ? calendarEventExists(token, calendarId, eventId) : microsoftCalendarEventExists(token, calendarId, eventId);
