> **2026-09-10 scope update:** At Ali's request, workspace implementation and browser transfer testing moved ahead of Microsoft. See [current workspace capabilities and testing](WORKSPACES_AND_TRANSFERS.md). Two-Google-account basic testing was reported successful.

# DeskRoute delivery roadmap

Agreed with Ali on 2026-09-09. Neodym builds the product; Neodym or Triangle is the first pilot. This is the current scope and execution order. It supersedes conflicting personal-use, Clerk, provider and day-order instructions in earlier plans. Existing working code is preserved; completion requires evidence, not a date.

## Product and constraints

A company receptionist identifies the caller's purpose and intended employee, checks permitted calendars, and books, requests a transfer, or takes a message. Validate calendar fundamentals before expanding employee scheduling and telephone routing.

- Supabase PostgreSQL and Auth, Drizzle, existing React/Hono app and LiveKit. Keep credentials server-side and the unused Supabase Data API disabled.
- Eventual Vercel Pro website and HTTP API, with a separately hosted LiveKit worker. No persistent worker inside a request function.
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
| 5 | Microsoft calendar connections | Personal Outlook and work Microsoft 365 tested with appropriate permissions/admin approval. Not implemented. |
| 6 | Mixed-provider availability | Google and Microsoft jointly block time; recurring/all-day/DST cases verified. Pending step 5. |
| 7 | Thomas's calendar inventory | Identify all five actual providers, permissions and restrictions. Apple Calendar is a client, not proof that iCloud integration is needed. Awaiting inventory. |
| 8 | Workspaces | Separate personal/team workspaces, tab-local switching and email-bound invitations implemented. Teammate live acceptance pending. |
| 9 | Workspace privacy and roles | Owner/manager/member permissions and isolated business data implemented; owner-only external calendar details. Employee-owned availability sharing remains pending. |
| 10 | Employees and routing | Member profiles, departments, manual availability and browser handoff requests implemented. Employee booking destinations, phone numbers, presence and transfer hours remain pending. |
| 11 | Cross-workspace scheduling | A booking for an employee in one company blocks the other without revealing details; prevent simultaneous cross-workspace booking. Pending. |
| 12 | Receptionist behavior | Approved FAQ answers, configurable intake, general appointments, honest message fallback. Existing features require full journey acceptance. |
| 13 | Mike's VoIP discovery | Provider documentation, SIP/transfer/presence, number routing, costs. Collect in parallel from the beginning; do not choose a carrier blindly. |
| 14 | Stable hosted staging | Website/API/worker work without Ali's computer; stable OAuth/Slack callback URLs, small DB pool, invocation measurements. Pending. |
| 15 | Real telephone testing | Inbound route, audio, response latency and measured provider usage. Pending. |
| 16 | Slack approvals and transfer | Authenticated call-specific accept/decline, expiration, hang-up, busy and no-answer behavior; actual human connection. Pending. |
| 17 | Failure paths | Calendar/Slack/carrier failures reach scheduling or a message, never invented success. Pending full integration. |
| 18 | Production readiness | Production OAuth, privacy/retention/deletion, backups/restores, operator instructions, license/source offer and cost evidence. Pending. |
| 19 | Pilot acceptance | Neodym/Triangle real calls pass booking, transfer and fallback journeys. Required before handover. |

## Current work batch

2026-09-10: Notifications, calendar source colors, workspaces and browser handoff are implemented. Added a public in-app step-by-step tutorial at `/help`, linked from sign-in, onboarding, the dashboard and Workspaces. It explains current capabilities and limitations without creating external integrations.

Next: live browser handoff and teammate privacy acceptance, then stable Vercel staging with a separate voice worker. Complete appointment lifecycle and Microsoft calendars before adding Teams presence. Validate personal Outlook, Microsoft 365 and mixed Google/Microsoft conflicts. Slack should start with selected-channel alerts, then recipient-approved handoff. See the [researched integration plan](INTEGRATION_PLAN.md) for permissions, privacy, costs and acceptance order. Gather Mike's provider documentation in parallel; see [phone integration sequence](TELEPHONY_PLAN.md).

## Later only if required

Actual iCloud account support, Teams/SMS/WhatsApp, voice cloning, advanced routing and subscription billing. KVM is exceptional discovery for an approved restricted system, not the standard calendar architecture. Verify the exact hardware before claiming iPad control works.

## Evidence

Record automated checks, manual outcomes, side effects and unresolved failures in [CALENDAR_TESTING.md](CALENDAR_TESTING.md). On 2026-09-09, 211 unit/agent tests, typecheck, web lint and web build passed; five existing web design-contract failures remain. Eight appointment grouping tests also pass. The read-only database check found two connected Google accounts under one DeskRoute owner, but only one explicitly selected conflict calendar. Selection/display guidance has been clarified; Ali subsequently reported the two-account test successful on 2026-09-10; detailed boundary acceptance remains separate. Proceed to appointment lifecycle and Microsoft work while preserving the remaining failure/privacy acceptance gates.
