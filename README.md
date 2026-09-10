# DeskRoute

Neodym's AI receptionist for USA customer teams. The receptionist answers business questions, checks selected calendars across Google accounts, books appointments, and sends questions it cannot answer to the owner's dashboard.

**Version 1.0.22 · Updated 2026-09-10**

This repository is under active development. Browser voice calls and Google booking have been tested. Personal/team workspaces and browser handoff are implemented; two-person audio acceptance, Microsoft calendars and telephone transfer remain pending. The intended deployment is a Vercel website/HTTP API plus a separately hosted LiveKit voice worker.

- [Setup instructions](docs/SETUP.md)
- [Ordered delivery roadmap](docs/ROADMAP.md)
- [Calendar acceptance checklist and evidence](docs/CALENDAR_TESTING.md)
- [Notifications and calendar source colors](docs/NOTIFICATIONS_AND_CALENDAR_SOURCES.md)
- [Workspaces, invitations and browser handoff](docs/WORKSPACES_AND_TRANSFERS.md)
- [Phone integration sequence](docs/TELEPHONY_PLAN.md)
- [Architecture](ARCHITECTURE.md) · [Decisions](docs/DECISIONS.md) · [Vercel feasibility](docs/VERCEL_FEASIBILITY.md)

## Current functionality

- Supabase Auth for DeskRoute sign-in; separate OAuth connections for additional Google accounts.
- Multiple Google accounts and multiple calendars per account. The owner chooses which calendars block availability and one destination for new bookings.
- Business hours, exceptions, timezone, booking notice/horizon, services and general appointments.
- Configurable receptionist instructions, FAQ knowledge and caller intake questions.
- Browser voice testing through LiveKit; bookings made during a test are real Google Calendar events.
- Calendar month grid and daily agenda, including personal events from the owner's explicitly selected calendars.
- Google-account colors shared by every calendar from that account, with a named source legend below the calendar and source text on daily events.
- Upcoming/ongoing bookings and Past appointments, classified by end time. Deleting a past booking removes its linked Google event and DeskRoute history.
- In-app notification bell with unread count, record links and persistent read status across devices. Includes bookings, requests, cancellations, pending questions and failed calls.
- Calls, transcripts, summaries, optional recordings, questions awaiting answers and FAQ management.
- Personal/team workspaces, explicit email-bound invitations, owner/manager/member access and configurable teammate departments/availability.
- Browser handoff requests with recipient acceptance, manual inbox refresh and restricted LiveKit room tokens.
- Light/dark themes, profile details and loading indicators.

On **2026-09-10**, Ali reported the two-Google-account test was successful. Detailed failure, revocation, cross-owner and simultaneous-booking acceptance are separate checks; a successful basic test does not establish production readiness.

## Notifications

Open the top-bar bell. Select a notification to mark it read and open its related page, or use **Mark all read** for the displayed unread items. **Refresh** checks for new activity.

The feed shows the latest **50 records from the last 30 days**. It loads with the dashboard and refreshes when opened, explicitly refreshed, or affected by supported actions in the app. It does not continuously poll, send email/SMS, or request browser push permission. Unanswered questions remain available on the Questions page even after leaving this recent feed.

Read receipts are stored in PostgreSQL behind the authenticated API. The read request identifies the version displayed, so a cancellation arriving during the request remains unread. Notification text is derived from the original records rather than copied into a second event log. See [behavior, privacy and limitations](docs/NOTIFICATIONS_AND_CALENDAR_SOURCES.md).

## Google account and calendar selection

1. Sign in to the DeskRoute account that owns the receptionist.
2. Open **Settings → Connections → Google Calendar → Manage**.
3. Use **Connect account** for another Gmail/Workspace identity. This does not change your DeskRoute login.
4. Choose the **Booking calendar**, then enable all intended calendars under **Calendars that block free time**.
5. Click **Save calendar settings**, return to Appointments, and refresh.

“0 calendars included” means the account is connected but none of its calendars is selected. Unselected calendars are excluded from display and conflict checks. Google-created events appear in the grid/agenda; Upcoming/Past lists hold receptionist bookings.

Colors identify accounts, not appointment status. The legend remains present for selected calendars even in a month without events. Shared calendars selected through two connections are displayed once. The eight-color palette repeats beyond eight accounts; account names remain visible.

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

Migration `0007_square_darwin` adds workspaces, memberships, invitations, transfer requests and per-person notification receipts. Existing receptionists become personal workspaces; new team workspaces start separately. Existing accounts and calendar connections remain in place. Migration `0004` expects Supabase's `auth.users` for legacy account import; the local integration test runner supplies an empty fixture for plain PostgreSQL.

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
| Calendar integrations | Google OAuth + Google Calendar API; Microsoft planned |
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
2. Test remaining calendar privacy/failure cases and add Microsoft calendar support.
3. Accept-test workspaces and browser handoff with teammates; add explicit employee-owned calendar availability sharing.
4. Extend browser department routing to approved telephone destinations, presence/transfer hours and reliable fallback rules.
5. Integrate Mike's phone system and test inbound calls, assisted transfers, no-answer and hang-up behavior.
6. Add Slack transfer approvals after phone transfers work.
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
| GET | `/api/admin/appointments/calendar?timeMin=…&timeMax=…` | Selected Google events and account/calendar sources; at most 45 days |
| POST | `/api/admin/appointments/sync` | Reconcile deleted Google events and refresh bookings |
| DELETE | `/api/admin/appointments/:id` | Cancel booking and remove its Google event |
| DELETE | `/api/admin/appointments/history/:id` | Delete an ended DeskRoute booking and its linked Google event |
| GET | `/api/admin/calendar/list` | Connected Google accounts and available calendars |
| PATCH | `/api/admin/calendar` | Save booking destination and conflict selection |
| DELETE | `/api/admin/calendar/:connectionId` | Disconnect one account |

`/api/workspaces` provides listing, creation, email-bound invitation acceptance and membership management. `/api/transfers` provides a member-scoped inbox and acceptance tokens. See [workspace guide](docs/WORKSPACES_AND_TRANSFERS.md).

Other API modules cover onboarding, settings, calls, questions, knowledge, services, phone provisioning and browser voice sessions. Their routes are defined in `apps/api/src/routes.ts`.

## License and upstream

[AGPL-3.0](LICENSE). Original DeskRoute © 2026 Prabhat Mattoo; [upstream project](https://github.com/PrabhatMattoo/DeskRoute). This repository contains Neodym's modifications; [the corresponding source is available here](https://github.com/alimajidneo/AutoAttendant).
