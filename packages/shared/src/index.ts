// Domain enums / unions

export type CallOutcome = "answered" | "booked" | "escalated" | "abandoned" | "error";
export type EscalationStatus = "pending" | "resolved";
export type AppointmentStatus = "requested" | "confirmed" | "cancelled";

// Domain value objects

/** The buffers widen the calendar block, not the appointment the caller hears. */
export type Service = {
  id: string;
  name: string;
  price: string;
  description?: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  /** Plural from day one, empty for everyone today. */
  requiredResources: string[];
};

/** A service before it exists — what the create form and onboarding send. */
export type ServiceDraft = Omit<Service, "id">;

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const WEEKDAYS: readonly Weekday[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

/** Local wall clock "HH:MM", never UTC, so "we open at 9" survives daylight saving. */
export type TimeInterval = { start: string; end: string };

/** Replaces the weekly pattern for one date. Empty `intervals` means shut all day. */
export type HoursException = {
  /** "YYYY-MM-DD", read in the business's timezone. */
  date: string;
  intervals: TimeInterval[];
  /** Shown in the dashboard only, e.g. "Christmas Day". */
  label?: string;
};

/** Several intervals per day, because a lunch closure is two and not one. */
export type BusinessHours = {
  weekly: Record<Weekday, TimeInterval[]>;
  exceptions: HoursException[];
};

/** `minNoticeMinutes` covers the person, not the calendar; padding covers the calendar. */
export type BookingPolicy = {
  minNoticeMinutes: number;
  maxAdvanceDays: number;
};

export const DEFAULT_BOOKING_POLICY: BookingPolicy = {
  minNoticeMinutes: 30,
  maxAdvanceDays: 60,
};

/** Mon–Fri, 9 to 5. A starting point every business will edit. */
export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  weekly: {
    mon: [{ start: "09:00", end: "17:00" }],
    tue: [{ start: "09:00", end: "17:00" }],
    wed: [{ start: "09:00", end: "17:00" }],
    thu: [{ start: "09:00", end: "17:00" }],
    fri: [{ start: "09:00", end: "17:00" }],
    sat: [],
    sun: [],
  },
  exceptions: [],
};

/** The phrases an owner controls. There is no hold phrase: speech is a queue. */
export type AgentProfile = {
  name: string;
  greeting: string;
  farewell: string;
  fallback: string;
  /** Questions the receptionist must answer before it commits a booking. */
  bookingQuestions: string[];
};

export type BookingDetail = { question: string; answer: string };

/**
 * Plays before the owner's greeting and is not editable. California AB 2905 and
 * SB 243 require it before any substantive interaction, at $500 per call.
 */
export const AI_DISCLOSURE_RECORDED =
  "Just so you know, you're speaking with an AI assistant, and this call is recorded.";

/** The AI half is never optional. The recording clause is, because it is a claim. */
export const AI_DISCLOSURE_NOT_RECORDED =
  "Just so you know, you're speaking with an AI assistant.";

/** Two concurrent wordings with stable ids, stamped on every call as the audit trail. */
export const DISCLOSURE_VERSION_RECORDED = "2026-08-v1";
export const DISCLOSURE_VERSION_NOT_RECORDED = "2026-08-norec-v1";

export type Disclosure = { text: string; version: string };

/** Text and id together, so a call cannot be stamped with a wording it never heard. */
export function disclosureFor(recordCalls: boolean): Disclosure {
  return recordCalls
    ? { text: AI_DISCLOSURE_RECORDED, version: DISCLOSURE_VERSION_RECORDED }
    : { text: AI_DISCLOSURE_NOT_RECORDED, version: DISCLOSURE_VERSION_NOT_RECORDED };
}

/** A union of one, so no column has to name a vendor. */
export type CalendarProvider = "google" | "microsoft";
export type SlackAlertKind = "booking" | "cancellation" | "request" | "question" | "call-error";

export interface SlackChannelOption {
  id: string;
  name: string;
  private: boolean;
}

export interface SlackConnectionSummary {
  connected: boolean;
  teamName: string | null;
  channelId: string | null;
  channelName: string | null;
  alertKinds: SlackAlertKind[];
  channels: SlackChannelOption[];
}

/** Who sold the number. `manual` is one the operator wired up themselves. */
export type PhoneNumberProvider = "livekit" | "twilio" | "telnyx" | "manual";

/** Display data for the connected calendar. Never read on the call path. */
export type CalendarPayload = {
  /** The calendar's own name, so Settings can show "Bookings", not a raw id. */
  summary: string;
  /** The calendar's timezone as the provider reports it, for display only. */
  timeZone?: string;
  /** Calendars that block availability. The booking calendar is always included. */
  conflictCalendars?: CalendarReference[];
  /** Connection containing the calendar that receives new appointments. */
  bookingConnectionId?: string;
};

export type CalendarSourceColor = "blue" | "violet" | "green" | "amber" | "pink" | "teal" | "orange" | "slate" | "red" | "cyan" | "lime" | "indigo";

export type CalendarReference = {
  connectionId?: string;
  id: string;
  summary: string;
  timeZone?: string;
  color?: CalendarSourceColor;
};

/** One of the calendars a connected account can offer, for the picker. */
export interface CalendarOption {
  connectionId: string;
  provider: CalendarProvider;
  accountEmail: string;
  id: string;
  summary: string;
  timeZone?: string;
  primary: boolean;
  writable: boolean;
}

export interface CalendarConnectionSummary {
  id: string;
  provider: CalendarProvider;
  accountEmail: string;
  accountName: string | null;
  reconnectRequired: boolean;
}

/** A Google Calendar event rendered in the owner's calendar view. */
export interface CalendarAgendaEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarId: string;
}

/** A line of the conversation, as plain text. Carries no timing: chat message
 *  timestamps do not line up with the recording. */
export type TranscriptEntry = {
  role: "user" | "assistant";
  text: string;
};

// API response shapes

/** `callerPhone` is nullable throughout: a withheld ID is no identity, never a placeholder. */
export interface CallListItem {
  provider?: "livekit" | "retell";
  providerCallId?: string | null;
  providerStatus?: string | null;
  disconnectionReason?: string | null;
  transferStatus?: string | null;
  durationMs?: number | null;
  costCents?: number | null;
  id: string;
  callerId: string | null;
  callerPhone: string | null;
  /** From `callers.name`. Null for a caller we have never been given a name for. */
  callerName: string | null;
  startedAt: string;
  endedAt: string | null;
  outcome: CallOutcome | null;
  summary: string | null;
}

export interface CallDetail extends CallListItem {
  roomName: string;
  transcript: TranscriptEntry[] | null;
  recordingKey: string | null;
}

export interface EscalationItem {
  id: string;
  /** The call it came from, so the dashboard can link to the recording. */
  callId: string | null;
  callerPhone: string | null;
  /** Who to ring back: the name given at escalation, else the one on the caller row. */
  callerName: string | null;
  question: string;
  status: EscalationStatus;
  answer: string | null;
  createdAt: string;
}

export interface KnowledgeItem {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

export interface AppointmentItem {
  id: string;
  callerPhone: string | null;
  /** The name given at booking. Null when the caller declined or predates this. */
  callerName: string | null;
  service: string;
  startTime: string | null;
  endTime: string | null;
  status: AppointmentStatus;
  providerWriteState?: "in_flight" | "reconciliation_required" | null;
  externalEventId: string | null;
  bookingDetails: BookingDetail[];
  externalCalendarId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AvailableNumber {
  id: string;
  e164_format: string;
  locality: string;
  region: string;
}

/** Only what cannot be derived: hours are valid from creation, so nothing else says
 *  whether they have been looked at. */
export interface AgentSetup {
  checklistDismissed: boolean;
  hoursSeen: boolean;
}

export const DEFAULT_AGENT_SETUP: AgentSetup = {
  checklistDismissed: false,
  hoursSeen: false,
};

export interface DashboardMetrics {
  totalCalls: number;
  /** Calls that arrived while the business was shut. Scoped by the period. */
  afterHoursCalls: number;
  confirmedBookings: number;
  /** Every unanswered question, ignoring the period. */
  pendingEscalations: number;
  abandonedCalls: number;
}

export interface BusinessSettings {
  name: string;
  industry: string;
  timezone: string;
  description: string;
  services: Service[];
  businessHours: BusinessHours;
  bookingPolicy: BookingPolicy;
  agentProfile: AgentProfile;
  /** The owner's preference. What actually happens is this AND storageConfigured. */
  recordCalls: boolean;
  /** False when the R2_* variables are unset, which makes recording impossible. */
  storageConfigured: boolean;
  phoneNumber: string | null;
  calendarProvider: CalendarProvider | null;
  calendarExternalId: string | null;
  calendarPayload: CalendarPayload | null;
}


export interface NotificationItem {
  id: string;
  kind: "booking" | "cancellation" | "request" | "question" | "call-error";
  title: string;
  description: string;
  occurredAt: string;
  href: string;
  read: boolean;
}

export interface NotificationReadInput {
  id: string;
  occurredAt: string;
}

export interface CalendarAgendaSource {
  connectionId: string;
  provider: CalendarProvider;
  accountEmail: string;
  calendarId: string;
  calendarName: string;
  colorIndex: number;
  color?: CalendarSourceColor;
}

export interface CalendarAgenda {
  connected: boolean;
  events: CalendarAgendaEvent[];
  sources: CalendarAgendaSource[];
}

export type { EmployeeCalendarReference, EmployeeCalendarPolicy, EmployeeDraft, EmployeeView, EmployeeConnectionView } from "./employees.js";
