import {
  boolean,
  index,
  integer,
  uniqueIndex,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_BOOKING_POLICY,
  type TranscriptEntry,
  type CalendarProvider,
  type CalendarPayload,
  type BusinessHours,
  type PhoneNumberProvider,
  type SlackAlertKind,
} from "@receptionist/shared";
export type {
  Service,
  ServiceDraft,
  AgentProfile,
  TranscriptEntry,
  CalendarProvider,
  CalendarPayload,
  BusinessHours,
  BookingPolicy,
  AgentSetup,
  PhoneNumberProvider,
} from "@receptionist/shared";
export type { CallOutcome } from "@receptionist/shared";

export const callOutcomeEnum = pgEnum("call_outcome", [
  "answered",
  "booked",
  "escalated",
  "abandoned",
  "error",
]);

export const escalationStatusEnum = pgEnum("escalation_status", [
  "pending",
  "resolved",
]);

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "requested",
  "confirmed",
  "cancelled",
]);

/** A business's phone presence, and everything shaping how it answers. */
export const agents = pgTable("agents", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** The business. `personaName` is what the receptionist calls itself. */
  businessName: text("business_name").notNull(),
  personaName: text("persona_name").notNull().default(""),
  industry: text("industry").notNull().default(""),
  timezone: text("timezone").notNull(),
  description: text("description").notNull().default(""),
  greeting: text("greeting").notNull().default(""),
  farewell: text("farewell").notNull().default(""),
  fallback: text("fallback").notNull().default(""),
  bookingQuestions: jsonb("booking_questions").$type<string[]>().notNull().default([]),
  /** Local wall clock read against `timezone`, so "we open at 9" survives DST. */
  businessHours: jsonb("business_hours")
    .$type<BusinessHours>()
    .notNull()
    .default(DEFAULT_BUSINESS_HOURS),
  minNoticeMinutes: integer("min_notice_minutes")
    .notNull()
    .default(DEFAULT_BOOKING_POLICY.minNoticeMinutes),
  maxAdvanceDays: integer("max_advance_days")
    .notNull()
    .default(DEFAULT_BOOKING_POLICY.maxAdvanceDays),
  /** The owner's preference. What happens is `recordingEnabled()`. */
  recordCalls: boolean("record_calls").notNull().default(true),
  checklistDismissed: boolean("checklist_dismissed").notNull().default(false),
  /** Hours are valid from creation, so this cannot tick itself off from the data. */
  hoursSeen: boolean("hours_seen").notNull().default(false),
  authUserId: text("auth_user_id").unique(),
  /** Generic, so a vendor name never sits in a column. */
  calendarProvider: text("calendar_provider").$type<CalendarProvider>(),
  calendarExternalId: text("calendar_external_id"),
  calendarPayload: jsonb("calendar_payload").$type<CalendarPayload>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

/** Its own table, so a number changes without writing to the agent row. */
export const phoneNumbers = pgTable(
  "phone_numbers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    /** Globally unique: a number reaches exactly one agent. */
    e164: text("e164").notNull().unique(),
    provider: text("provider").$type<PhoneNumberProvider>().notNull().default("livekit"),
    /** The number's id at the provider, for reconfiguring or releasing it. */
    providerSid: text("provider_sid"),
    label: text("label").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("phone_numbers_agent_idx").on(table.agentId)]
).enableRLS();

/** Somebody who phoned. */
export const callers = pgTable(
  "callers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    phoneNumber: text("phone_number").notNull(),
    name: text("name"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("callers_agent_phone_unique").on(table.agentId, table.phoneNumber),
    index("callers_agent_last_seen_idx").on(table.agentId, table.lastSeenAt),
  ]
).enableRLS();

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    callerId: uuid("caller_id").references(() => callers.id, { onDelete: "set null" }),
    /** Null for a withheld number. Never a placeholder identity. */
    callerPhone: text("caller_phone"),
    roomName: text("room_name").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    outcome: callOutcomeEnum("outcome"),
    transcript: jsonb("transcript").$type<TranscriptEntry[]>(),
    summary: text("summary"),
    /** The object key. The URL is presigned per request. */
    recordingKey: text("recording_key"),
    /** Which disclosure wording this caller heard, for a per-call penalty regime. */
    disclosureVersion: text("disclosure_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("calls_agent_started_at_idx").on(table.agentId, table.startedAt)]
).enableRLS();

export const escalations = pgTable(
  "escalations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
    callerId: uuid("caller_id").references(() => callers.id, { onDelete: "set null" }),
    callerPhone: text("caller_phone"),
    /** An anonymous caller has no `callers` row, so the name lives here. */
    callerName: text("caller_name"),
    question: text("question").notNull(),
    transcriptExcerpt: text("transcript_excerpt"),
    status: escalationStatusEnum("status").notNull().default("pending"),
    answer: text("answer"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("escalations_agent_status_created_at_idx").on(
      table.agentId,
      table.status,
      table.createdAt
    ),
    uniqueIndex("escalations_call_question_dedup_idx")
      .on(table.callId, sql`lower(${table.question})`)
      .where(sql`${table.callId} IS NOT NULL`),
  ]
).enableRLS();

export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    sourceEscalationId: uuid("source_escalation_id").references(() => escalations.id, {
      onDelete: "set null",
    }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("knowledge_items_agent_created_at_idx").on(table.agentId, table.createdAt)]
).enableRLS();

/** A table, so a booking points at a permanent id that survives a rename. */
export const services = pgTable(
  "services",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    price: text("price").notNull().default(""),
    description: text("description").notNull().default(""),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    /** Time the calendar holds either side that the caller never hears about. */
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    /** Plural from day one, empty for everyone today. */
    requiredResources: jsonb("required_resources")
      .$type<string[]>()
      .notNull()
      .default([]),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("services_agent_position_idx").on(table.agentId, table.position)]
).enableRLS();

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    callerId: uuid("caller_id").references(() => callers.id, { onDelete: "set null" }),
    callerPhone: text("caller_phone"),
    callerName: text("caller_name"),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    /** The name as it stood at booking, so history survives a rename or a delete. */
    serviceName: text("service_name").notNull(),
    startTime: timestamp("start_time", { withTimezone: true }),
    endTime: timestamp("end_time", { withTimezone: true }),
    status: appointmentStatusEnum("status").notNull(),
    /** The event's id in whichever provider `agents.calendar_provider` names. */
    externalEventId: text("external_event_id"),
    /** Calendar used at booking time, so later cancellation survives a selection change. */
    externalCalendarId: text("external_calendar_id"),
    /** Account connection used for the event, needed when several Google accounts are connected. */
    externalCalendarConnectionId: uuid("external_calendar_connection_id"),
    /** Answers to the owner's configured intake questions, frozen at booking time. */
    bookingDetails: jsonb("booking_details")
      .$type<import("@receptionist/shared").BookingDetail[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("appointments_agent_start_time_idx").on(table.agentId, table.startTime),
    index("appointments_agent_updated_idx").on(table.agentId, table.updatedAt),
  ]
).enableRLS();

/** Dormant legacy storage retained so upgrades never destructively drop customer credentials. */
export const googleCredentials = pgTable("google_credentials", {
  authUserId: text("auth_user_id").primaryKey(),
  googleSubject: text("google_subject").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

/** Google accounts authorized for calendar access. These are integrations, not login identities. */
export const calendarConnections = pgTable(
  "calendar_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    provider: text("provider").$type<CalendarProvider>().notNull().default("google"),
    providerAccountId: text("provider_account_id").notNull(),
    accountEmail: text("account_email").notNull(),
    accountName: text("account_name"),
    encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
    /** AES-GCM additional authenticated data; retained when importing legacy credentials. */
    encryptionOwner: text("encryption_owner").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("calendar_connections_agent_provider_account_unique").on(
      table.agentId,
      table.provider,
      table.providerAccountId,
    ),
    index("calendar_connections_agent_idx").on(table.agentId),
  ],
).enableRLS();

/** One explicit Slack installation per workspace. Bot tokens never reach the browser. */
export const slackConnections = pgTable("slack_connections", {
  agentId: uuid("agent_id").primaryKey().references(() => agents.id, { onDelete: "cascade" }),
  teamId: text("team_id").notNull(),
  teamName: text("team_name").notNull(),
  botUserId: text("bot_user_id"),
  encryptedBotToken: text("encrypted_bot_token").notNull(),
  encryptionOwner: text("encryption_owner").notNull(),
  channelId: text("channel_id"),
  channelName: text("channel_name"),
  alertKinds: jsonb("alert_kinds").$type<SlackAlertKind[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

/** Read receipts only; notification text stays in its original owner-scoped records. */
export const notificationReads = pgTable("notification_reads", {
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  notificationId: text("notification_id").notNull(),
  seenThrough: timestamp("seen_through", { withTimezone: true }).notNull(),
}, table => [primaryKey({ columns: [table.agentId, table.userId, table.notificationId] })]).enableRLS();

export const workspaces = pgTable("workspaces", {
  agentId: uuid("agent_id").primaryKey().references(() => agents.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull(),
  kind: text("kind").$type<"personal" | "team">().notNull(),
}).enableRLS();

export const workspaceMembers = pgTable("workspace_members", {
  agentId: uuid("agent_id").notNull().references(() => workspaces.agentId, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  role: text("role").$type<"manager" | "member">().notNull(),
  displayName: text("display_name").notNull().default(""),
  department: text("department").notNull().default(""),
  available: boolean("available").notNull().default(false),
}, t => [primaryKey({ columns: [t.agentId, t.userId] }), index("workspace_members_user_idx").on(t.userId)]).enableRLS();

export const workspaceInvites = pgTable("workspace_invites", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentId: uuid("agent_id").notNull().references(() => workspaces.agentId, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").$type<"manager" | "member">().notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
}, t => [index("workspace_invites_agent_idx").on(t.agentId)]).enableRLS();

export const transferRequests = pgTable("transfer_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentId: uuid("agent_id").notNull().references(() => workspaces.agentId, { onDelete: "cascade" }),
  roomName: text("room_name").notNull().unique(),
  callerIdentity: text("caller_identity").notNull(),
  targetUserId: text("target_user_id").notNull(),
  status: text("status").$type<"pending" | "accepted" | "declined" | "connected" | "ended">().notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [index("transfer_requests_inbox_idx").on(t.agentId, t.targetUserId, t.expiresAt)]).enableRLS();
