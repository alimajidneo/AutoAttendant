# Retell MVP implementation

Historical report: replay-state and migration-count statements below describe the earlier implementation. The current 0013 durable invocation design and standard-webhook metadata limitations are documented in [CALCOM_INTEGRATION.md](CALCOM_INTEGRATION.md).

Status: local corrective implementation, uncommitted version **1.0.29**. No real provider, call or deployment acceptance is claimed.

## Boundary

DeskRoute owns workspaces, employee routing/hours, calendar policies, normalized calls, bookings and message escalations. Retell owns voice, telephone provisioning, screening, explicit employee acceptance and bridging. Supabase PostgreSQL holds durable state; Vercel runs short requests. Existing LiveKit behavior remains. No dependencies, paid services, worker, polling, cron or reconciliation subsystem were added.

## Independent audit blockers and fixes

The consumed read-only audits examined HEAD `57be475`, 55 changed paths, digest `261746120aede2904f2d121990834ec065930775daa3dc1161b18aed8b3a6a0a`. Their findings were independent of real provider acceptance:

- Arbitrary manager binding: Retell settings now require existing calendar-owner authorization. Activation also requires API key readiness and the exact server-only `RETELL_WORKSPACE_ID`/`RETELL_AGENT_ID` pair. Owners can save a disabled pending ID. Public resolution and ingestion recheck the pair, rejecting stale mappings and another workspace's claim. Settings expose booleans and the saved agent ID, never secrets or the environment workspace UUID. Members issue no settings GET and see Manager access required; non-owner managers receive owner guidance.
- Transfer identity/order: only documented top-level `start_timestamp` identifies an attempt. Missing/invalid timestamps are ignored, with no call-start fallback. Nullable bigint `calls.transfer_attempt_started_at` is in the amended **0011**, with updated snapshot metadata; no 0012. Dedup uses event + call ID + attempt start. Older attempts cannot overwrite newer state; transitions are monotonic (`started` → `bridged`/`cancelled` → `ended`), equal-level terminal alternatives cannot overwrite each other, and a larger timestamp starts the next attempt. Transfer destinations are never stored.
- Blank/untruthful outcomes and missing fallback: bounded exact `deskroute_outcome` analysis values are accepted; unknown shapes leave existing facts intact. Bridged means answered without replacing booked/escalated. Direct confirmed bookings mark booked best-effort without weakening the confirmed response. Signed save-message creates a minimal Retell call and a linked existing escalation, with no transcript excerpt, then marks escalated. Unknown outcomes display Unknown.
- Duplicate write exposure: book-appointment and save-message claim a unique existing receipt before side effects, scoped to workspace, call, function and SHA256(raw body). No receipt payload or response is stored. Replay or crash-after-claim returns unknown/already_processed and never repeats the write. Retell must use `max_retry=0` for both write functions.
- Transfer eligibility: resolve-transfer checks the next five minutes via checkEmployeeAvailability before decryption. Direct authority requires available; Cal.com permits only calcom_authority after routing/manual/full-hours checks. Retell must perform its own Cal.com check immediately beforehand. Resolution does not screen or bridge; explicit acceptance remains pilot configuration.
- Sequential/unbounded calendar work: inspection caps ten distinct assigned connections and fifty references including booking. Connections run with Promise.all; calendar-list and free/busy run concurrently after each credential resolves. Each selected ID and booking writability is verified. Rejection, timeout and incomplete results fail closed as provider_unknown.
- Booking failure lifecycle: shared typed `ProviderWriteRejectedError` is thrown only for clear client rejections (400/401/403/404/405/410/422). Those rejections cancel/release the local reservation. Server errors, 408/409/429 responses, network exceptions, missing IDs and local finalization failures remain requested and block overlapping retries because a provider write may have succeeded. The manager must inspect the selected provider and cancel/release only if no event exists. Both current and past employee appointment cancellation resolve credentials for that employee, preventing another employee's account from being used.
- Hours editor and misleading setup guidance: Employees supports open/closed days and all stored intervals, add/remove, inline validation and edited save payloads. Exceptions remain unchanged; no duplicate holiday or booking-window editor. New employees retain weekday 09:00–17:00 defaults. Calendar owners personally consent; managers configure/assign. Employee dashboard accounts and self-service OAuth are deferred.

## Implemented privacy and authorization

Raw-body HMAC verification occurs before parsing or repository/provider work, with strict signature syntax, constant-time comparison and a five-minute window. Custom functions validate call.agent_id and call.call_id, strict args and bounded intervals. Workspace identity comes only from the approved signed call mapping. Unknown/disabled webhook mappings and unsupported events are ignored. Receipts and normalized event updates use a bounded database transaction; database uniqueness handles duplicate delivery and reservation races.

Retell calls contain masked caller numbers, bounded summary, status, timestamps, duration, cost in cents and normalized outcomes. Raw webhook bodies, transcripts, recording URLs, transfer destinations and tool arguments are not copied into call/receipt storage. Message intake belongs in the existing escalation. Retell-authored summaries are bounded external text, not a general PII-redaction guarantee.

Employees and calendar configuration use explicit actions. Provider calendar metadata is fetched only on Load calendars. Booking rechecks policy and provider state, then reserves atomically before one provider write. Requested/confirmed employee intervals have a partial exclusion constraint. Legacy appointments retain their existing behavior.

## Cost and runtime bounds

Recommend ordinary pilots with **at most five accounts** per employee. Hard bounds are ten connections, fifty selected refs and **at most twenty provider reads per function invocation**: one calendar-list and one free/busy adapter operation per connection, concurrent within and across accounts. Underlying adapters can paginate/fan out HTTP reads; twenty is an operation bound, not twenty HTTP requests or proof of hosted request lifetime. Provider credentials may also require refresh. No recurring polling, cron, Redis, queue, permanent worker or Retell details fetch on dashboard render. No recordings are copied to Supabase Storage.

## Local verification

Focused RED evidence is retained in `/tmp/deskroute-{red,write-red,message-red,hours-red,panel-red,outcome-red}.log`: missing/incorrect binding, transfer identity, parallel reads, final eligibility, rejection classification, message route and UI contracts failed before their fixes. Tests use mocks and disposable local PostgreSQL only. The local database needed the newly amended 0011 column applied because its old migration had already run; fresh-database tests exercise the complete amended migration chain.

Final gate results and browser verification are recorded below after execution. Normal web selection includes the new tests. The five previously known design-token failures were resolved in the final design-contract closure recorded at the end of this document. An initial full unit run also observed the untouched OAuth-state tampering test's intermittent base64-tail failure; the final gate result is reported separately.

## Unverified external acceptance

Ali must supply the intended account/agent and authorize technical configuration before the allowlist can be set. Logins/MFA, terms, voice acceptance, informed calendar-owner consent, privacy/retention policy, provider scopes and any real pilot/spend approval remain external. Employee self-service consent/account flows are deferred. Hosted Vercel/Supabase timing, billing, real Google/Microsoft/Cal.com behavior, telephone provisioning, voice quality, screening/acceptance and actual bridging are unverified. See [Ali's setup checklist](ALI_RETELL_SETUP.md). No live-provider tests, real credentials, provider writes, paid calls, commits, pushes or deployments were used.

### Intermediate local gates before the final booking-fence patch — 2026-09-13

- `pnpm test`: **37 files, 329 tests passed**. The final rerun passed the untouched intermittent OAuth test too.
- `pnpm exec vitest run --project int`: **10 files, 65 tests passed**, disposable local PostgreSQL and mocked providers. Fresh migration-chain tests passed.
- `pnpm -F web exec vitest run src/features/employees src/features/settings/RetellPanel.test.tsx src/features/calls/RetellCallFacts.test.tsx src/features/calls/CallOutcome.test.tsx`: **7 files, 16 tests passed**; included in normal web selection. The full web suite's five known design-token failures remain untouched.
- `pnpm typecheck`, `pnpm lint`, `NODE_ENV=production pnpm build`, `git diff --check`: passed. Build emits its existing large-chunk advisory.
- Full `pnpm -F web test`: **77 passed, 5 failed**. All five failures are the known untouched design-token/SignInPage contract failures; this delivery does not claim the complete web suite is green.
- Independent final TDD review added two counterexamples: same-attempt `bridged` could be overwritten by `cancelled`, and provider HTTP 500 responses could release an ambiguous reservation. Both tests failed first, then passed after monotonic transfer progression and conservative write-status classification. Current and past employee cancellation now both scope credentials to that employee; the legacy two-argument path remains covered.
- Temporary fixture `/tmp/deskroute-phase-b-ui` was rerun independently against the final source at **1280 and 390**. It checks invalid overlapping hours disable save, add/remove intervals, edited hours payload and exception preservation, explicit calendar load/save, pending/approved messages, save-message guidance and nonblank outcomes. Browser requests are mocked; external routing is blocked. Screenshots were inspected: `desktop.png`, `mobile.png`. No console/page errors or horizontal overflow; document visible, button text 15px. DOM inspection confirmed the private transfer field is an empty password input with disc masking; visible digits are only the example placeholder.

All live-provider tests were omitted. Root version remains 1.0.29. Only the existing Phase B 0011 was amended; no 0012, dependency changes, commit, push, deploy, paid action or live-provider acceptance evidence.


### Final reviewer corrective patch — 2026-09-13

The final read-only reviews in `/home/ali/.hermes/cache/delegation/live/deleg_622714a9/task-1.log` and `task-2.log` identified three remaining local blockers: employee mutations could invalidate an availability snapshot or race a provider write; summary-less Retell call links discarded the row's visible facts; and README still described the implemented boundary as pending with an obsolete Phase A anchor.

Reservation now takes a short transaction on the existing workspace row, re-reads the employee and compares the required `expectedEmployeeUpdatedAt` from the availability snapshot before inserting requested. Employee updates/deactivation, policy saves and unassignment use the same workspace lock and throw `EmployeeBookingInProgressError` while that employee has any requested reservation. The API returns 409 with: “A booking write is in progress or ambiguous; check Appointments/provider before retrying.” Mutation timestamps advance by at least one visible millisecond, including rapid successive edits. Unrelated employee edits and extra account assignment remain possible. Provider reads and writes run outside database transactions. Confirmed/cancelled rows do not prevent edits; ambiguous requested rows now require the explicit manager reconciliation action described below; generic cancellation/deletion cannot release them. Existing overlap exclusion and legacy booking behavior remain covered.

`CallsTable.callRowLabel` preserves Retell summary/fallback, caller display, provider/status, transfer, duration, cost and outcome/Unknown without adding raw provider identifiers or reasons; legacy summary/fallback labels remain. README now describes the local boundary and remaining real hosted provider/telephone acceptance, with a valid implementation-document link.

Deterministic PostgreSQL tests use explicit promise barriers around mocked provider reads/writes: a completed mutation prevents a stale reservation, requested writes block mutations, unrelated edits finish while provider I/O is pending, and both cancelled and confirmed finalization release the edit restriction. No live provider is contacted.

Exact rerun evidence for this corrective patch (local mocks/disposable PostgreSQL only):

| Command | RED | GREEN / final rerun |
| --- | --- | --- |
| `pnpm exec vitest run --project unit apps/api/src/modules/employees/route.test.ts packages/core/src/providers/employee-calendar.test.ts` | 2 files failed; 5 failed, 34 passed | 2 files, 39 passed |
| `pnpm exec vitest run --project int packages/core/tests/retell-booking.int.test.ts packages/core/tests/retell.int.test.ts` | 2 files failed; 5 failed, 11 passed | 2 files, 16 passed |
| `pnpm -F web exec vitest run src/features/home/CallsTable.test.tsx` | 1 file failed; 2 failed (after isolating browser-only hooks in the Node test harness) | 1 file, 2 passed |
| `pnpm test` | — | 37 files, 333 passed |
| `pnpm exec vitest run --project int` | — | 10 files, 69 passed, including fresh migration-chain, same-slot exclusion and legacy behavior |
| `pnpm -F web exec vitest run src/features/employees src/features/settings/RetellPanel.test.tsx src/features/calls/RetellCallFacts.test.tsx src/features/calls/CallOutcome.test.tsx src/features/home/CallsTable.test.tsx` | — | 8 files, 18 passed |
| `pnpm typecheck` | — | Passed |
| `pnpm lint` | — | Passed after a narrow, documented React Fast Refresh lint exception for the explicitly requested pure helper export in CallsTable; initial run flagged that export |
| `NODE_ENV=production pnpm build` | — | Passed; existing >500 kB chunk advisory |
| `git diff --check` | — | Passed |

Logs: `/tmp/deskroute-final-red-{unit,int,web}.log`, `/tmp/deskroute-final-green-{unit,int,web}.log`, and `/tmp/deskroute-final-{unit,int,web,typecheck,lint,build,diff-check}.log`. An independent combined-tree rerun then observed **333/333 unit tests**, **69/69 PostgreSQL integration tests**, and **79 passing web tests plus the same five untouched design-token failures**. Typecheck, lint, production build and diff check also passed. No dependencies, version bump, migration 0012, live-provider use, spending, commit, push or deployment occurred in this patch.


### Requested appointment cancellation/deletion race — 2026-09-13

The remaining race was reproduced before production edits. With an explicit promise barrier holding mocked `createProviderCalendarEvent` pending, both `DELETE /appointments/:id` and `DELETE /appointments/history/:id` returned **200 instead of 409**, and the repository cancellation/deletion functions also released/removed the reservation. The regression moves the reservation interval into the past to exercise history deletion without timing sleeps. Provider completion then could not confirm the deleted reservation.

The uncommitted 0011 migration, snapshot and schema now include nullable `appointments.provider_write_state`, constrained to `in_flight` / `reconciliation_required` on employee requested rows. Reservations start in-flight. Transport failures, HTTP 5xx (using the existing conservative provider rejection classifier), blank event IDs and uncertain finalization mark reconciliation required. Definite rejection still cancels automatically. Confirmation/cancellation clears the state. If the database is unavailable even for the uncertainty update, the reservation stays protected in-flight; this does not claim persistence can succeed during a database outage.

Generic cancellation and history deletion reject **all employee requested rows in their SQL predicates**, independently of route checks. Internal rejection finalization cannot cancel a reconciliation-required row. Existing confirmed employee and legacy cancellation/history behavior remains covered.

Managers can use `POST /admin/appointments/:appointmentId/reconcile-not-created` with exactly `{"providerChecked":true}`. The action atomically checks workspace, employee/requested status, absence of a saved event ID and eligible write state before cancelling. Reconciliation-required rows qualify; in-flight rows qualify only when `updated_at` is strictly older than **24 hours**. Neither age nor a generic cancel action releases a reservation automatically. A second action, wrong workspace, fresh in-flight row or already confirmed/cancelled row cannot release it. Stale recovery depends on the manager actually checking the provider; it is not an automated proof of provider absence.

Appointment list responses expose `providerWriteState` and `updatedAt`. Agenda, upcoming and past appointment actions show non-clickable **Booking in progress** for fresh in-flight writes. Reconciliation-required rows show **Review booking** to managers. After the same 24-hour server bound, a stale in-flight row shows **Review stalled booking** instead of remaining API-only. Both paths require the confirmation **I checked the provider calendar and no event exists** before the dedicated request. Members see the state without a reconciliation action. README verification and remaining-work text accurately describe locally implemented employee calendars/booking protection and outstanding live acceptance.

TDD evidence and final gates:

| Command / scope | RED before production edits | GREEN / final |
| --- | --- | --- |
| Focused unit: appointment routes + employee provider | 2 files; **9 failed, 42 passed** | **2 files, 51 passed** |
| Focused PostgreSQL: Retell booking + appointment write-race API | 2 files; **7 failed, 4 passed**, including both DELETE responses and repository bypasses | **2 files, 11 passed** |
| New write-status UI component | Failed collection because the component did not exist; this is scaffolding RED, not a behavioral assertion failure | **1 file, 3 passed** |
| Appointment web tests, including all three page locations | — | **5 files, 23 passed** |
| `pnpm test` | — | **37 files, 343 passed** |
| `pnpm exec vitest run --project int` | — | **11 files, 73 passed**, including fresh migration-chain tests |
| Focused web: appointments, employees, Retell settings/call facts/outcomes and CallsTable | — | **13 files, 42 passed** |
| `pnpm typecheck` | — | Passed |
| `pnpm lint` | — | Passed |
| `NODE_ENV=production pnpm build` | — | Passed; existing large-chunk advisory |
| `git diff --check` | — | Passed |

Logs: `/tmp/deskroute-race-red-{unit,int,web}.log`, `/tmp/deskroute-race-green-{unit,int,web}.log` and `/tmp/deskroute-race-final-{unit,int,web,typecheck,lint,build,diff-check}.log`. The first integration attempt had a Hono dependency-resolution error in the core test location; the API test was relocated under apps/api and rerun to obtain the behavioral RED counts above before production edits. Existing local `deskroute_test` had already applied the old 0011, so only that disposable database received the added column/check directly; fresh-database tests validated the amended full migration chain.

UI verification here uses focused rendered-component/page tests and the explicit confirmation callback; no new browser/live-provider acceptance is claimed. An independent complete web rerun observed **86 passing tests and the same five unrelated design-contract failures**. No live providers, dependencies, version changes, commits, pushes or deployment were used. Existing unrelated working-tree changes were preserved.

### Design-contract closure — 2026-09-14

The complete web suite reproduced the remaining five failures before edits: four semantic-colour failures and one hard-coded `max-w-[430px]` call-site width. The root cause was the later VoiceBridge palette overriding action and destructive semantic aliases, plus green being used for factual booking states. The repair keeps the VoiceBridge surfaces and 430px sign-in presentation while restoring the single action accent, single destructive red and factual ink mappings. The accent was minimally darkened from the reference blue to clear the design contract's 4.5:1 sidebar-ground contrast floor. The sign-in width now uses the named `--container-auth` measure.

- Focused design contract: **39/39 passed**.
- Complete `pnpm -F web test`: **16 files, 91/91 passed**.
- `pnpm typecheck`, `pnpm lint`, `NODE_ENV=production pnpm build`, and `git diff --check`: passed. The build retains its existing >500 kB chunk advisory.
- Browser verification covered the actual sign-in page in light and dark modes. Computed card width/max-width remained **430px**, horizontal overflow was zero, and no page or console errors occurred.
- The temporary Vite server was stopped. No commit, push, deployment, live provider action or spending occurred.

### Supabase migration and calendar recovery — 2026-09-14

The running API initially failed to load existing calendar accounts because it selected the new nullable `calendar_connections.employee_id` column while the configured Supabase database still ended at migration `0009`. A private recovery package was created and checksum-verified before the standard migration runner applied `0010_employee_foundation` and `0011_retell_boundary`.

- Pre-migration data retained: **4 Google calendar connections, 1 appointment, 0 calls**.
- Post-migration verification: **12 migration records**, all required columns/tables present, **4/4 stored credentials decryptable**, and the appointment retained.
- New employee and Retell tables were empty immediately after migration; no customer records were fabricated.
- Ali clicked Retry and confirmed that the calendar-account list loaded.
- Recovery package: `/home/ali/NewProjects/AutoAttendant/backups/deskroute-supabase-pre-0010-0011-20260914T041535Z`; directory mode 700, files mode 600, all recorded checksums verified. Its rollback refuses to run if new employee/Retell-owned data exists, preventing silent loss.
- No commit, push, deployment, real call, calendar write, purchase or spending occurred.
