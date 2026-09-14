# Cal.com audit repair — 2026-09-14

Historical report: replay-state and migration-count statements below describe the earlier implementation. The current 0013 durable invocation design and standard-webhook metadata limitations are documented in [CALCOM_INTEGRATION.md](CALCOM_INTEGRATION.md).

Repaired in the existing dirty checkout. No commit, push, deployment, live provider/account request, production/Supabase database access, or production migration. PostgreSQL work was confined to localhost:5433, including the test database and migration-test scratch databases. One local test schema reset allowed the regenerated 0012 to be exercised from an empty schema. No production recovery procedure was executed.

The starting checkout was fingerprinted before edits in `/tmp/deskroute-calcom-repair/baseline.json`. Files below are changes relative to that dirty starting state, not relative to HEAD. No starting file was deleted. Migration 0011, its snapshot, journal entries 0000–0011, the existing migration tests, and unrelated application changes were preserved. The parent's exact webhook-version and Cal.com RLS tests remain present and pass.

## Contract and evidence

Read the supplied `task-0.log`, `task-1.log`, and `task-2.log` audit transcripts under `/home/ali/.hermes/cache/delegation/live/deleg_167aedac`. Those logs themselves abbreviate some audit/tool output; the implementation and local regressions supplied the concrete checks.

Official source inspected at `/tmp/calcom-source`, commit `b0a34f21c91ae7803f9b7e2c59c2fbd187cce26f`, particularly the 2024-06-14 event-type output DTO, output service, booking-field and location outputs, seats/recurrence/confirmation/location transformers, and 2024-08-13 booking inputs/services. No remote source checkout or provider call was required.

- Event discovery exposes bounded scheduling facts and filters incompatible event types; selection rediscovers them and booking revalidates compatibility. Required default name/email/phone fields are checked against supplied contact. Unknown/nonempty app configuration is conservatively excluded; raw provider metadata is not archived.
- Both environment parsing and client construction enforce exactly `https://api.cal.com/v2`, optionally with one trailing slash. Redirects remain prohibited.
- Credential connect/list/refresh/select/disconnect require the workspace owner. Signed external webhooks remain public. Actual streamed webhook bytes are capped at 262144; the exact version and HMAC-before-JSON behavior remain intact.
- Webhook SQL matches connection, employee, tenant/appointment metadata, event type, interval, requested status and null/identical UID. It cannot replace established UIDs or confirm/cancel/move rows from unordered notifications.
- Provider finalization compares the requested/in_flight reservation, full identity/state snapshot and PostgreSQL `xmin` version. Lost races return unknown and attempt authenticated reconciliation. Automatic reconciliation prefers the stored UID; an explicit manager UID can repair stale identity on unresolved rows after authenticated validation. Reconciliation SQL also compares full identity/state and `xmin`.
- Retell booking claims hash normalized semantic fields, not raw request bytes. Equivalent JSON formatting/key order, UUID case, contact/confirmation aliases and insignificant name/purpose whitespace share a durable claim. Conflicting aliases fail before claiming. A real PostgreSQL/API test proves only one mocked provider write, including replay after local cancellation.
- 0012 was regenerated from unchanged 0011, retaining RLS and adding connection/time and time indexes. The schema permits only `auth_kind=api_key`; no 0013 exists. Ingestion and an authenticated daily cleanup job delete receipts older than fourteen days. `vercel.json` contains the daily schedule; deployment and configuring `CRON_SECRET` remain separate operational work. Retention is approximately 14–15 days when the scheduler is healthy.
- Route tests cover reconciliation 200/409, provider-first cancellation and failure preservation, and mixed-provider sync completing all reads before any local mutation. UI tests invoke submit/click/change handlers with controlled React state in the existing Node test setup, covering success/failure and disabled/busy/error states. They are not browser/DOM end-to-end tests.

## Recorded RED runs and intermediate failures

Logs are retained in `/tmp/deskroute-calcom-repair`.

| Log | Observed result before the corresponding fix |
| --- | --- |
| `red-unit.log` | 28 failed / 45 passed: event compatibility, API base, owner authorization, body bounds and semantic claims |
| `red-int.log` | 8 failed / 80 passed: webhook identity/interval/UID, late success, stale-UID repair and retention |
| `red-schema.log` | 1 schema/index assertion failure plus 1 invalid test-fixture state failure; 20 passed. The fixture failure was not a product RED. |
| `red-maintenance.log` | 1 failed / 12 passed: missing maintenance route (implementation-absence RED) |
| `red-ui.log` | 1 failed / 4 passed: busy event selector was not disabled |
| `red-revalidate.log` | 2 failed / 11 passed: event compatibility/contact revalidation before reservation |
| `red-revision.log` | 1 failed / 22 passed: concurrent update preserving visible values escaped timestamp-only CAS |
| `red-canonical.log` | 1 failed / 20 passed: UUID case/name/purpose whitespace changed the claim hash |
| `red-payment-app.log` | 1 failed / 42 passed: app-configured requirements bypassed the legacy price check |
| `red-bounds.log` | 2 failed / 43 passed: oversized booking URL and inconsistent default field type |

Additional route, environment, out-of-order webhook, scheduler, and end-to-end PostgreSQL coverage was added around these fixes; not every coverage-only assertion is claimed to have produced RED.

Intermediate integration/unit gates also caught a missing `sql` import, an outdated three-argument mock assertion, and three old expectations that confirmed a reservation after its state/interval changed. The import/assertion were corrected, and the old expectations now require unknown/reconciliation while retaining their protection checks. A later integration run had 1 failure / 103 passes because a test reused a consumed mocked Response; fresh responses fixed that fixture. No final gate failure is suppressed.

## Final gates

All commands run from the repository root. Full raw outputs and exit files are in `/tmp/deskroute-calcom-repair`; links below point to those local artifacts.

| Command | Exit | Result / raw output |
| --- | --- | --- |
| `Focused provider/API/env regressions (exact command below)` | 0 | 9 files, 164 tests passed. [Full output](/tmp/deskroute-calcom-repair/focused.log) |
| `pnpm test` | 0 | 43 files, 441 tests passed. [Full output](/tmp/deskroute-calcom-repair/test.log) |
| `pnpm test:int` | 0 | 13 files, 104 tests passed; localhost:5433 only. [Full output](/tmp/deskroute-calcom-repair/test-int.log) |
| `pnpm test:web` | 0 | 17 files, 97 tests passed. [Full output](/tmp/deskroute-calcom-repair/test-web.log) |
| `pnpm typecheck` | 0 | Passed. [Full output](/tmp/deskroute-calcom-repair/typecheck.log) |
| `pnpm lint` | 0 | Passed. [Full output](/tmp/deskroute-calcom-repair/lint.log) |
| `pnpm build` | 0 | Passed; existing >500 kB chunk advisory. [Full output](/tmp/deskroute-calcom-repair/build.log) |
| `Drizzle generate with dummy unreachable URL` | 0 | No schema changes, nothing to migrate. [Full output](/tmp/deskroute-calcom-repair/drizzle-generate.log) |
| `Drizzle check with dummy unreachable URL` | 0 | Everything’s fine. [Full output](/tmp/deskroute-calcom-repair/drizzle-check.log) |
| `git diff --check` | 0 | No output. [Full output](/tmp/deskroute-calcom-repair/diff-check.log) |
| `Local secret pattern scan` | 0 | No findings; high-confidence token/private-key patterns, not an external scanner. [Full output](/tmp/deskroute-calcom-repair/secret-scan.log) |

```sh
pnpm exec vitest run --project unit packages/core/src/providers/calcom.test.ts packages/core/src/providers/calcom-employee.test.ts packages/core/src/providers/calcom-appointments.test.ts packages/core/src/repositories/calcom.test.ts packages/core/src/providers/employee-calendar.test.ts packages/core/src/env.test.ts apps/api/src/modules/calcom/route.test.ts apps/api/src/modules/appointments/route.test.ts apps/api/src/modules/retell/route.test.ts
DATABASE_URL=postgresql://unused:unused@localhost:1/unreachable pnpm -F @receptionist/core exec drizzle-kit generate --name calcom_consistency_check
DATABASE_URL=postgresql://unused:unused@localhost:1/unreachable pnpm -F @receptionist/core exec drizzle-kit check
python3 /tmp/deskroute-calcom-repair/secret_scan.py
```

No dotenv loader, database connection or migration application is involved in the Drizzle consistency commands. The local test migration command is the explicit localhost:5433 command printed by `pnpm test:int`.

## Exact changed files

- `apps/api/.env.example`
- `apps/api/src/modules/appointments/route.test.ts`
- `apps/api/src/modules/appointments/write-race.int.test.ts`
- `apps/api/src/modules/calcom/booking-races.int.test.ts`
- `apps/api/src/modules/calcom/route.test.ts`
- `apps/api/src/modules/calcom/route.ts`
- `apps/api/src/modules/retell/route.test.ts`
- `apps/api/src/modules/retell/route.ts`
- `apps/api/src/routes.ts`
- `apps/web/src/features/employees/CalcomConnection.test.tsx`
- `apps/web/src/features/employees/CalcomConnection.tsx`
- `docs/CALCOM_IMPLEMENTATION_REPORT.md`
- `docs/CALCOM_INTEGRATION.md`
- `docs/CALCOM_REPAIR_REPORT.md`
- `packages/core/drizzle/0012_calcom_integration.sql`
- `packages/core/drizzle/meta/0012_snapshot.json`
- `packages/core/drizzle/meta/_journal.json`
- `packages/core/src/db/schema.ts`
- `packages/core/src/env.test.ts`
- `packages/core/src/env.ts`
- `packages/core/src/providers/calcom-employee.test.ts`
- `packages/core/src/providers/calcom.test.ts`
- `packages/core/src/providers/calcom.ts`
- `packages/core/src/providers/employee-calendar.test.ts`
- `packages/core/src/providers/employee-calendar.ts`
- `packages/core/src/repositories/appointments.ts`
- `packages/core/src/repositories/calcom.ts`
- `packages/core/tests/calcom.int.test.ts`
- `packages/core/tests/retell-booking.int.test.ts`
- `vercel.json`

See [the production contract](CALCOM_INTEGRATION.md) for setup, supported event types, scheduler requirements and recovery boundaries. Production migration, account consent/configuration, deployment and live acceptance remain unperformed.
