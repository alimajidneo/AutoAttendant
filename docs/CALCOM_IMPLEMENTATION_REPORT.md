# Cal.com implementation report — 2026-09-14

Historical implementation record below, superseded by [the audit repair report](CALCOM_REPAIR_REPORT.md) and [current production contract](CALCOM_INTEGRATION.md). Earlier test counts and database restrictions describe that earlier task only; the repair explicitly authorizes localhost:5433 PostgreSQL validation.

## Scope and limits

Implemented in the existing dirty checkout. No pre-existing files were reset, reverted or replaced wholesale; existing edits and untracked work were preserved. No commit, push, deployment, live account access, provider request, secret-file read, or database migration application was performed. All executed provider/API tests use mocks. PostgreSQL tests were added but not executed: the task permits source/tests/docs/migration files only and prohibits applying migrations to Postgres/Supabase.

The production path is employee-specific API-key connection, authenticated discovery, explicit slot checks, one reserved booking attempt, signed/deduplicated webhook receipts, cancellation, and authenticated reconciliation. OAuth setup, remote event-type/webhook management and rescheduling are not exposed. The configured webhook secret is server-only; manual remote webhook setup awaits a public HTTPS endpoint and explicit authorization. Ordinary fixed-duration personal event types are the supported operational assumption; custom required fields/payment/approval/seated/recurring workflows fail closed or remain unresolved rather than inventing data.

## Genuine RED observations

All commands ran from the repository root unless `pnpm -F web` specifies the web workspace.

1. `pnpm exec vitest run --project unit packages/core/src/providers/calcom.test.ts`
   - Initial exit 1: suite could not import missing `./calcom.js`; zero assertions ran. This was an implementation-absence RED, not a claim of behavioral assertion failures.
2. `pnpm exec vitest run --project unit packages/core/src/providers/calcom-employee.test.ts`
   - Before wiring Cal into employee booking: exit 1, **7 failed / 1 passed**. The existing implementation returned `calcom_authority` / `use_calcom`, never checked live slots, and never reserved/wrote/reconciled.
   - Explicit confirmation regression: exit 1, **1 failed / 8 passed**; actual `confirmed` when `callerConfirmed: false`, expected `confirmation_required`.
   - Missing contact with failed provider read: exit 1, **1 failed / 9 passed**; actual `unknown`, expected `contact_required` before any slot request.
3. `pnpm exec vitest run --project unit apps/api/src/modules/calcom/route.test.ts`
   - Initial exit 1: missing `./route.js`, zero assertions ran.
4. `pnpm -F web exec vitest run src/features/employees/CalcomConnection.test.tsx`
   - Initial exit 1: missing `CalcomConnection`, zero assertions ran.
5. `pnpm -F web exec vitest run src/features/appointments/AppointmentWriteStatus.test.tsx`
   - Exit 1, **1 failed / 4 passed**: missing “Check Cal.com booking” control.
6. Provider reconnect test initially failed because the unauthorized callback was not implemented.

Intermediate test-harness failures were fixed separately: the API env mock omitted Supabase's dummy test configuration, the UI test needed its API client mocked in the server-render environment, and one cancellation mock reused a consumed Response object. These were not product behavior RED claims.

Postgres tests have no executed RED/GREEN claim because execution is outside the authorized scope. Additional regression tests were added alongside the implementation; the focused behavioral RED cycles above are the recorded TDD evidence.

## GREEN commands and results

```sh
pnpm exec vitest run --project unit packages/core/src/providers/calcom.test.ts packages/core/src/providers/calcom-employee.test.ts packages/core/src/providers/calcom-appointments.test.ts packages/core/src/repositories/calcom.test.ts packages/core/src/providers/employee-calendar.test.ts packages/core/src/providers/token-encryption.test.ts apps/api/src/modules/calcom/route.test.ts apps/api/src/modules/appointments/route.test.ts apps/api/src/modules/retell/route.test.ts apps/api/src/modules/employees
```

Exit 0: **10 files, 130 tests passed**. Covers Cal provider contracts, sanitized errors and connection views, exact raw signatures, API ownership/manager guards, discovery selection, contact/confirmation, write ambiguity, original direct-calendar behavior, legacy links, encryption utility, and cancellation identity checks.

```sh
pnpm -F web exec vitest run src/features/employees src/features/appointments/AppointmentWriteStatus.test.tsx src/features/appointments/AppointmentsPage.test.tsx
```

Exit 0: **7 files, 20 tests passed**. Includes the employee connection/password form, employee panel regression, reconciliation control, and appointments page.

```sh
pnpm typecheck
pnpm lint
git diff --check
DATABASE_URL=postgresql://unused:unused@localhost:5433/unused pnpm -F @receptionist/core exec drizzle-kit check
DATABASE_URL=postgresql://unused:unused@localhost:5433/unused pnpm -F @receptionist/core exec drizzle-kit generate --name calcom_consistency_check
```

Typecheck and lint exit 0. Whitespace check clean. Drizzle check reports consistent metadata; generation reports **“No schema changes, nothing to migrate”**. No dotenv loader, migration execution or database connection is involved in those Drizzle checks. Migration 0012 was originally generated with the same dummy URL and `drizzle-kit generate --name calcom_integration`.

## Exact files changed by this task

Files already present (some were already dirty/untracked) were edited in place:

- `README.md`
- `apps/api/.env.example`
- `apps/api/src/modules/appointments/route.ts`
- `apps/api/src/modules/retell/route.ts`
- `apps/api/src/modules/retell/route.test.ts`
- `apps/api/src/routes.ts`
- `apps/web/src/features/appointments/AppointmentsPage.tsx`
- `apps/web/src/features/appointments/AppointmentWriteStatus.tsx`
- `apps/web/src/features/appointments/AppointmentWriteStatus.test.tsx`
- `apps/web/src/features/employees/EmployeesPanel.tsx`
- `docs/ALI_RETELL_SETUP.md`
- `packages/core/drizzle/meta/_journal.json`
- `packages/core/src/db/schema.ts`
- `packages/core/src/env.ts`
- `packages/core/src/providers/employee-calendar.ts`
- `packages/core/tests/migrations.int.test.ts`
- `packages/shared/src/employees.ts`

New files created by this task:

- `apps/api/src/modules/calcom/route.ts`
- `apps/api/src/modules/calcom/route.test.ts`
- `apps/web/src/features/employees/CalcomConnection.tsx`
- `apps/web/src/features/employees/CalcomConnection.test.tsx`
- `docs/CALCOM_INTEGRATION.md`
- `docs/CALCOM_IMPLEMENTATION_REPORT.md`
- `packages/core/drizzle/0012_calcom_integration.sql`
- `packages/core/drizzle/meta/0012_snapshot.json`
- `packages/core/src/providers/calcom.ts`
- `packages/core/src/providers/calcom.test.ts`
- `packages/core/src/providers/calcom-employee.test.ts`
- `packages/core/src/providers/calcom-appointments.ts`
- `packages/core/src/providers/calcom-appointments.test.ts`
- `packages/core/src/repositories/calcom.ts`
- `packages/core/src/repositories/calcom.test.ts`
- `packages/core/tests/calcom.int.test.ts`

Other entries in `git status` predated this work. In particular, the pre-existing appointments route tests, employee repository, generic calendar providers/repositories, earlier migrations, styling and unrelated pages were not rewritten by this task.

## Remaining acceptance work

- Run the added Postgres tests and full migration-chain tests against a separately authorized prepared local database. They cover durable receipts, tenant isolation, encryption, unique employee/provider identity assignment, local cleanup, concurrent reservation exclusion, credential refresh during unresolved writes and reconciliation metadata validation.
- Apply migration 0012 only through the normal reviewed deployment process, outside this task.
- Obtain account-owner consent, supply server secrets securely, manually configure a public HTTPS webhook, and perform an explicitly authorized live acceptance test. No live integration is claimed.
- Retell's remote tool configuration must retain `max_retry=0` and include the documented contact/confirmation inputs. No Retell account/configuration was accessed here.
