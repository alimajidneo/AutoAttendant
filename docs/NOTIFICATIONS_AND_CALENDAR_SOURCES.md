# Notifications and calendar sources

Implemented for 1.0.21, 2026-09-10. Current overview: [README](../README.md).

## In-app notifications

The bell in the top bar opens a drawer with an unread count, title, short detail, timestamp and link for each update. Supported records:

- Confirmed receptionist booking → Appointments.
- Requested appointment → Appointments.
- Cancelled appointment → Appointments.
- Unanswered question → Questions.
- Failed call → its call detail page.

Opening an unread notification saves its read state before navigating. Mark all read applies to the displayed versions. Failed reads/writes show an error and leave the user able to retry. Resolved questions and deleted appointment history leave this derived feed; marking a notification read does not resolve a question or alter a booking.

The API returns the latest 50 records in 30 days, ordered by occurrence and stable ID. This is a recent activity feed, not an immutable audit log: the current booking state replaces its previous state. No Google event text is imported into notifications. A calendar event created directly in Google is not a DeskRoute booking notification.

## Cost and privacy

- One aggregate HTTP read on dashboard mount, opening the panel or manual refresh. No recurring timers, polling, Realtime subscriptions, email, SMS, browser push or new service subscriptions.
- Supported local appointment actions invalidate the cached feed; the bell otherwise reflects its last successful fetch. External voice activity is visible on the next refresh/open.
- Existing appointment/question/call rows provide the content. Only `(agent_id, notification_id, seen_through)` is stored in `notification_reads`.
- Every source query and read-receipt join filters by authenticated `agentId`. The API rejects a supplied owner override, invalid IDs/timestamps and batches above 50.
- Read requests must match an existing record and its displayed timestamp. Invented IDs, another owner's records and future timestamps cannot create read receipts. Old browser tabs cannot mark newer events read or move the saved version backwards.
- RLS is enabled with no direct browser policies. The server's PostgreSQL connection enforces owner filtering. No credentials or raw provider errors are returned.
- Read receipts persist across sessions/devices. They contain no copied notification body and cascade when the owner is deleted. They do not have an automatic cleanup job yet; the 30-day feed window is not a claim that source data is deleted after 30 days.
- Current read ownership is the receptionist owner. Before shared workspaces, receipts must become member-specific and permissions must filter notification content.

## Calendar source colors

`GET /admin/appointments/calendar` returns `{ events, sources }`. Each source contains only the selected calendar's ID/name, connection ID, account email and palette index. Token data never enters this response. The account metadata uses the existing owner-scoped connection read; it does not add a Google request.

All calendars from one account share a color, including receptionist bookings. The eight theme-aware colors repeat beyond eight accounts; visible account/calendar text remains the authoritative source indicator. Colors follow connection creation order across date/month navigation; removing an earlier connection may reassign later palette positions.

The legend is below the month grid and lists each selected account and its calendar names, including sources with zero events in the displayed month. Daily event cards also name their calendar and account. Shared calendar IDs selected through multiple connections are read/displayed once under the first selected source. Unselected connections are not included in the legend or event payload.

## Upgrade

Apply committed migration `0006_spooky_rhino` using `pnpm db:migrate`, then restart the API. It adds the RLS-protected read receipt table and an index on appointment owner/update time. It does not rewrite customer accounts, calendar tokens or events. Cancellation now updates the appointment timestamp so read bookings correctly become unread cancellations.

Existing migration `0004` references Supabase Auth. The disposable PostgreSQL test runner supplies an empty `auth.users` fixture for that migration; it is guarded to local `deskroute_test` and never runs against the configured Supabase database.

## Verification

- `pnpm test`: 219 unit/API/voice tests passed.
- `pnpm test:int`: 35 tests across six files passed against disposable local PostgreSQL, including the complete migration chain.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: passed. The build retains the existing large-chunk advisory.
- `pnpm test:web`: 55 passed, five existing design-contract failures remain (approved colors/theme and sign-in width).
- Browser smoke check: live notification drawer loads successfully for the available signed-in account. Populated notification read controls, source legend and light/dark colors were checked with isolated temporary UI fixtures, which were removed afterward. No production auth bypass or sample-data route is included.
- Migration `0006` applied to the configured Supabase database. Read-only verification confirmed RLS enabled and the real owner-scoped feed returned valid counts. No private content was printed; no real notification was marked read or Google event changed.
- Supabase's advisor connector denied permission. RLS and query behavior were checked directly; this is not a full Supabase security-advisor audit.

 Unit/API coverage includes account source metadata with zero events, shared calendar deduplication, source identity without tokens, notification validation and owner context. Database integration coverage includes cross-owner isolation, persistence, duplicate read requests, cancellation version races, forged versions, the 30-day/50-item bounds and RLS.

Manual acceptance:

1. Open the bell; verify real records, then mark one read and reload. It should stay read.
2. Mark all displayed notifications read; a later booking/cancellation should appear unread after opening/refreshing.
3. Check another DeskRoute login: it must not see the first account's notifications.
4. On Appointments, compare both Google accounts' events and the source legend. Navigate to an empty month; sources should remain listed.
5. Check light/dark themes and a narrow viewport. Read the source text without relying on color alone.
6. Create a Google-only event: it should appear in the calendar, not create a booking notification.
