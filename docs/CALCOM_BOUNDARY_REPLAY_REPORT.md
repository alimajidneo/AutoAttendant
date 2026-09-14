# Cal.com boundary and Retell replay repair — 2026-09-14

Work was performed in the existing dirty repository. Unrelated/pre-existing edits were retained. No reset, restore, stash, stage, commit, push, deployment, ignored secret-file read, remote database access or Cal.com/Retell contact was performed. PostgreSQL execution used only the existing `pnpm test:int` entry point and its local scratch databases. Provider calls in tests were mocked.

## Delivered behavior

- Exact 0000–0011 scratch migration, nine representative seeded tables, identifier/value/count preservation across only 0012, ledger boundaries, tenant/employee FKs, uniqueness/check constraints, indexes, populated-table RLS SELECT/INSERT denial and repeat migration checks.
- Owner-only Cal.com query and controls using `session.workspaceOwner`, including cached-data denial; manager employee management remains covered.
- Additive 0013 invocation ledger with processing/completed/uncertain states, stable tool IDs or semantic-hash fallback, bounded normalized result persistence and original-result replay. Reservation/link/network checkpoint are atomic; uncertain writes never retry. Messages atomically commit claim, escalation, call outcome and result.
- Unicode NFC before semantic argument validation/hash, including composed/decomposed booking replay after cancellation. Legacy claim-only receipts conservatively block execution even when old/new hashes differ.
- Local operator secret derivation CLI, executable tests and package entry. It emits only the derived connection secret, never the root; uses the existing HMAC separation.
- Correct standard-webhook metadata limitations, a 256 KiB pre-signature Retell body limit, explicit instant-event exclusion, and a complete production preflight/apply-only-0012/recovery runbook. Its local generator and generated SQL are exercised against scratch PostgreSQL, including invalid-ledger rejection. No production command in the runbook was executed.

Migrations 0000–0011 and the established 0012 SQL/snapshot were not edited. 0013 SQL, snapshot, journal and schema match.

## RED → GREEN evidence

Commands below are from the repository root. A RED means the test was run before its corresponding implementation. Supplemental assertions covering behavior already present are not described as new failing behavior.

| Exact command | Observed RED | Focused GREEN |
|---|---|---|
| `pnpm test:web CalcomConnection.test.tsx` | Non-owner manager made `/admin/calcom` GET. Initial mock also surfaced rejected promises; the query mock was corrected to consume them. | See combined UI command below. |
| `pnpm test:web CalcomConnection.test.tsx EmployeesPanel.test.tsx` | — | 10 passed. |
| `pnpm test:int packages/core/tests/migrations.int.test.ts` | At seeded 0011, expected Cal.com tables were absent before adding the apply-only-0012 step. Later the runbook regression caught invalid generator quoting. | 3 passed, including runbook rehearsal and changed/missing ledger rejection. |
| `DATABASE_URL=postgresql://deskroute:***@localhost:5433/deskroute_test pnpm exec vitest run --project int packages/core/tests/retell-invocations.int.test.ts` | Missing durable executor/table; later stale processing failed to become uncertain, legacy receipt replay executed, concurrent message transactions exhausted the pool, and a later `save-message` downgraded an already booked call to escalated. | Final focused run: 10 passed after preserving booked precedence in the same transaction. |
| `pnpm test apps/api/src/modules/retell/route.test.ts` | Route still called the removed claim-only API, lacked invocation identity/NFC semantics, and read oversized unauthenticated bodies before rejection; later outcome recording repeated on replay. | 25 passed after adding the 256 KiB pre-signature body limit. |
| `pnpm test packages/core/src/providers/calcom.test.ts` | Official `isInstantEvent: true` event types were accepted by omission. | 50 passed after requiring and rejecting instant-event semantics. |
| `pnpm test:int packages/core/tests/retell-booking.int.test.ts packages/core/tests/retell-invocations.int.test.ts` | Invocation was not linked before provider I/O; stale processing did not enter uncertain recovery. | 16 passed at that cycle; expanded crash/concurrency coverage subsequently passed 22 tests before the final pool test was added. |
| `pnpm test packages/core/tests/calcom-webhook-secret.test.ts` | Missing executable script; success/output and fail-closed assertions failed. | 7 passed. |
| `pnpm test:int apps/api/src/modules/calcom/booking-races.int.test.ts packages/core/tests/retell.int.test.ts` | Existing assertions updated from superseded claim-only results to durable replay results. | 12 passed. |
| `pnpm test packages/core/src/providers/employee-calendar.test.ts` | Full unit run exposed a stale two-argument mock assertion after the optional invocation argument was introduced. | 25 passed after updating that assertion. |

Fault injection covers message result-write rollback, booking intent-link rollback before any external write, completion-result loss after provider success, stale network-checkpoint recovery, concurrent replay and bounded/private result storage.

## Final required commands

| Exact command | Result |
|---|---|
| `pnpm test` | Exit 0; 44 files, 458 tests passed. |
| `pnpm test:int` | Exit 0; 14 files, 119 tests passed. |
| `pnpm test:web` | Exit 0; 17 files, 98 tests passed. |
| `pnpm typecheck` | Exit 0; all workspace TypeScript checks and API entry-point check passed. |
| `pnpm lint` | Exit 0. |
| `pnpm build` | Exit 0; Vite emitted its chunk-size warning (>500 kB). |
| `DATABASE_URL=postgresql://dummy:dummy@127.0.0.1:1/unreachable pnpm -F @receptionist/core exec drizzle-kit generate` | Exit 0; “No schema changes, nothing to migrate”. No dotenv loader. |
| `DATABASE_URL=postgresql://dummy:dummy@127.0.0.1:1/unreachable pnpm -F @receptionist/core exec drizzle-kit check` | Exit 0; metadata consistent. |
| `git diff --check` | Exit 0. |

0013 was initially generated with:
`DATABASE_URL=postgresql://dummy:dummy@127.0.0.1:1/unreachable pnpm -F @receptionist/core exec drizzle-kit generate --name retell_function_invocations`.

Earlier verification failures were resolved: a TypeScript tuple inference error in the new migration snapshot helper, and the optional-argument unit assertion noted above. One intermediate focused integration run intermittently failed the existing “concurrent overlapping calls” confirmation assertion; the immediate focused rerun and subsequent full run passed. Its cause was not established, and this report does not claim that intermittent condition was fixed.

## Files changed by this task

This list identifies this task's edits, not every file shown by the pre-existing dirty `git status`.

Application and storage:

- `apps/web/src/features/employees/CalcomConnection.tsx`
- `apps/api/src/modules/retell/route.ts`
- `packages/core/src/repositories/retell.ts`
- `packages/core/src/repositories/appointments.ts`
- `packages/core/src/repositories/calcom.ts` (webhook comment correction)
- `packages/core/src/providers/employee-calendar.ts`
- `packages/core/src/db/schema.ts`
- `packages/core/drizzle/0013_retell_function_invocations.sql` (new)
- `packages/core/drizzle/meta/0013_snapshot.json` (new)
- `packages/core/drizzle/meta/_journal.json`
- `scripts/calcom-webhook-secret.mjs` (new, executable)
- `package.json` (local CLI entry only)

Tests:

- `apps/web/src/features/employees/CalcomConnection.test.tsx`
- `apps/api/src/modules/retell/route.test.ts`
- `apps/api/src/modules/calcom/booking-races.int.test.ts`
- `packages/core/src/providers/employee-calendar.test.ts`
- `packages/core/tests/migrations.int.test.ts`
- `packages/core/tests/retell-invocations.int.test.ts` (new)
- `packages/core/tests/retell-booking.int.test.ts`
- `packages/core/tests/retell.int.test.ts`
- `packages/core/tests/calcom-webhook-secret.test.ts` (new)

Documentation:

- `docs/CALCOM_INTEGRATION.md`
- `docs/ALI_RETELL_SETUP.md`
- `docs/CALCOM_REPAIR_REPORT.md` (historical-status note)
- `docs/RETELL_MVP_IMPLEMENTATION.md` (historical-status note)
- `docs/CALCOM_BOUNDARY_REPLAY_REPORT.md` (this report)

## Operational limits

No live verification is claimed. The new Retell route requires separately approved 0013 rollout; the documented current-boundary artifact applies only 0012. Keep `max_retry=0`. A network/database crash cannot establish whether the provider booked; preserve uncertain invocations/reservations and use authenticated/manual reconciliation. Standard created/cancelled webhooks do not guarantee DeskRoute request metadata. Keep replay records during application rollback and do not deploy the old claim-only writer over the new ledger.
