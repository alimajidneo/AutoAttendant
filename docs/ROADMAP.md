> **2026-09-10 scope update:** At Ali's request, workspace implementation and browser transfer testing moved ahead of Microsoft. See [current workspace capabilities and testing](WORKSPACES_AND_TRANSFERS.md). Two-Google-account basic testing was reported successful.

> **2026-09-17 production-path update:** The immediate pilot is **USA numbers only**. Use a Retell-managed US number, Retell conversation flow/knowledge base, and DeskRoute's signed HTTP functions. Pakistan/international routing, custom SIP carriers, and number purchase are deferred. LiveKit is a legacy optional path and must remain unconfigured and hidden for the Retell-only deployment. No provider test, web call, number, deployment, migration, or other potentially billable action is authorized merely by this roadmap.

# DeskRoute delivery roadmap

Agreed with Ali on 2026-09-09. Neodym builds the product; Neodym or Triangle is the first pilot. This is the current scope and execution order. It supersedes conflicting personal-use, Clerk, provider and day-order instructions in earlier plans. Existing working code is preserved; completion requires evidence, not a date.

## Product and constraints

A company receptionist identifies the caller's purpose and intended employee, checks permitted calendars, and books, requests a transfer, or takes a message. Validate calendar fundamentals before expanding employee scheduling and telephone routing.

- Supabase PostgreSQL and Auth, Drizzle, and the existing React/Hono app. Keep credentials server-side and the unused Supabase Data API disabled.
- Vercel hosts the website and request-scoped HTTP API. Retell hosts the conversation/telephone runtime and calls DeskRoute's signed HTTPS functions and webhook. Do not deploy the optional LiveKit worker for the Retell-only pilot.
- Prefer existing free allowances for testing. Automated unit tests use no real credentials, paid models or calendar writes.
- Low invocations: same-origin production API, aggregate dashboard reads, cache private data only within the authenticated identity, refresh after mutations or explicitly, no recurring dashboard polling. These are deployment targets, not claims of current completion.
- No new orchestration framework, broad provider abstraction, placeholder functionality or developer-specific customer configuration.
- Calendar owners grant availability use explicitly. Workspace membership never grants personal event-detail access. Unknown availability is not free time.
- Existing account/calendar data needs a reviewed, versioned upgrade into workspaces; customers must not rebuild accounts or reconnect merely because the ownership model was unfinished.

## Ordered tasks and acceptance

| Step | Task | Acceptance / current status |
| --- | --- | --- |
| 1 | Connect two distinct Google accounts | Both appear under one DeskRoute login; reconnect is idempotent. Implemented; Ali reported the two-account test successful on 2026-09-10. |
| 2 | Cross-account conflict checks | A busy event in either selected account blocks the requested time; genuinely free 11 AM works. Automated cross-account/exact-time regressions pass; basic two-account test reported successful; detailed boundary checks remain. |
| 3 | Appointment lifecycle | Chosen destination, invitation, rescheduling, cancellation and external changes verified. Booking/cancellation, end-time-based Past appointments and owner-scoped history deletion exist; invitations, rescheduling and race-safe booking remain incomplete. |
| 4 | Privacy and failure handling | Ownership enforced even on cached credentials; browser-bound OAuth; missing/revoked/malformed calendar data blocks booking; no provider secrets/event details in errors. Hardening implemented with passing regression tests; live acceptance and narrower scopes pending. |
| 5 | Microsoft calendar connections | Delegated personal Outlook and work Microsoft 365 OAuth, listing, booking, cancellation, refresh-token rotation, and external-delete sync are implemented. Live account/admin-policy acceptance remains. |
| 6 | Mixed-provider availability | Google and Microsoft busy ranges are combined in the booking path. Live recurrence, all-day, DST, revocation, and race acceptance remain. |
| 7 | Thomas's calendar inventory | Identify all five actual providers, permissions and restrictions. Apple Calendar is a client, not proof that iCloud integration is needed. Awaiting inventory. |
| 8 | Workspaces | Separate personal/team workspaces, tab-local switching, member operational dashboard, verified account directory, owner calendar-account inventory and email-bound invitations implemented. Teammate live acceptance pending. |
| 9 | Workspace privacy and roles | Owner/manager/member permissions and isolated business data implemented. Members can read shared call-log summaries and DeskRoute bookings; transcripts, recordings, mutations, settings and owner external events stay protected. Employee-owned availability sharing remains pending. |
| 10 | Employees and routing | Member profiles, departments, manual availability and browser handoff requests implemented. Employee booking destinations, phone numbers, presence and transfer hours remain pending. |
| 11 | Cross-workspace scheduling | A booking for an employee in one company blocks the other without revealing details; prevent simultaneous cross-workspace booking. Pending. |
| 12 | Receptionist behavior | Approved FAQ answers, configurable intake, general appointments, honest message fallback. Existing features require full journey acceptance. |
| 13 | US telephony decision | **Complete for the first pilot:** Retell-managed US telephony is the simplest approved target. Custom SIP and international routes are deferred. No number has been purchased. |
| 14 | Stable hosted staging | Website/API work without Ali's computer; stable OAuth/Cal.com/Retell callback URLs, small DB pool, invocation measurements. The optional LiveKit worker is excluded. Pending deployment approval, secrets, backup and migrations. |
| 15 | Retell pre-telephone acceptance | Configure one draft/versioned agent, approved knowledge base and five signed functions. Run text simulation and then a web call only after confirming whether that provider action is free or receiving explicit spend approval. Transfers remain telephone-only and unproved here. |
| 15b | Real US telephone testing | After Ali buys a number: inbound route, private acceptance screening, accept/decline/no-answer behavior, audio, latency and measured provider usage. Deferred until number purchase and call-spend approval. |
| 16 | Slack alerts, approvals and transfer | Workspace install, selected channel, privacy-minimal alerts, and explicit test messages are implemented. Signed interactive accept/decline and actual human transfer remain pending. |
| 17 | Failure paths | Calendar/Slack/carrier failures reach scheduling or a message, never invented success. Pending full integration. |
| 18 | Production readiness | Production OAuth, privacy/retention/deletion, backups/restores, operator instructions, license/source offer and cost evidence. Pending. |
| 19 | Pilot acceptance | Neodym/Triangle real calls pass booking, transfer and fallback journeys. Required before handover. |

## Current US-only work batch

1. Freeze and independently review the Retell-only/optional-LiveKit local candidate.
2. Run unit, web, PostgreSQL migration/integration, type, lint, production-build, secret and Retell-only import gates.
3. Reconcile migrations `0012`–`0014` against the deployed `0011` boundary. Do not apply them without a fresh production backup and explicit approval.
4. Prepare the existing Vercel project and environment-variable inventory without uploading secrets or deploying.
5. After deployment approval, establish one stable HTTPS origin and register provider callbacks.
6. Configure a draft Retell agent and exercise text simulation. Treat a Retell web call as potentially billable until the account proves otherwise; do not run it under a strict zero-cost instruction.
7. Stop before number purchase or real calls. Those remain Ali-controlled gates.

The first end-to-end pilot must prove: US caller → Retell → signed DeskRoute employee/calendar function → confirmed booking or message, plus a telephone-only accepted warm transfer that bridges only after the employee says yes.

Use [USA-only Retell deployment and acceptance gate](US_RETELL_DEPLOYMENT_GATE.md) for the exact environment inventory, migration controls, browser-call limits, and approval boundaries.

## Historical work batches

2026-09-10 follow-up: Center route loading, add past-booking deletion to the calendar agenda, protect deletion cache updates from stale reads and deduplicate email/calendar labels. Document [current agent capabilities and the staged context plan](AGENT_CONTEXT_AND_CAPABILITIES.md). Context starts with workspace-scoped editable business notes and a published preview; document imports and deeper analysis remain later work. Hosted operation must pass tests with all local terminals stopped.

2026-09-11: The member portal now includes a dashboard, read-only workspace call logs and the shared DeskRoute appointment calendar. External personal calendar events remain owner-only; linking each employee's own availability still requires the planned permission-based ownership upgrade.

2026-09-10: Notifications, calendar source colors, workspaces and browser handoff are implemented. Added a public in-app step-by-step tutorial at `/help`, linked from sign-in, onboarding, the dashboard and Workspaces. It explains current capabilities and limitations without creating external integrations.

Historical 2026-09-10 next step: apply migration `0008_curved_nebula`, configure Microsoft Entra and Slack, then live-test personal Outlook, Microsoft 365, mixed-provider conflicts, and a privacy-safe Slack alert. The later Retell decision supersedes the separate-voice-worker instruction for the current pilot.

## Later only if required

Actual iCloud account support, Teams/SMS/WhatsApp, voice cloning, advanced routing and subscription billing. KVM is exceptional discovery for an approved restricted system, not the standard calendar architecture. Verify the exact hardware before claiming iPad control works.

## Evidence

Record automated checks, manual outcomes, side effects and unresolved failures in [CALENDAR_TESTING.md](CALENDAR_TESTING.md). On 2026-09-09, 211 unit/agent tests, typecheck, web lint and web build passed; five existing web design-contract failures remain. Eight appointment grouping tests also pass. The read-only database check found two connected Google accounts under one DeskRoute owner, but only one explicitly selected conflict calendar. Selection/display guidance has been clarified; Ali subsequently reported the two-account test successful on 2026-09-10; detailed boundary acceptance remains separate. Proceed to appointment lifecycle and Microsoft work while preserving the remaining failure/privacy acceptance gates.
