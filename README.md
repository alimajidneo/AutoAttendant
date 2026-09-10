# DeskRoute

Neodym's AI receptionist for USA customer teams. The receptionist answers business questions, checks selected Google and Microsoft calendars, books appointments, and sends follow-ups to the dashboard and an optional Slack channel.

**Version 1.0.25 · Updated 2026-09-10**

This repository is under active development. Browser voice calls and Google booking have been tested. Microsoft Calendar and selected-channel Slack alerts are implemented and await live account acceptance. Teams presence, two-person audio acceptance, and telephone transfer remain pending. The intended deployment is a Vercel website/HTTP API plus a separately hosted LiveKit voice worker.

- [Agent capabilities and context plan](docs/AGENT_CONTEXT_AND_CAPABILITIES.md)
- [Slack and Microsoft integration plan](docs/INTEGRATION_PLAN.md)
- [Setup instructions](docs/SETUP.md)
- [Ordered delivery roadmap](docs/ROADMAP.md)
- [Calendar acceptance checklist and evidence](docs/CALENDAR_TESTING.md)
- [Notifications and calendar source colors](docs/NOTIFICATIONS_AND_CALENDAR_SOURCES.md)
- [Workspaces, invitations and browser handoff](docs/WORKSPACES_AND_TRANSFERS.md)
- [Phone integration sequence](docs/TELEPHONY_PLAN.md)
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
- Browser voice testing through LiveKit; bookings made during a test are real events in the selected provider calendar.
- Calendar month grid and daily agenda, including personal events from the owner's explicitly selected calendars.
- Connected-account colors shared by every calendar from that account, with provider, account, and calendar names in the source legend.
- Upcoming/ongoing bookings and Past appointments, classified by end time. Delete a past DeskRoute booking from either the daily agenda or Past appointments; its linked provider event and DeskRoute history are removed. Pending calendar reads are cancelled before updating every cached month.
- In-app notification bell with unread count, record links and persistent read status across devices. Includes bookings, requests, cancellations, pending questions and failed calls.
- Calls, transcripts, summaries, optional recordings, questions awaiting answers and FAQ management.
- Personal/team workspaces, explicit email-bound invitations, owner/manager/member access and configurable teammate departments/availability.
- Browser handoff requests with recipient acceptance, manual inbox refresh and restricted LiveKit room tokens.
- Light/dark themes, profile details and loading indicators centered in the viewport or dashboard content area.

On **2026-09-10**, Ali reported the two-Google-account test was successful. Detailed failure, revocation, cross-owner and simultaneous-booking acceptance are separate checks; a successful basic test does not establish production readiness.

## Notifications

Open the top-bar bell. Select a notification to mark it read and open its related page, or use **Mark all read** for the displayed unread items. **Refresh** checks for new activity.

The feed shows the latest **50 records from the last 30 days**. It loads with the dashboard and refreshes when opened, explicitly refreshed, or affected by supported actions in the app. It does not continuously poll, send email/SMS, or request browser push permission. Unanswered questions remain available on the Questions page even after leaving this recent feed.

Read receipts are stored in PostgreSQL behind the authenticated API. The read request identifies the version displayed, so a cancellation arriving during the request remains unread. Notification text is derived from the original records rather than copied into a second event log. See [behavior, privacy and limitations](docs/NOTIFICATIONS_AND_CALENDAR_SOURCES.md).

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

Customers will use the deployed website without terminal commands. The intended setup is Vercel web/API plus a managed LiveKit voice worker, deployed through an operator-controlled release process. This is not deployed yet. See [running without local terminals](docs/VERCEL_FEASIBILITY.md#running-without-local-terminals).

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

Migration `0008_curved_nebula` adds the encrypted, workspace-scoped Slack installation. Earlier migrations add workspaces and independent calendar connections. Existing workspaces, Google accounts, and appointments remain in place.

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
| Voice worker | LiveKit Agents, configurable STT/LLM/TTS |
| Recordings | Optional Cloudflare R2 |
| Telephony | LiveKit SIP/phone-number integration; Mike's provider discovery and real-call acceptance pending |
| Deployment target | Vercel website/API, separate persistent worker |

Private records are scoped to the selected workspace and verified membership. Managers access business records; members access their directory/profile and addressed browser transfers. Only the workspace owner manages calendar connections or views external personal event details. PostgreSQL RLS remains enabled, and Supabase's unused Data API stays disabled. Employee-owned availability sharing across companies remains pending.

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

See [verification evidence](docs/WORKSPACES_AND_TRANSFERS.md#verification) for this release. Five existing web design-contract failures conflict with the current approved colors/theme and sign-in width; they are documented and have not been disabled.

## Remaining delivery work

1. Complete rescheduling, invitations, external time-change synchronization and simultaneous-booking protection.
2. Live-test personal Outlook, Microsoft 365, mixed Google/Microsoft conflicts, recurrence, all-day events, DST, and revoked access.
3. Accept-test workspaces and browser handoff with teammates; add explicit employee-owned calendar availability sharing.
4. Extend browser department routing to approved telephone destinations, presence/transfer hours and reliable fallback rules.
5. Integrate Mike's phone system and test inbound calls, assisted transfers, no-answer and hang-up behavior.
6. Add signed Slack or Teams transfer approvals after browser and phone transfers work.
7. Finish production OAuth and verify privacy, backups and actual provider costs before customer handover.

Deploy stable Vercel staging and the separate worker before phone integration so teammates can test browser workflows first. See [the deployment and testing order](docs/WORKSPACES_AND_TRANSFERS.md).

Provider discovery and a small telephone connectivity test can proceed before the complete team-routing product. See [the phone integration sequence](docs/TELEPHONY_PLAN.md). Do not port the customer's main number during early testing.

## API additions

All `/api/admin/*` endpoints require a valid DeskRoute session and manager membership in the selected workspace. Calendar connection routes additionally require the workspace owner. `X-Workspace-Id` is validated on every scoped request.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/admin/notifications` | Latest 50 owner-scoped notifications from 30 days |
| POST | `/api/admin/notifications/read` | Mark up to 50 displayed notification versions read |
| GET | `/api/admin/appointments` | DeskRoute booking records (currently capped at 100) |
| GET | `/api/admin/appointments/calendar?timeMin=…&timeMax=…` | Selected Google/Microsoft events and sources; at most 45 days |
| POST | `/api/admin/appointments/sync` | Reconcile externally deleted calendar events |
| DELETE | `/api/admin/appointments/:id` | Cancel booking and remove its provider event |
| DELETE | `/api/admin/appointments/history/:id` | Delete an ended booking and its linked provider event |
| GET | `/api/admin/calendar/list` | Connected Google/Microsoft accounts and calendars |
| PATCH | `/api/admin/calendar` | Save booking destination and conflict selection |
| DELETE | `/api/admin/calendar/:connectionId` | Disconnect one account |
| GET/PATCH/DELETE | `/api/admin/slack` | Read, configure, or disconnect Slack |
| GET | `/api/admin/slack/oauth/start` | Begin a browser-bound Slack installation |
| POST | `/api/admin/slack/test` | Send one explicit test message to the saved channel |

`/api/workspaces` provides listing, creation, email-bound invitation acceptance and membership management. `/api/transfers` provides a member-scoped inbox and acceptance tokens. See [workspace guide](docs/WORKSPACES_AND_TRANSFERS.md).

Other API modules cover onboarding, settings, calls, questions, knowledge, services, phone provisioning and browser voice sessions. Their routes are defined in `apps/api/src/routes.ts`.

## License and upstream

[AGPL-3.0](LICENSE). Original DeskRoute © 2026 Prabhat Mattoo; [upstream project](https://github.com/PrabhatMattoo/DeskRoute). This repository contains Neodym's modifications; [the corresponding source is available here](https://github.com/alimajidneo/AutoAttendant).
