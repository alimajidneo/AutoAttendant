# Slack and Microsoft integration plan

Updated 2026-09-10. These integrations are planned, not implemented. Keep Supabase Auth for DeskRoute identity; connect external accounts separately with explicit workspace authorization. The intended customer size is 10–25 users. Add one working path at a time.

## Microsoft: calendars first

1. Connect personal Outlook and work/school Microsoft 365 accounts through delegated Microsoft OAuth. Support more than one account under a DeskRoute login. Validate organizational consent restrictions during the pilot.
2. List each account's calendars, let the owner select conflict calendars and one booking destination, and retain the provider/account/calendar/event identifiers with each booking.
3. Combine selected Google and Microsoft busy intervals. For personal and work accounts, use per-calendar `calendarView`, including pagination, recurring occurrences, exceptions and timezone boundaries. Request only fields needed for availability. Missing access or incomplete results must block booking rather than imply free time.
4. Create, cancel and reschedule against the original booking provider. Read access and booking write access have different needs; review minimum delegated scopes for each operation. Keep refresh credentials encrypted on the server and scoped to the authorized owner/workspace.
5. Test two Microsoft identities, Google plus Microsoft conflicts, secondary calendars, all-day events, recurrence, DST, revoked access and simultaneous booking. Do not label Microsoft support complete after OAuth alone.

Microsoft supports delegated calendar listing and calendar views for both personal and organizational accounts. Its `getSchedule` free/busy endpoint does **not** support delegated personal Microsoft accounts, so it cannot be the only availability path. Calendar creation needs delegated `Calendars.ReadWrite` access. Sources: [list calendars](https://learn.microsoft.com/en-us/graph/api/user-list-calendars?view=graph-rest-1.0), [calendarView](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0), [getSchedule](https://learn.microsoft.com/en-us/graph/api/calendar-getschedule?view=graph-rest-1.0), [create event](https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0).

## Teams: add only useful capabilities

- Optionally attach a Teams meeting link to a calendar booking when the connected account/calendar supports that meeting provider. Check allowed providers and applicable account licensing. [Calendar-backed online meetings](https://learn.microsoft.com/en-us/graph/outlook-calendar-online-meetings).
- Later, use opt-in Teams presence as a routing hint for organizational accounts. Own-user delegated presence starts with `Presence.Read`; reading others requires broader access. Personal Microsoft accounts are unsupported. “Available” is not proof that someone can take a call on all their phone lines and is not transfer consent. [Presence permissions](https://learn.microsoft.com/en-us/graph/api/presence-get?view=graph-rest-1.0).
- If a pilot actually uses Teams, add targeted call-approval messages after calendar and browser handoff acceptance. App installation and tenant policy must be checked before promising access. Teams is not the carrier connection for the business's existing telephone number.

Avoid Teams Phone integration, calling bots and tenant-wide application permissions in the first calendar release.

## Slack: useful first features

1. **Selected-channel alerts:** bookings, cancellations, unanswered questions and call failures. Let the workspace owner choose the destination and explicitly enable each alert type. Include minimal context plus a link to the authenticated DeskRoute record.
2. **Recipient approval:** send a request to the intended teammate with Accept/Decline actions. Initially, acceptance should open the existing DeskRoute browser handoff. A Slack button alone does not connect audio.
3. **Optional commands:** a small command to open today's work or set manual routing availability, if teammates need it. Avoid importing message history or building a general Slack assistant for this use case.

Use a narrowly scoped Slack app and selected conversations. Slack supports sending messages and interactive buttons; interactive requests need an acknowledgment within three seconds. Sources: [chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/), [interactive actions](https://docs.slack.dev/interactivity/handling-user-interaction/), [slash commands](https://docs.slack.dev/interactivity/implementing-slash-commands/).

For privacy, do not post personal calendar event titles or full call transcripts by default. Recheck the Slack installation, DeskRoute workspace membership, intended recipient, call status and expiration when an action arrives. Verify Slack's raw-body signature and timestamp before trusting a request; handle duplicate deliveries and acceptance idempotently. Source: [Slack request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/).

## Cost, deployment and reliability

- Keep the tutorial static and lazy-loaded; it adds no application API requests. Existing app bootstrap/auth may still run.
- Trigger integration work from business events or explicit user actions. Do not continuously poll every user's Slack or Teams presence.
- Use the existing HTTP API for signed callbacks, with bounded processing. If work must continue after acknowledgment, persist it for a reliable worker; do not depend on an in-memory task surviving a Vercel response.
- Keep the persistent LiveKit voice worker separate from Vercel request functions. Stable hosted callback URLs and explicit owner configuration are prerequisites for a team pilot.
- Use customers' existing Slack/Microsoft accounts where suitable. Verify their plan, tenant restrictions and provider usage before quoting a price; browser voice testing still consumes provider resources.
- Connect and message real accounts only during an explicitly authorized integration setup/test.

## Next delivery order

1. Accept a real two-person browser handoff; test decline, expiration, removed membership and workspace isolation.
2. Prepare stable Vercel staging for web/API and a separately hosted voice worker so teammates can test without the developer's computer. Measure invocations and costs.
3. Complete appointment lifecycle gaps and Microsoft connections, then mixed-provider calendar acceptance.
4. Add explicitly shared employee availability and booking destinations without exposing personal event details; prevent booking races across workspaces.
5. Gather Mike's SIP, transfer, presence and number-routing documentation; run a controlled inbound phone pilot before moving the business's main number.
6. Add Slack alerts and call approval, or Teams equivalents if that is the pilot team's actual communication tool.
7. Finish production OAuth approval, privacy/retention/deletion, backup restoration, operator instructions and booking/transfer/fallback acceptance before customer handover.

## In-app tutorial

`/help` is a public tutorial with searchable, linkable guides covering onboarding, workspaces, hours, agent knowledge/intake, Google calendars, appointments, notifications, browser tests and browser handoff. It contains generic instructions only. Access it from sign-in, onboarding, Workspaces or the dashboard's **Help & tutorial** link. Operator credentials and deployment instructions remain in [SETUP.md](SETUP.md).

Validation for tutorial release 1.0.23: typecheck, lint and production build pass. Browser checks cover public access, topic search and no-results feedback, shareable guide URLs, previous/next focus and scrolling, troubleshooting expansion, light/dark themes and a 390px mobile viewport without horizontal overflow. Web checks remain 55 passing / 5 existing design-contract failures (palette/status expectations and the existing sign-in pixel width). The existing large-bundle build warning remains. No live voice calls, calendar writes or external messages were used for this tutorial validation.
