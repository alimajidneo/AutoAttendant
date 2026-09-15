import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
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
    provider: text("provider").$type<"livekit" | "retell">().notNull().default("livekit"),
    providerCallId: text("provider_call_id"),
    providerStatus: text("provider_status"),
    disconnectionReason: text("disconnection_reason"),
    transferAttemptStartedAt: bigint("transfer_attempt_started_at", { mode: "number" }),
    transferStatus: text("transfer_status"),
    durationMs: integer("duration_ms"),
    costCents: doublePrecision("cost_cents"),
    retellAgentId: text("retell_agent_id"),
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
  (table) => [index("calls_agent_started_at_idx").on(table.agentId, table.startedAt),
    uniqueIndex("calls_retell_provider_call_idx").on(table.providerCallId).where(sql`${table.provider} = 'retell'`),
    check("calls_provider_check", sql`${table.provider} IN ('livekit', 'retell')`),
    check("calls_retell_privacy_check", sql`${table.provider} <> 'retell' OR (${table.providerCallId} IS NOT NULL AND ${table.retellAgentId} IS NOT NULL AND ${table.transcript} IS NULL AND ${table.recordingKey} IS NULL AND ${table.callerId} IS NULL AND (${table.callerPhone} IS NULL OR ${table.callerPhone} ~ '^•••• [0-9]{4}$'))`),
    check("calls_cost_duration_check", sql`(${table.durationMs} IS NULL OR ${table.durationMs} >= 0) AND (${table.costCents} IS NULL OR (${table.costCents} >= 0 AND ${table.costCents} <= 100000000))`),
  ]
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
    employeeId: uuid("employee_id"),
    providerWriteState: text("provider_write_state").$type<"in_flight" | "reconciliation_required">(),
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
    foreignKey({ name: "appointments_employee_workspace_fk", columns: [table.agentId, table.employeeId], foreignColumns: [employees.agentId, employees.id] }),
    check("appointments_provider_write_state_check", sql`${table.providerWriteState} IS NULL OR (${table.employeeId} IS NOT NULL AND ${table.status} = 'requested' AND ${table.providerWriteState} IN ('in_flight', 'reconciliation_required'))`),
    check("appointments_employee_interval_check", sql`${table.employeeId} IS NULL OR (${table.startTime} IS NOT NULL AND ${table.endTime} IS NOT NULL AND ${table.endTime} > ${table.startTime})`),
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

export const employees = pgTable("employees", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentId: uuid("agent_id").notNull().references(() => workspaces.agentId, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  department: text("department"),
  routingEnabled: boolean("routing_enabled").notNull().default(false),
  manualAvailability: text("manual_availability").$type<"available" | "unavailable" | "unknown">().notNull().default("unknown"),
  timezone: text("timezone").notNull(),
  workingHours: jsonb("working_hours").$type<BusinessHours>().notNull().default(DEFAULT_BUSINESS_HOURS),
  encryptedTransferDestination: text("encrypted_transfer_destination"),
  transferDestinationDisplay: text("transfer_destination_display"),
  calendarPolicy: jsonb("calendar_policy").$type<import("@receptionist/shared").EmployeeCalendarPolicy>()
    .notNull().default({ authority: "direct", booking: null, conflicts: [] }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  unique("employees_agent_id_unique").on(t.agentId, t.id),
  index("employees_agent_name_idx").on(t.agentId, t.displayName, t.id),
]).enableRLS();

/** Google accounts authorized for calendar access. These are integrations, not login identities. */
export const calendarConnections = pgTable(
  "calendar_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id"),
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
    index("calendar_connections_employee_idx").on(table.agentId, table.employeeId),
    foreignKey({ name: "calendar_connections_employee_workspace_fk", columns: [table.agentId, table.employeeId],
      foreignColumns: [employees.agentId, employees.id] }),
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
  employeeId: uuid("employee_id"),
  email: text("email").notNull().default(""),
  role: text("role").$type<"manager" | "member">().notNull(),
  displayName: text("display_name").notNull().default(""),
  department: text("department").notNull().default(""),
  available: boolean("available").notNull().default(false),
}, t => [
  primaryKey({ columns: [t.agentId, t.userId] }),
  unique("workspace_members_employee_unique").on(t.agentId, t.employeeId),
  foreignKey({ name: "workspace_members_employee_workspace_fk", columns: [t.agentId, t.employeeId], foreignColumns: [employees.agentId, employees.id] }),
  index("workspace_members_user_idx").on(t.userId),
]).enableRLS();

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

export const retellConnections = pgTable("retell_connections", {
  agentId: uuid("agent_id").primaryKey().references(() => workspaces.agentId, { onDelete: "cascade" }),
  retellAgentId: text("retell_agent_id").notNull().unique(),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
export const retellWebhookReceipts = pgTable("retell_webhook_receipts", {
  dedupKey: text("dedup_key").primaryKey(),
  agentId: uuid("agent_id").notNull().references(() => workspaces.agentId, { onDelete: "cascade" }),
  event: text("event").notNull(),
  callId: text("call_id").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// Separate from OAuth calendar connections: Cal credentials and assignment never cross employees.
export const calcomConnections = pgTable('calcom_connections', {
 id: uuid('id').defaultRandom().primaryKey(),
 agentId: uuid('agent_id').notNull().references(() => workspaces.agentId, { onDelete: 'cascade' }),
 employeeId: uuid('employee_id').notNull(),
 authKind: text('auth_kind').$type<'api_key' | 'oauth'>().notNull().default('api_key'),
 encryptedCredential: text('encrypted_credential').notNull(),
 credentialVersion: bigint('credential_version', { mode: 'number' }).notNull().default(1),
 lifecycleGeneration: bigint('lifecycle_generation', { mode: 'number' }).notNull().default(1),
 lifecycleLeaseExpiresAt: timestamp('lifecycle_lease_expires_at', { withTimezone: true }),
 credentialRefreshLeaseExpiresAt: timestamp('credential_refresh_lease_expires_at', { withTimezone: true }),
 providerUserId: text('provider_user_id').notNull(),
 accountEmail: text('account_email').notNull(),
 displayLabel: text('display_label').notNull(),
 status: text('status').$type<'active' | 'setup_required' | 'reconnect_required' | 'disconnecting'>().notNull().default('active'),
 eventTypeId: integer('event_type_id'),
 webhookId: text('webhook_id'),
 destinationCalendarIntegration: text('destination_calendar_integration'),
 destinationCalendarExternalId: text('destination_calendar_external_id'),
 createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
 updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
 unique('calcom_employee_unique').on(t.agentId, t.employeeId),
 unique('calcom_provider_identity_unique').on(t.agentId, t.providerUserId),
 unique('calcom_agent_id_unique').on(t.agentId, t.id),
 foreignKey({ name: 'calcom_employee_workspace_fk', columns: [t.agentId, t.employeeId], foreignColumns: [employees.agentId, employees.id] }),
 check('calcom_auth_kind_check', sql`${t.authKind} IN ('api_key', 'oauth')`),
 check('calcom_status_check', sql`${t.status} IN ('active', 'setup_required', 'reconnect_required', 'disconnecting')`),
 check('calcom_versions_check', sql`${t.credentialVersion} > 0 AND ${t.lifecycleGeneration} > 0`),
 check('calcom_lease_state_check', sql`(${t.authKind} = 'oauth' OR ${t.credentialRefreshLeaseExpiresAt} IS NULL) AND (${t.lifecycleLeaseExpiresAt} IS NULL OR ${t.status} IN ('setup_required', 'disconnecting'))`),
 check('calcom_oauth_setup_check', sql`${t.authKind} <> 'oauth' OR ${t.status} <> 'active' OR (${t.eventTypeId} IS NOT NULL AND ${t.webhookId} IS NOT NULL AND ${t.destinationCalendarIntegration} IS NOT NULL AND ${t.destinationCalendarExternalId} IS NOT NULL AND length(${t.destinationCalendarIntegration}) > 0 AND length(${t.destinationCalendarExternalId}) > 0)`),
]).enableRLS();

// Opaque, short-lived, atomically deleted callback capabilities. No tokens or provider codes.
export const calcomOauthStates = pgTable('calcom_oauth_states', {
 stateHash: text('state_hash').primaryKey(),
 agentId: uuid('agent_id').notNull().references(() => workspaces.agentId, { onDelete: 'cascade' }),
 userId: text('user_id').notNull(),
 employeeId: uuid('employee_id').notNull(),
 intent: text('intent').$type<'connect' | 'reconnect'>().notNull(),
 startingConnectionId: uuid('starting_connection_id'),
 startingProviderUserId: text('starting_provider_user_id'),
 startingLifecycleGeneration: bigint('starting_lifecycle_generation', { mode: 'number' }),
 browserChallengeHash: text('browser_challenge_hash').notNull(),
 expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
 createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
 foreignKey({ name: 'calcom_oauth_states_employee_workspace_fk', columns: [t.agentId, t.employeeId], foreignColumns: [employees.agentId, employees.id] }).onDelete('cascade'),
 check('calcom_oauth_state_hash_check', sql`${t.stateHash} ~ '^[a-f0-9]{64}$' AND ${t.browserChallengeHash} ~ '^[a-f0-9]{64}$'`),
 check('calcom_oauth_state_identity_check', sql`length(${t.userId}) BETWEEN 1 AND 200 AND (${t.startingProviderUserId} IS NULL OR length(${t.startingProviderUserId}) BETWEEN 1 AND 200)`),
 check('calcom_oauth_state_intent_check', sql`(${t.intent} = 'connect' AND ${t.startingConnectionId} IS NULL AND ${t.startingProviderUserId} IS NULL AND ${t.startingLifecycleGeneration} IS NULL) OR (${t.intent} = 'reconnect' AND ${t.startingConnectionId} IS NOT NULL AND ${t.startingProviderUserId} IS NOT NULL AND ${t.startingLifecycleGeneration} > 0)`),
 index('calcom_oauth_states_expiry_idx').on(t.expiresAt),
 index('calcom_oauth_states_employee_idx').on(t.agentId, t.employeeId),
]).enableRLS();
export const calcomWebhookReceipts = pgTable('calcom_webhook_receipts', {
 connectionId: uuid('connection_id').notNull().references(() => calcomConnections.id, { onDelete: 'cascade' }),
 digest: text('digest').notNull(),
 bookingUid: text('booking_uid').notNull(),
 eventType: text('event_type').notNull(),
 createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.connectionId, t.digest] }), index('calcom_receipts_connection_time_idx').on(t.connectionId, t.createdAt), index('calcom_receipts_time_idx').on(t.createdAt)]).enableRLS();

// Durable side-effect results; no arguments, transcripts or provider response bodies.
export const retellFunctionInvocations = pgTable('retell_function_invocations', {
 key: text('key').primaryKey(),
 agentId: uuid('agent_id').notNull().references(() => workspaces.agentId, { onDelete: 'cascade' }),
 callId: text('call_id').notNull(),
 name: text('name').notNull(),
 semanticHash: text('semantic_hash').notNull(),
 state: text('state').$type<'processing' | 'completed' | 'uncertain'>().notNull().default('processing'),
 result: jsonb('result').$type<Record<string, unknown>>(),
 appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
 createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
 updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
 check('retell_invocation_state_check', sql`${t.state} IN ('processing', 'completed', 'uncertain')`),
 check('retell_invocation_result_check', sql`(${t.state} = 'completed') = (${t.result} IS NOT NULL) AND (${t.result} IS NULL OR (jsonb_typeof(${t.result}) = 'object' AND octet_length(${t.result}::text) <= 8192))`),
 check('retell_invocation_identity_check', sql`${t.key} ~ '^[a-f0-9]{64}$' AND ${t.semanticHash} ~ '^[a-f0-9]{64}$' AND length(${t.callId}) BETWEEN 1 AND 200 AND ${t.name} IN ('book-appointment', 'save-message')`),
 index('retell_invocation_recovery_idx').on(t.agentId, t.state, t.updatedAt),
]).enableRLS();
