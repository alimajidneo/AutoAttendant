# Calendar acceptance — first delivery gate

Scope and order: [ROADMAP.md](ROADMAP.md). Last reviewed 2026-09-10.

## Evidence and current limits

- Historical manual evidence: Google sign-in, onboarding, a browser voice call and one real calendar booking worked. This is not proof of two-account scheduling.
- Read-only database check on 2026-09-09: two DeskRoute owners; one has two connected Google accounts and one explicitly selected conflict calendar; the other has no connected accounts. Connecting the second account does not automatically select its calendars for display or availability checks. No calendar event data was read or changed by this check.
- User-reported evidence on 2026-09-10: the two-Google-account test was successful. This confirms the reported basic multi-account workflow; detailed revocation, race and cross-owner tests remain separate. Use one DeskRoute login and connect a second Google account through Connections; do not sign out and create a second DeskRoute user.
- Google event invitations and rescheduling are not implemented. The event-creation payload has no attendee email. Do not promise email invitations or call the appointment lifecycle complete.
- Reconciliation verifies deletion before marking a local appointment cancelled. Moving an event outside its original date window no longer counts as deletion, but its new date is not yet copied into the local appointment.
- Booking does a fresh conflict recheck but is not yet protected against two simultaneous callers racing the event write, or a retry after an uncertain provider write. A reservation/idempotency design and integration tests remain release work.
- Calendar permissions currently include event access for every account. A narrower availability-only connection mode remains privacy work before shared workspaces. Current event-detail view is for the authenticated owner only.
- Caller-number matching now restricts voice cancellation to the current caller's stored number. Caller ID is not strong identity verification; stronger verification for sensitive lookup/cancellation remains a production decision.

## Automated verification on 2026-09-09

- `pnpm test`: 22 files, 211 tests passed (mocked unit/agent coverage).
- `pnpm typecheck`: passed across the workspace packages.
- `pnpm lint`: passed (web ESLint; not a full backend security audit).
- `pnpm build`: passed (web bundle; existing large-chunk warnings remain).
- `pnpm test:web`: 52 passed, 5 failed (including eight passing appointment grouping tests). The five existing design-contract failures concern the approved green status color, theme token overrides and the sign-in card's fixed width. No tests were disabled or weakened. Resolve the stale design contract in its own focused UI pass.
- `git diff --check`: passed.
- Later resolution on 2026-09-14: the five design-contract failures above were fixed without weakening tests; the complete web suite passed **91/91**. See `RETELL_MVP_IMPLEMENTATION.md` for the final focused and browser evidence.
- Browser smoke check: appointments page and direct Manage calendars link render; the link opens the Google calendar drawer. The available in-app browser session has no connected calendars/appointments, so populated UI and second-account event acceptance remain unverified there.
- No real call, calendar write/deletion, history deletion, email, Slack message, database migration or deployment was performed in this batch.

Regression coverage includes browser-bound OAuth/PKCE, invalid state/cookies, credential ownership after cache reuse/disconnection/reconnection, selected-account-only renewal, missing account references, cross-account 11 AM conflicts, failure before final booking, caller cancellation boundaries, changed booking destinations, external deletion verification, moved-event preservation, pagination and sanitized provider errors.

## Start or restart local processes

From `/home/ali/NewProjects/AutoAttendant/deskroute-app`, use three terminals:

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

```bash
pnpm dev:voice
```

If these are already running, restart the API and voice processes after the update. The web development server normally reloads automatically. The browser test can write real appointments; use dedicated test calendars and remove only your test events afterward. Voice inference uses the provider allowance/credits. Offline tests below do not make live calls.

## 1. Connect two Google accounts to one DeskRoute user

1. Sign into DeskRoute with the login you normally use to configure the receptionist.
2. Open **Settings → Connections → Google Calendar → Manage** (or **Connect**).
3. Check the connected-account list. A secondary calendar inside one Gmail account is not a second Google account.
4. In Google Cloud, ensure both Google accounts are in **Google Auth Platform → Audience → Test users** while the app is in Testing.
5. Click **Connect account**, choose the other Gmail/Workspace identity and approve the requested permissions.
6. Finish in the same browser/private-window session that started the connection. Start one authorization at a time; starting a second replaces the first pending browser cookie.
7. Confirm both accounts appear while the DeskRoute login stays the same.
8. Reconnect the same account once; there should still be two rows, not a duplicate third row.

The API must use `PUBLIC_API_URL=http://localhost:8080` in this local setup and the Google client must allow `http://localhost:8080/api/calendar/oauth/callback`. Use `localhost` consistently for both web and API; do not mix `127.0.0.1` and `localhost` for the browser-bound cookie. Production uses a stable HTTPS origin and secure cookies.

## 2. Pick a booking destination and conflict calendars

1. Create a dedicated test calendar in each Google account if needed.
2. Choose the first account's test calendar as the **Booking calendar**.
3. Under **Calendars that block free time**, enable the intended test calendars in both accounts.
4. Save calendar settings. Reload and reopen the panel to verify the saved choices.
5. Note the saved business timezone and use that timezone for all test times below. Choose a future open weekday after minimum notice and before the booking horizon.

Expected: only the chosen destination receives appointments. All selected accounts block time. Selected calendars also supply the calendar grid and daily agenda. Unselected calendars stay excluded.

For a missing event: open **Appointments → Manage calendars**, enable the intended calendar under **Calendars that block free time**, and click **Save calendar settings**. Reopen to confirm it stayed selected, return to Appointments, choose the event's date and click **Refresh calendar**. The connected-account list reports the saved number of calendars included per account. A Google calendar event appears in the grid/day agenda; the Upcoming/Past appointment lists contain receptionist booking records.

Multi-day events display on every occupied day (all-day end dates remain exclusive); events with the same event ID on different calendars no longer collide. Shared calendars selected through two accounts are read only once.

## 3. Verify a busy 11 AM and a free 11 AM

1. In the second account's selected test calendar, create a **Busy** event from 11:00 AM to noon on the chosen weekday.
2. Give it a distinct test title; do not use real personal details.
3. Start a DeskRoute browser call and ask for a general appointment on that date at 11 AM.
4. Confirm 11 AM is not offered and an alternative is offered. The agent must not speak the event title, its attendees, account email or reason for being busy.
5. End the call. Remove that test event, or mark it **Free** in Google Calendar.
6. Start another call and request 11 AM again. Confirm it is offered if the other selected calendars and booking rules permit it.
7. Confirm the booking. Check that exactly one Google event is created in the chosen destination and one matching appointment appears in DeskRoute.
8. Confirm nothing was created in the conflict-only calendar.

Also test a busy event in the first account, a recurring occurrence and an all-day busy event. Check the appointment duration and buffers, not only its start minute. Google returns expanded busy intervals; the voice model should receive only offered times.

## 4. Cancellation, changed destination and external deletion

1. Create a test booking and cancel it from DeskRoute. Confirm the event disappears from its original Google calendar.
2. Book another appointment, change the selected booking destination, then cancel the older appointment. It must still target the original account/calendar.
3. Book another test appointment and delete the event in Google. Use DeskRoute's explicit calendar refresh; confirm the local status becomes cancelled.
4. Move a test event several weeks in Google, then refresh DeskRoute. It must not be falsely cancelled. Local reschedule synchronization remains pending as stated above.
5. If a Google read/deletion fails, DeskRoute must report failure and preserve the local confirmed status instead of claiming success.

## 5. Past appointments

1. Leave an appointment open through its end time. It remains Upcoming while in progress, then moves to Past appointments within 30 seconds. Returning to the tab also updates it. This clock runs locally; it does not poll the API or Google.
2. Verify an appointment that ended yesterday appears in Past appointments, newest ended first, including cancelled history. “Ended” means the scheduled end passed, not proof the caller attended.
3. Click Delete on a disposable past appointment. The confirmation explains that deletion removes the DeskRoute booking row permanently and its linked Google event. Cancel the dialog to preserve the record; confirm only when intentionally testing deletion.
4. Reload after confirming deletion. The booking must stay removed from DeskRoute history. Its linked Google event must disappear from the calendar grid. If Google rejects deletion or the original account is disconnected, the local row must remain and show a retry/reconnect error.
5. A future/ongoing booking cannot be deleted through the history endpoint. Owner and end-time checks are enforced in both the API and database deletion condition.

The existing appointment list returns at most 100 records ordered by start time. Browsing older pages is still pending; deleting visible history does not constitute full account-data erasure (call records remain separate).

## 6. Privacy and failed connections

1. With both accounts selected, revoke access to the second test account in Google. Use a fresh call and wait for cached Google access to be rejected/expire if revocation is not immediate.
2. The receptionist must stop offering verified availability when the selected calendar cannot be checked. It can offer a message/request fallback, never claim a confirmed booking.
3. Reconnect and verify both selected accounts again.
4. Distinguish revocation from clicking **Disconnect** in DeskRoute: Disconnect explicitly removes those calendars from the selection, as the confirmation dialog explains. Existing Google events remain. Local disconnection does not revoke all Google grants, which might be used by other connections.
5. Sign out and into the other DeskRoute login. It must not show the first user's connections, appointment details or cached dashboard records.
6. Check that opening an OAuth link in a different browser cannot attach that browser's Google calendar to the initiating user's DeskRoute account.

## Offline regression commands

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:web
```

`pnpm test` runs mocked unit/agent tests. It is not provider or browser acceptance. `pnpm test:int` and `pnpm test:live` are separate suites; do not run them as a shortcut. The existing live suite creates Google events and does not prove multi-account acceptance.

Record each manual result as pass/fail, the step number and the visible error. Do not paste passwords, tokens, private event titles or personal calendar screenshots into the test log.

## 7. Microsoft and mixed-provider acceptance

1. Follow [Microsoft setup](SETUP.md#8-connect-microsoft-outlook-and-microsoft-365) using the multi-tenant plus personal-account registration option.
2. Connect one personal Outlook.com account. Verify listing, a busy event, one booking into Outlook, DeskRoute cancellation, and external-delete reconciliation.
3. Connect one work/school Microsoft 365 account. Record whether user consent succeeds or its administrator requires approval; do not broaden permissions to bypass policy.
4. Select one Google calendar and one Microsoft calendar for conflicts. A busy event from either provider must block its exact time without exposing the event title to the voice model.
5. Repeat for a secondary calendar, recurring occurrence, all-day busy event, daylight-saving transition, revoked Microsoft grant, and a moved event.
6. Confirm a Microsoft booking retains its original provider/account/calendar identifiers after the selected booking destination changes.

Automated integration-batch evidence on 2026-09-10: 255 unit/API/voice tests and 44 disposable PostgreSQL integration tests passed; all migrations through `0008_curved_nebula` applied locally. Typecheck, lint, and production build passed. Migration `0008_curved_nebula` also applied successfully to the configured Supabase development database. These checks used mocked Microsoft/Slack responses and do not count as live provider acceptance.


## 2026-09-10: past booking deletion and source labels (1.0.24)

- Added Delete to the daily agenda for an ended DeskRoute booking, including manager-visible bookings without an external event ID. Past appointments retains the same confirmation/action.
- After successful server deletion, cancel pending appointment/calendar reads and remove the event from all cached months using calendar plus event identity. Mark those queries stale for the next visit; an old pending response cannot restore the removed item. Preserve events with the same ID in another calendar. Block overlapping manual refresh and deletion from the page controls.
- Preserve the server's reconnect guidance for conflict errors. Calendar-only events with no DeskRoute booking are not given a destructive appointment action.
- Show the account email once when the primary calendar's name is the same email. Keep distinct secondary calendar names and account colors.
- Six new web regressions pass. Overall: 242 unit/API/voice tests pass; web tests are 61 passing and the same five pre-existing design-contract failures. Typecheck, lint and production build pass, with the existing large-bundle warning.
- Isolated browser verification used the real AppointmentsPage with a temporary in-memory API adapter: Delete confirmation removed the month-grid chip, daily agenda entry and past row; cancelling confirmation preserved the booking. Desktop/light and 390px/dark layouts checked. Temporary verification files removed. No real Google events were deleted during these checks; the user's specific live-calendar issue still needs acceptance in their signed-in session.
- Loading geometry verified in the browser: full-page center at (640, 360) in a 1280×720 viewport; content-area center at y=392 below a 64px header. Sign-in completion uses the same centered component.
