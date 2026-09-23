# DeskRoute

Neodym's AI receptionist for USA customer teams. The receptionist answers business questions, checks selected Google and Microsoft calendars, books appointments, and sends follow-ups to the dashboard and an optional Slack channel.

**Version 1.0.30 · Updated 2026-09-17**

This repository is under active development. Google booking and the legacy LiveKit browser path have historical test evidence. Microsoft Calendar and selected-channel Slack alerts are implemented and await complete live acceptance. The current pilot is **Retell-only and USA-only**: its signed DeskRoute boundary is locally implemented, while hosted provider/telephone acceptance remains. The Vercel website/API adapter is ready but not deployed. LiveKit is optional and disabled for the current production path.

- [Agent capabilities and context plan](docs/AGENT_CONTEXT_AND_CAPABILITIES.md)
- [Slack and Microsoft integration plan](docs/INTEGRATION_PLAN.md)
- [Setup instructions](docs/SETUP.md)
- [Ordered delivery roadmap](docs/ROADMAP.md)
- [Calendar acceptance checklist and evidence](docs/CALENDAR_TESTING.md)
- [Notifications and calendar source colors](docs/NOTIFICATIONS_AND_CALENDAR_SOURCES.md)
- [Workspaces, invitations and browser handoff](docs/WORKSPACES_AND_TRANSFERS.md)
- [Phone integration sequence](docs/TELEPHONY_PLAN.md)
- [USA-only Retell deployment and acceptance gate](docs/US_RETELL_DEPLOYMENT_GATE.md)
- [Architecture](ARCHITECTURE.md) · [Decisions](docs/DECISIONS.md) · [Vercel feasibility](docs/VERCEL_FEASIBILITY.md)

## In-app tutorial

Open **Help & tutorial** in the sidebar, or visit `/help` on your DeskRoute website. The tutorial is also linked from sign-in, onboarding and Workspaces. Nine searchable guides explain setup, roles/privacy, hours, FAQs/intake, Google/Microsoft calendars, Slack alerts, appointments and browser call/handoff testing. Each guide has numbered steps, expected results and troubleshooting. Help is available before sign-in and adds no application API queries.

Microsoft Calendar and basic Slack alerts are available under **Settings → Connections**. Teams presence and Slack transfer approvals remain later work; see the [integration sequence and official documentation](docs/INTEGRATION_PLAN.md).

## Current functionality

- Supabase Auth for DeskRoute sign-in; separate OAuth connections for additional Google and Microsoft accounts.
- Multiple Google, Outlook.com, and Microsoft 365 accounts and calendars. The owner chooses which calendars block availability and one destination for new bookings.
- One Slack workspace connection per DeskRoute workspace, with an owner-selected channel and opt-in alerts. Alert text excludes caller and calendar details.
- Business hours, exceptions, timezone, booking notice/horizon, services and general appointments.
- Configurable receptionist instructions, FAQ knowledge and caller intake questions.
- Optional legacy browser voice testing through LiveKit when explicitly configured. It is disabled for Retell-only deployments; bookings made through any connected live test can be real provider events.
- Calendar month grid and daily agenda, including personal events from the owner's explicitly selected calendars.
- Connected-account colors shared by every calendar from that account, with provider, account, and calendar names in the source legend.
- Upcoming/ongoing bookings and Past appointments, classified by end time. Delete a past DeskRoute booking from either the daily agenda or Past appointments; its linked provider event and DeskRoute history are removed. Pending calendar reads are cancelled before updating every cached month.
- In-app notification bell with unread count, record links and persistent read status across devices. Includes bookings, requests, cancellations, pending questions and failed calls.
- Calls, transcripts, summaries, optional recordings, questions awaiting answers and FAQ management.
- Team-first company workspaces, a member dashboard with read-only call logs and appointment calendar, manually shared one-time invitation codes bound to verified sign-in emails, owner/manager/member access, a workspace member table, and configurable teammate departments/availability. Existing personal workspaces remain intact and owners can convert them in place before inviting employees.
- Independent employees under **Settings → Employees**: manager editing, encrypted private transfer numbers, employee calendars/hours, Google/Microsoft account assignment, and direct or personal Cal.com booking policies. Locally implemented provider-backed fail-closed availability, signed Retell webhooks/functions, normalized calls, and direct booking/message fallback; see the [beginner-friendly Retell production setup](docs/ALI_RETELL_SETUP.md) and [implementation and verification limits](docs/RETELL_MVP_IMPLEMENTATION.md). Real telephone transfer and hosted acceptance remain unverified.
- Employees sign in with Google, join the company using a code shared by the owner outside DeskRoute, and connect their own calendar from **My employee setup** after a manager links their account to the correct employee. The setup checklist distinguishes a connected account from a manager-approved booking destination. DeskRoute does not send invitation emails.
- Optional legacy LiveKit browser handoff requests with recipient acceptance, manual inbox refresh and restricted room tokens; hidden when LiveKit is disabled.
- Light/dark themes, profile details and loading indicators centered in the viewport or dashboard content area.

On **2026-09-10**, Ali reported the two-Google-account test was successful. Detailed failure, revocation, cross-owner and simultaneous-booking acceptance are separate checks; a successful basic test does not establish production readiness.

On **2026-09-14**, migrations `0010_employee_foundation` and `0011_retell_boundary` were applied to the currently configured Supabase database after a private, checksummed recovery package was created. All four stored Google connections remained decryptable, and Ali confirmed the calendar-account list loaded afterward.

## Notifications

Open the top-bar bell. Select a notification to mark it read and open its related page, or use **Mark all read** for the displayed unread items. **Refresh** checks for new activity.

The feed shows the latest **50 records from the last 30 days**. It loads with the dashboard and refreshes when opened, explicitly refreshed, or affected by supported actions in the app. It does not continuously poll, send email/SMS, or request browser push permission. Unanswered questions remain available on the Questions page even after leaving this recent feed.

Read receipts are stored in PostgreSQL behind the authenticated API. The read request identifies the version displayed, so a cancellation arriving during the request remains unread. Notification text is derived from the original records rather than copied into a second event log. See [behavior, privacy and limitations](docs/NOTIFICATIONS_AND_CALENDAR_SOURCES.md).

## Cal.com integration plan

Cal.com is the scheduling authority for employees who choose the Cal.com route. One employee connects the three Google and two Microsoft calendars in their Cal.com account, selects all five for conflict checking, and chooses one writable destination calendar for new bookings. DeskRoute asks Cal.com for slots and creates bookings through its API; Cal.com handles the provider calendar connections. This is a combined booking schedule, not a copy of all external event details in the DeskRoute agenda.

The implementation is organized in four small parts so calendar providers or booking rules can change independently:

1. **Connect:** Link a workspace member to an employee, then connect that employee's Cal.com account from **My employee setup**. Hosted OAuth is the preferred path. The owner-only API-key flow remains available for an existing account while OAuth approval is pending.
2. **Configure:** In Cal.com, confirm all five conflict calendars and one booking destination. Cal.com readiness proves that a destination exists; it does not prove that all five conflicts are selected. The employee checks those five settings in Cal.com. Hosted OAuth setup creates one 30-minute personal event type per employee for the first release; the manager-owned API-key path can select another supported fixed-duration event type.
3. **Book:** DeskRoute and Retell request slots, confirm the caller's contact and exact time, reserve locally, and submit one Cal.com booking. Only a confirmed provider result is announced as booked. Signed webhooks and authenticated reconciliation handle later changes or uncertain writes.
4. **Accept and expand:** Test conflicts on every Google/Microsoft calendar, destination writes, cancellation, simultaneous calls, revoked access, timezones and daylight saving time. After those checks, expand event types, rescheduling and an embedded Cal.com booking UI as needed. Keep direct Google/Microsoft scheduling as an explicit alternate authority per employee.

To activate this in a hosted environment, the operator must:

1. Apply the reviewed 0012–0014 database migration chain using the runbook in [Cal.com integration](docs/CALCOM_INTEGRATION.md).
2. For the first live pilot, keep hosted OAuth disabled and use the workspace owner's legacy Cal.com API-key form for one consenting employee. The owner enters the key inside DeskRoute, then selects a compatible fixed-duration event type. Configure `TOKEN_ENCRYPTION_KEY`, `CALCOM_WEBHOOK_SECRET`, `CRON_SECRET`, and `PUBLIC_API_URL` as server secrets. Do not put the API key in server environment variables, chat, or source control. Later, register and obtain approval for a hosted Cal.com OAuth client with the exact `PUBLIC_API_URL/api/calcom/oauth/callback` redirect, configure `CALCOM_OAUTH_CLIENT_ID` and `CALCOM_OAUTH_CLIENT_SECRET`, and enable `CALCOM_OAUTH_WRITE_APPROVED` only after approval of the automatic event-type and webhook writes.
3. Deploy the public API and webhook endpoint, connect the employee, and run the live five-calendar acceptance checks before enabling telephone booking.

DeskRoute does not request Google Calendar scopes when an employee uses only Cal.com scheduling. The user still grants Google/Microsoft access to Cal.com. DeskRoute's separate Google sign-in, if retained, has its own identity authorization. Do not remove direct-provider code or its credentials until every employee using it has migrated.

The [detailed Cal.com contract](docs/CALCOM_INTEGRATION.md) covers API versions, credentials, webhooks, recovery and migration checks. On 2026-09-23, Ali's Org `deskroute-dev` database passed the 0011 preflight, applied migrations 0012–0014 transactionally, and passed the 0014 postflight. The Cal.com release is deployed at [deskroute-retell.vercel.app](https://deskroute-retell.vercel.app), with its frontend configured for `kpwrmksedtcncrnltdro`; the live API health and authentication-boundary checks passed. Live Cal.com account and five-calendar booking acceptance remain pending.

## Calendar account and calendar selection

1. Sign in to the DeskRoute account that owns the receptionist.
2. Open **Settings → Connections → Calendars → Manage**.
3. Use **Google** or **Microsoft** for another Gmail, Outlook.com, or Microsoft 365 identity. This does not change your DeskRoute login.
4. Choose the **Booking calendar**, then enable all intended calendars under **Calendars that block free time**.
5. Click **Save calendar settings**, return to Appointments, and refresh.

“0 calendars included” means the account is connected but none of its calendars is selected. Unselected calendars are excluded from display and conflict checks. Google-created events appear in the grid/agenda; Upcoming/Past lists hold receptionist bookings.

When Google names a calendar after its account email, the legend and daily event source show that email once. Distinct secondary calendar names remain visible.

Colors identify accounts, not appointment status. The legend remains present for selected calendars even in a month without events. Shared calendars selected through two connections are displayed once. The eight-color palette repeats beyond eight accounts; account names remain visible.

## Hosted operation

Customers use the deployed website without terminal commands. The repository deploys its Vite website and Hono API as one Vercel project. Retell hosts the conversation and telephone runtime and invokes DeskRoute's signed HTTPS routes, so the current pilot does not need a persistent voice-worker deployment. The Cal.com release is deployed to the existing DeskRoute site; provider and voice acceptance remain to be performed. Follow the [step-by-step Vercel setup](docs/SETUP.md#10-deploy-the-website-and-api-to-vercel), [Retell production setup](docs/ALI_RETELL_SETUP.md), and [running without local terminals](docs/VERCEL_FEASIBILITY.md#running-without-local-terminals).

## Run locally

Requires Node.js 22+, pnpm, a configured Supabase project and the credentials described in [SETUP.md](docs/SETUP.md). A phone number is not required for browser testing. R2 is optional for recordings; OpenRouter is optional when selected as the model provider.

```bash
git clone https://github.com/alimajidneo/AutoAttendant.git
cd AutoAttendant
pnpm install
```

Copy the package-specific `.env.example` files and fill the values locally. Keep secrets out of Git. Follow the setup guide for Supabase and the Google OAuth callback; calendar connection uses `/api/calendar/oauth/callback` on the API origin.

Apply committed migrations before starting an updated API:

```bash
pnpm db:migrate
```

Migrations `0010_employee_foundation` and `0011_retell_boundary` add employee-owned calendar policy, normalized Retell records, and protected provider-write state. Migration `0009_redundant_ulik` records verified workspace-member emails for the team directory. Migration `0008_curved_nebula` adds the encrypted, workspace-scoped Slack installation. Existing workspaces, Google accounts, and appointments remain in place.

Run in separate terminals:

```bash
pnpm dev:api        # http://localhost:8080
pnpm dev:web        # http://localhost:5173
pnpm dev:voice      # needed for browser/telephone voice calls
```

Or use `pnpm dev` for all three. Do not start duplicate servers on the same ports. Stop a process with Ctrl+C before restarting it.

## Stack and deployment

| Component | Technology / role |
| --- | --- |
| Website | React, Vite, TypeScript, Tailwind, TanStack Query |
| HTTP API | Hono on Node.js |
| Database | Supabase PostgreSQL with Drizzle migrations and repositories |
| Sign-in | Supabase Auth |
| Calendar integrations | Google Calendar API + Microsoft Graph Calendar |
| Team notifications | Slack selected-channel alerts; interactive transfer approval planned |
| Voice runtime | Retell for the current US pilot; optional legacy LiveKit code remains disabled |
| Recordings | Optional Cloudflare R2 |
| Telephony | Retell-managed US number for the first pilot; number purchase and real-call acceptance pending |
| Deployment target | Vercel website/API + Retell hosted voice runtime; no DeskRoute persistent worker |

Private records are scoped to the selected workspace and verified membership. Members can read the shared call-log summary and DeskRoute booking calendar; managers additionally access call transcripts/recordings and manage records/settings. Only the workspace owner manages calendar connections or views external personal event details. PostgreSQL RLS remains enabled, and Supabase's unused Data API stays disabled. Employee-owned availability sharing across companies remains pending.

## Verification

```bash
pnpm test          # mocked backend/voice tests; no paid calls
pnpm typecheck
pnpm lint
pnpm build
pnpm test:web

docker compose up -d test-db
pnpm test:int      # disposable local PostgreSQL only
```

`pnpm test:live` uses real credentials and writes Google Calendar test events; it is separate from the above checks. The integration runner refuses a non-local or differently named test database before creating fixtures or clearing test records.

See [verification evidence](docs/RETELL_MVP_IMPLEMENTATION.md#local-verification) for this release. Five existing web design-contract failures conflict with the current approved colors/theme and sign-in width; they are documented and have not been disabled.

## Remaining delivery work

1. Complete rescheduling, invitations and external time-change synchronization. Simultaneous employee booking protection is implemented locally; live acceptance remains.
2. Live-test personal Outlook, Microsoft 365, mixed Google/Microsoft conflicts, recurrence, all-day events, DST, and revoked access.
3. Accept-test workspaces and browser handoff with teammates. Employee-owned calendar availability and booking are implemented locally; consent flows and live provider acceptance remain.
4. Extend browser department routing to approved telephone destinations, presence/transfer hours and reliable fallback rules.
5. Integrate Mike's phone system and test inbound calls, assisted transfers, no-answer and hang-up behavior.
6. Add signed Slack or Teams transfer approvals after browser and phone transfers work.
7. Finish production OAuth and verify privacy, backups and actual provider costs before customer handover.

Deploy stable Vercel staging and the separate worker before phone integration so teammates can test browser workflows first. See [the deployment and testing order](docs/WORKSPACES_AND_TRANSFERS.md).

Provider discovery and a small telephone connectivity test can proceed before the complete team-routing product. See [the phone integration sequence](docs/TELEPHONY_PLAN.md). Do not port the customer's main number during early testing.

## API additions

All `/api/admin/*` endpoints require a valid DeskRoute session and membership in the selected workspace. Members have read-only access to the call list, DeskRoute appointment list, and workspace appointment calendar. Call detail/recordings, all mutations, and every other admin module require a manager; calendar connection routes additionally require the workspace owner. `X-Workspace-Id` is validated on every scoped request.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/admin/notifications` | Latest 50 owner-scoped notifications from 30 days |
| POST | `/api/admin/notifications/read` | Mark up to 50 displayed notification versions read |
| GET | `/api/admin/appointments` | DeskRoute booking records (currently capped at 100) |
| GET | `/api/admin/appointments/calendar?timeMin=…&timeMax=…` | Owner: selected external events; other members: shared DeskRoute bookings; at most 45 days |
| POST | `/api/admin/appointments/sync` | Reconcile externally deleted calendar events |
| DELETE | `/api/admin/appointments/:id` | Cancel booking and remove its provider event |
| DELETE | `/api/admin/appointments/history/:id` | Delete an ended booking and its linked provider event |
| GET | `/api/admin/calls` | Workspace call-log summaries; member-readable |
| GET | `/api/admin/calls/:id` | Transcript/detail; manager-only |
| GET | `/api/admin/calls/:id/recording` | Temporary recording URL; manager-only |
| GET | `/api/admin/calendar/list` | Connected Google/Microsoft accounts and calendars |
| PATCH | `/api/admin/calendar` | Save booking destination and conflict selection |
| DELETE | `/api/admin/calendar/:connectionId` | Disconnect one account |
| GET/PATCH/DELETE | `/api/admin/slack` | Read, configure, or disconnect Slack |
| GET | `/api/admin/slack/oauth/start` | Begin a browser-bound Slack installation |
| POST | `/api/admin/slack/test` | Send one explicit test message to the saved channel |

`/api/workspaces` provides listing, creation, verified-email invitation acceptance and membership management. Managers see member account addresses; members see only their own address. `/api/transfers` provides a member-scoped inbox and acceptance tokens. See [workspace guide](docs/WORKSPACES_AND_TRANSFERS.md).

Other API modules cover onboarding, settings, calls, questions, knowledge, services, phone provisioning and browser voice sessions. Their routes are defined in `apps/api/src/routes.ts`.

## License and upstream

[AGPL-3.0](LICENSE). Original DeskRoute © 2026 Prabhat Mattoo; [upstream project](https://github.com/PrabhatMattoo/DeskRoute). This repository contains Neodym's modifications; [the corresponding source is available here](https://github.com/alimajidneo/AutoAttendant).

Retell Phase B is implemented locally: signed webhooks/functions, employee calendar booking and minimal settings/call outcomes. See [implementation and verification limits](docs/RETELL_MVP_IMPLEMENTATION.md) and [Ali’s account checklist](docs/ALI_RETELL_SETUP.md). Real-provider and transfer acceptance remain unverified.

Employee-specific Cal.com API v2 connections, member-linked hosted OAuth self-service, dedicated event/webhook setup, slot checks, booking and reconciliation are documented in [Cal.com integration](docs/CALCOM_INTEGRATION.md). Migrations 0012–0014 and the web/API release are deployed for Ali's Org `deskroute-dev`; live provider and voice checks remain pending. Production OAuth writes stay disabled until Cal.com approves them during client review.
