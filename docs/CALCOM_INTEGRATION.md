# Cal.com API v2 integration

This is an offline-tested source implementation, not a verified live connection. No live account/provider call, production/Supabase database access, production migration, commit, push, or deployment was performed. Local PostgreSQL migrations and tests run only on localhost:5433.

## Employee identity and consent

The workspace owner opens Employees, chooses the employee, and enters that employee's API key in the Cal.com password field. Obtain the employee/account owner's consent first. Validation reads `/v2/me`; only account ID, email, username and connection status return to the browser. The input clears after submission and credentials are never redisplayed. Use HTTPS for the DeskRoute manager application.

`hello@neodym.ai` is the company integration owner, not a substitute for every employee's scheduling identity. The database enforces one connection per employee and prevents assigning the same Cal user to unrelated employees in a workspace. No Teams subscription, shared company calendar, remote event-type mutation, or pretend OAuth flow is involved. Only the API-key flow is implemented. There is no OAuth authorization, callback, refresh-token flow, or OAuth auth_kind value.

Grant only the access necessary to read the employee's identity and event types, read slots/bookings, and create/cancel bookings. Where the account's API-key controls cannot narrow scopes, treat the key as sensitive account access and document consent. Do not give DeskRoute event-type or webhook administration rights unnecessarily. Configure the event type in Cal.com yourself; prefer a normal, fixed-duration, non-instant personal event without payment, custom required fields, seating, recurrence, or approval requirements. Discovery and selection filter unsupported requirements before a write. The conservative subset rejects instant, recurring, seated, paid, approval-required, variable-duration, booking-auth-required, email-verification-required, required custom fields, caller-defined locations, and multiple location choices. Nonempty app configuration is also excluded because its booking requirements are not proven compatible. Only bounded scheduling facts are returned; provider metadata is reduced to an app-configuration-present flag. Required default name/email/phone fields are allowed because DeskRoute supplies them, with event-specific contact requirements checked before reservation. The supported event is re-read before availability/booking; changed or incomplete configuration fails closed.

Refresh event types and choose an event returned by the authenticated connection. Selection re-reads discovery on the server and checks tenant/employee/connection ownership. Legacy `{authority:"calcom",eventType:"username/slug",bookingUrl}` remains readable and link-only: it cannot prove availability or write a booking. Connected selection stores `connectionId`, numeric `eventTypeId`, `eventTypeSlug`, `eventTypeTitle`, and `bookingUrl`.

Disconnect performs local cleanup only. It clears the selected policy, deletes the encrypted connection and receipts, and is blocked while any non-cancelled appointment still references the connection. Reconnect refreshes the same provider identity; disconnect first to change identities. Provider 401/403 marks a saved connection `reconnect_required` without disclosing the response. A new successful credential validation restores `active`.

## Configuration and storage

- `CALCOM_API_BASE_URL`: accepts exactly `https://api.cal.com/v2` (one trailing slash is normalized). Environment parsing and the client constructor both reject other origins/paths, HTTP, userinfo, queries, fragments and ports. Self-hosted endpoints are not supported. Redirects remain disabled.
- `TOKEN_ENCRYPTION_KEY`: existing server-only AES-256-GCM encryption key. Keep it in a secret manager; existing rotation/backup requirements apply. Credential associated data includes both tenant and connection ID.
- `CRON_SECRET`: server-only random secret of at least 32 characters. The daily schedule in `vercel.json` invokes `GET /api/internal/calcom/receipts` with scheduler Bearer authentication; missing/incorrect authentication returns 401. Configure this secret when separately deploying the schedule. For other hosting, invoke the same protected route daily. No scheduler was deployed or invoked remotely here.
- `CALCOM_WEBHOOK_SECRET`: server-only random root secret of at least 32 characters. DeskRoute derives a different HMAC secret for each connection ID; the root itself must never be sent to Cal.com. Rotate only through coordinated server/operator tooling, and never log it or include it in URLs.

The current production boundary is 0011. Reviewed additive migration `0012_calcom_integration.sql` is frozen; `0013_retell_function_invocations.sql` now separately adds durable Retell invocation state. Neither has been applied to production by this work. It is additive, with a matching Drizzle journal entry and snapshot. It adds RLS-enabled `calcom_connections` and `calcom_webhook_receipts`; no client RLS grants are added. The server accesses them through authenticated tenant-scoped repositories. The generic calendar table was not reused because it assumes Google/Microsoft refresh-token authentication and assignment semantics. Existing appointment connection UUIDs are intentionally polymorphic (no generic-connection FK); `externalCalendarId = calcom:<eventTypeId>` identifies the Cal path and preserves the original connection for later operations.

### Local operator webhook-secret derivation

Only a trusted operator with access to the server secret environment runs this local utility. It imports no application environment loader, reads no files, opens no database/network connection and exposes no HTTP endpoint. Supply the root via an already-approved process environment or Node's explicit `--env-file` mechanism pointed at an approved protected file. Do not pass the root as an argument, echo it, enable shell tracing, or put it in a browser.

```bash
# CALCOM_WEBHOOK_SECRET is already injected by the operator secret manager.
node scripts/calcom-webhook-secret.mjs <canonical-lowercase-connection-uuid>
# Equivalent package entry; --silent suppresses pnpm banners:
pnpm --silent calcom:webhook-secret <canonical-lowercase-connection-uuid>
# Alternative approved env-file mechanism (operator-selected path):
node --env-file=/approved/protected/operator.env scripts/calcom-webhook-secret.mjs <canonical-lowercase-connection-uuid>
```

Success stdout is only the derived 64-hex secret plus newline; stderr is empty. Missing/short root, extra arguments and invalid/noncanonical UUIDs fail with a fixed non-secret message and empty stdout. Capture the derived secret only in the approved secret manager; it is itself a credential. It matches the server's existing HMAC domain separation and differs for every connection UUID. Configure any remote webhook only in a later authorized account operation.

## Verified contract

Implementation used the local official sparse source `/tmp/calcom-source`, main supplied as of 2026-09-14:

- `apps/api/v2/src/platform/me/me.controller.ts`: authenticated `GET /v2/me`.
- `apps/api/v2/src/platform/event-types/event-types_2024_06_14/controllers/event-types.controller.ts`: authenticated discovery `GET /v2/event-types`, header `cal-api-version: 2024-06-14`.
- `packages/platform/types/slots/slots-2024-09-04/{inputs/get-slots.input.ts,outputs/slots.output.ts}`: `GET /v2/slots`, header `2024-09-04`, `eventTypeId`, `start`, `end`, `timeZone`, `format=range`. Only an explicit start/end slot matching the requested interval authorizes a booking attempt.
- `apps/api/v2/src/platform/bookings/2024-08-13/controllers/bookings.controller.ts`: `POST /v2/bookings`, `GET /v2/bookings/:bookingUid`, `POST /v2/bookings/:bookingUid/cancel`, all header `2024-08-13`. Cancellation uses a fixed non-PII reason. 404/410 never prove absence locally.
- `packages/features/webhooks/lib/service/WebhookService.ts` and `lib/factory/versioned/v2021-10-20/BookingPayloadBuilder.ts`: HMAC SHA-256 hex signature over exact raw bytes, `X-Cal-Signature-256`, webhook version `2021-10-20`.

## Booking and reconciliation

Existing direct Google/Microsoft behavior is retained. Cal checks routing/manual state/working hours, then explicit provider slots. It requires a valid email or E.164 international phone and explicit caller confirmation. It reserves locally before exactly one provider POST. Only an `accepted` response with the expected interval/event type and a UID, followed by local finalization, produces `confirmed`. Pending, malformed success, network failure, timeout and 5xx keep the reservation and require reconciliation. Definite rejection statuses 400/401/403/404/405/410/422 may release it only from the exact unchanged requested/in_flight reservation. Both success and rejection finalization compare the reservation identity, interval, UID, state and PostgreSQL row version. Concurrent webhook/reconciliation changes make the invocation return unknown and trigger authenticated provider reconciliation; they never authorize a second POST. There is no automatic booking retry.

Managers can use `POST /api/admin/appointments/:appointmentId/reconcile-calcom` with `{}` when a validated UID is already stored, or `{ "bookingUid": "<known UID from the account>" }` after inspecting Cal. It performs an authenticated GET, checks the original event type, interval, tenant/employee/appointment metadata and updates local state only for a definite current outcome. An explicitly supplied UID takes precedence over a stale stored UID on unresolved rows, but must pass every identity/interval check. Automatic reconciliation prefers an already established UID. The SQL update compares the full snapshot and PostgreSQL row version, including connection, employee, event type, interval and current UID. It never infers absence from errors. Existing `reconcile-not-created` requires the manager's explicit provider inspection/attestation; it cannot clear an appointment with a known provider UID. Do not use it merely because time has passed.

Cancellation and appointment sync use authenticated booking reads. Failed cancellation leaves the local appointment active. Existing cancellation UI calls the Cal UID endpoint through this path. Rescheduling is deliberately not exposed: a changed UID/interval requires inspection in Cal; DeskRoute does not fake a reschedule route or silently move the local reservation. Do not treat a webhook as an ordered state history.

## Retell

Keep **`max_retry=0`** on `book-appointment` (and the existing `save-message`). No remote Retell configuration was changed here. Public Retell webhook/function bodies are capped at 262144 streamed bytes before signature parsing; oversized requests return 413 without repository/provider work. Extend the existing booking tool with optional `caller_email`, `caller_phone`, and `caller_confirmed` (boolean); existing camelCase contact inputs remain compatible. Ask the caller to confirm the employee, exact time/timezone and contact details before setting `caller_confirmed: true`. A valid email OR E.164 phone is mandatory for the Cal path. Never fabricate an email/phone.

`contact_required` means collect valid contact details; `confirmation_required` means ask for explicit confirmation. `unknown` means do not retry and do not announce success; offer a follow-up. Only `confirmed` permits “your appointment is confirmed.” Legacy `use_calcom` is a handoff link, not a booking confirmation. A completed replay returns the exact stored normalized result, including the original appointment/message identifier, without repeating a provider write or outcome mutation. A historical confirmation describes that invocation; replay does not undo a later cancellation. Corrected arguments require a new stable invocation ID when one was supplied. Reusing an ID with different semantics returns unknown.

Write invocation keys include workspace, provider call ID, function name, and the top-level `tool_call_id` or `invocation_id` when supplied (both must agree). These optional fields must be bounded ASCII identifiers; do not assume Retell supplies one in every delivery. Without one, use SHA-256 of canonical semantic arguments. All semantic text is Unicode NFC before validation and hashing; booking UUID case, UTC interval, name/purpose whitespace and snake/camel aliases are also canonicalized. JSON ordering/formatting and composed/decomposed text cannot create a new fallback invocation. Conflicting aliases fail before claiming. Only hashes and bounded normalized results are persisted, never request arguments/bodies, transcripts, credentials or provider error bodies.

### Durable crash semantics (requires 0013)

- Claim is committed as `processing` before read-only eligibility/provider inspection. A crash here does not prove absence and never allows automatic re-execution.
- When a booking is eligible, the reservation and its invocation link commit in one local transaction. That transaction checks/locks the processing invocation and sets it to `uncertain` **before** any external booking POST. If linking fails, reservation creation rolls back and no POST occurs.
- There is no atomic transaction spanning PostgreSQL and the provider. A crash after the checkpoint may have happened before sending, during sending, after provider success, or before durable result storage. All these cases remain uncertain. The linked reservation and existing `in_flight` protection remain; do not infer failure from a missing UID.
- A normal definite result is stored as `completed` before returning it. Results use an allowlisted schema and a database 8192-byte JSON limit; failures use a fixed `unknown/reconciliation_required` response without storing raw exceptions. If completion storage fails after external/local booking success, replay remains uncertain, even if the appointment itself is confirmed. Inspect that linked appointment; do not create another.
- Concurrent delivery while processing or uncertain returns unknown without taking over the invocation. A different invocation ID for the same call also cannot write while any earlier call booking is requested or confirmed; only a definitively cancelled/rejected reservation permits another attempt. After 24 hours, replay marks a stale processing record uncertain and a linked requested reservation `reconciliation_required`, fencing late finalization. Recovery is also available through the existing appointment UI/API; no replay is required to inspect a stale in-flight appointment. Age alone never releases an appointment.
- For Cal.com, manually obtain the UID from the account and use authenticated UID reconciliation. For missing UID, use the existing explicit not-created attestation only after actual provider inspection and after any in-flight sender is stopped. If no intent exists, investigate the original call rather than deleting/reusing its invocation key.
- `save-message` claim, escalation insert, call outcome and result commit in one PostgreSQL transaction. A crash before commit rolls all back; a committed replay returns the original message ID. There is no intermediate durable message-only state.
- Existing 0011 claim-only receipts contain no recoverable result. Any such receipt for that workspace/call/function blocks new execution conservatively, including when old/new normalization differs. Inspect manually. Keep invocation records for the lifetime of potential replay; do not prune them like 14-day webhook receipts. Never delete completed or uncertain records simply to permit another write.

Keep **`max_retry=0`** for both write tools. A new invocation ID is not permission to repeat an ambiguous or confirmed booking.


## Webhook setup (manual, later authorization required)

A publicly reachable HTTPS URL is required: `/api/calcom/webhooks/<connectionId>`. Do not create or manage remote webhooks until that endpoint is deployed and account changes are explicitly authorized. Subscribe only to `BOOKING_CREATED`, `BOOKING_RESCHEDULED`, `BOOKING_CANCELLED`; use standard JSON (no custom payload template), version `2021-10-20`, and the server-generated secret derived for that specific connection. Never enter the `CALCOM_WEBHOOK_SECRET` root in Cal.com. Each account must target its own connection ID, and a signature for one connection is rejected on every other connection URL.

The route counts actual streamed bytes and rejects more than 262144 bytes even with missing or false Content-Length, requires exactly `X-Cal-Webhook-Version: 2021-10-20`, verifies constant-time HMAC before JSON parsing, accepts the standard payload when optional `eventTypeId` is absent, strips private fields, and durably deduplicates a deterministic digest. Receipts retain only connection ID, digest, booking UID, trigger and timestamp. Ingestion and the authenticated daily job delete receipts older than 14 days; the daily schedule gives approximately 14–15 day retention while healthy, including idle connections. Connection/time and time indexes support cleanup. Monitor scheduler failures: retention cannot run while the scheduler/application is unavailable. No attendee records, descriptions, transcripts, raw payloads or secrets are archived. Standard BOOKING_CREATED/CANCELLED webhooks generally lack DeskRoute request metadata. There is **no guaranteed automatic metadata correlation**. Without `eventTypeId` and all tenant, employee and appointment identifiers, ingestion records only the bounded receipt and does not mutate appointments. Authenticated/manual UID reconciliation is the supported recovery. A payload containing every validated identifier may associate a UID with a matching unresolved appointment whose UID is null or identical. SQL checks connection, tenant, employee, appointment, event type and exact interval. Webhooks never confirm an appointment directly. Duplicates return 204. Authenticated sync/reconciliation determines provider state, preventing stale delivery from resurrecting a cancellation.

## Offline validation

Focused provider, employee-flow, API and UI tests use mocked fetch/repositories only. `packages/core/tests/calcom.int.test.ts` adds local Postgres coverage for encrypted storage, tenant and employee isolation, identity assignment uniqueness, durable duplicate receipts and local reference cleanup. The repair runs these tests against `localhost:5433/deskroute_test`, including migrations into scratch test databases on the same local server. Provider fetches remain mocked. The existing webhook-version and RLS regressions are retained. Never use `test:live` for offline validation.

Drizzle `generate` and `check` were run with an explicit dummy localhost URL and no dotenv loader; they inspect source/snapshots and do not connect or apply migrations. See `CALCOM_REPAIR_REPORT.md` for the current commands, RED evidence, results and exact changed files. `CALCOM_IMPLEMENTATION_REPORT.md` preserves the earlier implementation history.

## Production migration and recovery runbook

These are instructions for a **later, separately authorized operator operation**. They were not run against production. Do not run the root `db:migrate` or an unrestricted Drizzle migrator at the deployed 0011 boundary: the checkout now includes 0013. Do not regenerate/edit migrations 0000–0012.

### Preflight and backup

1. Freeze application writes, background jobs, Retell tool delivery and webhook ingress for the maintenance window. Confirm no booking POST is still in flight. Inventory unresolved appointments and preserve their provider UIDs, employee/connection mappings and reservation states.
2. Use an approved libpq service/passfile setup (`PGSERVICE`, `PGPASSFILE`, verified TLS) supplied by the operator secret manager. Do not place a connection URL/password in commands, shell history, logs or this document. Disable shell tracing. Use an approved encrypted backup volume, restrictive permissions and a reviewed release checkout.
3. Compare the historical SQL files to a separately retained, reviewed release checksum manifest. A checksum generated from this checkout alone cannot prove deployed source integrity. The SQL below additionally compares all twelve deployed ledger hashes/timestamps, rejecting missing, duplicate, changed or extra entries.
4. Back up the entire relevant database state: public tables (including agents/workspaces/members, employees/policies, calendar credentials, Retell mappings/receipts/calls, appointments, escalations), the Drizzle ledger, and relevant auth identity schema. Keep provider credential encryption keys and webhook root in a separately access-controlled secret-manager backup; database ciphertext without its key is not recoverable. Preserve grants/roles in the infrastructure backup. Verify restoration in a separately authorized isolated environment before proceeding.

Commands below assume `CALCOM_RUN_DIR` is an operator-selected directory on that encrypted volume and `APPROVED_MIGRATION_MANIFEST` is the trusted 0000–0012 SHA-256 manifest. No environment file is loaded implicitly.

```bash
set +x
umask 077
: "${PGSERVICE:?Set an approved libpq service}"
: "${CALCOM_RUN_DIR:?Set an approved encrypted output directory}"
: "${APPROVED_MIGRATION_MANIFEST:?Set the trusted release checksum manifest path}"
sha256sum --check "$APPROVED_MIGRATION_MANIFEST"
mkdir -p "$CALCOM_RUN_DIR"
pg_dump --format=custom --schema=public --schema=drizzle --schema=auth   --file="$CALCOM_RUN_DIR/before-0012.dump"
pg_restore --list "$CALCOM_RUN_DIR/before-0012.dump" > "$CALCOM_RUN_DIR/backup-inventory.txt"
```

A dump inventory is not a restore test. Resolve backup/restore failures before applying anything.

### Generate a bounded apply artifact locally

From the repository root, the following generates SQL files only. It reads migration SQL/journal, never credentials or a database. The apply artifact asserts the **exact 0000–0011 ledger**, fingerprints every existing public table (row counts plus hashes covering identifiers and all stored values), applies **only the unchanged 0012 bytes**, records the matching hash/timestamp in the ledger, checks row preservation and verifies new schema objects in the same transaction. Fingerprints avoid exporting row contents. Keep writers stopped: concurrent writes invalidate preservation comparisons.

```bash
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const out = process.env.CALCOM_RUN_DIR;
if (!out) throw new Error('Set CALCOM_RUN_DIR');
const dir = 'packages/core/drizzle';
const journal = JSON.parse(readFileSync(dir + '/meta/_journal.json', 'utf8'));
const entries = journal.entries.filter(e => e.idx <= 12);
if (entries.length !== 13 || entries.some((e, i) => e.idx !== i) ||
    entries[12].tag !== '0012_calcom_integration') throw new Error('Unexpected boundary');
const migrations = entries.map(e => {
  if (!/^00[0-9]{2}_[a-z0-9_]+$/.test(e.tag) || !Number.isSafeInteger(e.when)) throw new Error('Invalid journal');
  const bytes = readFileSync(dir + '/' + e.tag + '.sql');
  return { ...e, sql: bytes.toString('utf8'), hash: createHash('sha256').update(bytes).digest('hex') };
});
const values = migrations.slice(0, 12).map(e => `('${e.hash}', ${e.when})`).join(`,
`);
const preflight = `
CREATE TEMP TABLE expected_0011 (hash text, created_at bigint);
INSERT INTO expected_0011 VALUES ${values};
DO $$ BEGIN
 IF (SELECT count(*) FROM drizzle.__drizzle_migrations) <> 12
 OR EXISTS (SELECT hash, created_at FROM expected_0011 EXCEPT SELECT hash, created_at FROM drizzle.__drizzle_migrations)
 OR EXISTS (SELECT hash, created_at FROM drizzle.__drizzle_migrations EXCEPT SELECT hash, created_at FROM expected_0011)
 THEN RAISE EXCEPTION 'Ledger is not exactly the reviewed 0000 through 0011'; END IF;
 IF to_regclass('public.calcom_connections') IS NOT NULL
 OR to_regclass('public.calcom_webhook_receipts') IS NOT NULL
 OR to_regclass('public.retell_function_invocations') IS NOT NULL
 THEN RAISE EXCEPTION 'Unexpected additive tables at 0011 boundary'; END IF;
END $$;
`;
const capture = `
CREATE TEMP TABLE before_0012 (table_name text PRIMARY KEY, row_count bigint, fingerprint text);
DO $$ DECLARE t record; n bigint; h text; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP
  EXECUTE format('SELECT count(*), md5(coalesce(string_agg(md5(to_jsonb(r)::text), '''' ORDER BY md5(to_jsonb(r)::text)), '''')) FROM public.%I r', t.tablename) INTO n,h;
  INSERT INTO before_0012 VALUES (t.tablename,n,h);
 END LOOP;
END $$;
`;
const preservation = `
DO $$ DECLARE t record; n bigint; h text; BEGIN
 FOR t IN SELECT * FROM before_0012 LOOP
  EXECUTE format('SELECT count(*), md5(coalesce(string_agg(md5(to_jsonb(r)::text), '''' ORDER BY md5(to_jsonb(r)::text)), '''')) FROM public.%I r', t.table_name) INTO n,h;
  IF n <> t.row_count OR h IS DISTINCT FROM t.fingerprint THEN
   RAISE EXCEPTION 'Existing rows changed in %', t.table_name;
  END IF;
 END LOOP;
END $$;
SELECT table_name,row_count,fingerprint FROM before_0012 ORDER BY table_name;
`;
const checks = `
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_class WHERE oid IN ('public.calcom_connections'::regclass,'public.calcom_webhook_receipts'::regclass) AND relrowsecurity) <> 2
 THEN RAISE EXCEPTION 'RLS missing'; END IF;
 IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename IN ('calcom_connections','calcom_webhook_receipts'))
 THEN RAISE EXCEPTION 'Unexpected client RLS policies'; END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE conrelid IN ('public.calcom_connections'::regclass,'public.calcom_webhook_receipts'::regclass) AND contype='f') <> 3
 THEN RAISE EXCEPTION 'Cal.com FKs missing'; END IF;
 IF to_regclass('public.calcom_receipts_connection_time_idx') IS NULL OR to_regclass('public.calcom_receipts_time_idx') IS NULL
 THEN RAISE EXCEPTION 'Retention indexes missing'; END IF;
 IF to_regclass('public.retell_function_invocations') IS NOT NULL THEN RAISE EXCEPTION '0013 must not be applied here'; END IF;
END $$;
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid IN ('public.calcom_connections'::regclass,'public.calcom_webhook_receipts'::regclass,
 'public.calendar_connections'::regclass,'public.appointments'::regclass) ORDER BY conname;
SELECT tablename,indexname,indexdef FROM pg_indexes
 WHERE schemaname='public' AND tablename IN ('calcom_connections','calcom_webhook_receipts') ORDER BY indexname;
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,r.rolname AS owner,r.rolbypassrls
 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner
 WHERE c.oid IN ('public.calcom_connections'::regclass,'public.calcom_webhook_receipts'::regclass);
`;
const next = migrations[12];
writeFileSync(resolve(out, 'preflight-0011.sql'), `BEGIN;
` + preflight + `ROLLBACK;
`, { mode: 0o600 });
writeFileSync(resolve(out, 'apply-only-0012.sql'),
 `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='10min';
` +
 preflight + capture + next.sql + `
INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('${next.hash}',${next.when});
` +
 preservation + checks +
 `DO $$ BEGIN IF (SELECT count(*) FROM drizzle.__drizzle_migrations) <> 13 THEN RAISE EXCEPTION 'Incorrect final ledger'; END IF; END $$;
COMMIT;
`,
 { mode: 0o600 });
writeFileSync(resolve(out, 'postflight-0012.sql'), checks, { mode: 0o600 });
NODE
```

### Later authorized execution: apply only 0012

Review the generated artifact and its checksum before execution. `psql -X` avoids local startup hooks; `ON_ERROR_STOP` makes any failed ledger, migration or preservation assertion abort. A failure before COMMIT rolls back all DDL and the ledger entry.

```bash
psql -X --set=ON_ERROR_STOP=1 --file="$CALCOM_RUN_DIR/preflight-0011.sql"   > "$CALCOM_RUN_DIR/preflight.log"
# Only after the separate operational approval and verified backup:
psql -X --set=ON_ERROR_STOP=1 --file="$CALCOM_RUN_DIR/apply-only-0012.sql"   > "$CALCOM_RUN_DIR/apply-only-0012.log"
psql -X --set=ON_ERROR_STOP=1 --file="$CALCOM_RUN_DIR/postflight-0012.sql"   > "$CALCOM_RUN_DIR/postflight.log"
```

Check the output against 0012: two new empty tables; tenant FK to `workspaces(agent_id)`; composite employee selection FK `(agent_id,employee_id) → employees(agent_id,id)`; receipt FK to the connection; employee/provider/tenant identity uniqueness; API-key-only and connection-status checks; both retention indexes; enabled RLS with no client policies. The inherited calendar/appointment employee FKs must still exist. Employee policy and appointment external connection IDs are JSON/polymorphic references validated by repositories, **not new SQL foreign keys**. Do not claim those JSON selections are database-enforced.

For a deny-behavior check, use an existing approved unprivileged client role (not the table owner, superuser or BYPASSRLS role). Inside a rolled-back transaction, grant SELECT/INSERT on just these tables, `SET LOCAL ROLE` to it, and verify SELECT returns no rows and a syntactically valid INSERT receives SQLSTATE `42501`. Use an isolated local acceptance fixture for positive seeded-row read denial; never insert real credentials just to test RLS. The exact-boundary local PostgreSQL test already exercises populated-table SELECT denial and INSERT denial. Application repository access requires a trusted backend role; RLS does not replace tenant-scoped backend queries.

### Account for 0013 without applying it

`0013_retell_function_invocations.sql`, its journal entry and snapshot are a separate additive rollout. The above artifact cannot apply it. The new Retell route **requires 0013**; do not enable/deploy that route against an 0012-only database. Keep write tools disabled until a separately reviewed 0012→0013 migration/backup window is approved. Its table stores processing/completed/uncertain state, semantic hashes, bounded results, a linked appointment FK and a tenant/state/time recovery index, with default-deny RLS. Preserve old webhook receipts. Never backfill historical claims as completed or invent results.

### Application rollback and eventual cleanup

Roll back application code/configuration while retaining additive 0012/0013 tables and ledger entries. Disable Retell booking/message write tools and new Cal booking writes during rollback: an old claim-only binary does not consult the new replay ledger. Keep a compatible authenticated reconciliation/cancellation path available to operators. Preserve all unresolved reservations, UIDs, connection IDs, credentials, invocation results and secret versions. Do not reverse migrations or remove ledger entries to make an old deploy start.

Before any **later, separately authorized destructive cleanup**, inventory all appointment/policy/invocation references (including cancelled/history rows needed for audit or replay). Resolve/cancel outstanding provider bookings through authenticated inspection, export encrypted credentials with tenant/connection identity and encryption-version context to an approved encrypted archive, and verify recovery using the separately secured decryption key. Arrange authorized provider key/webhook revocation and retention/deletion of exported credential copies. Clear dependent selections and references only with an audited migration; retain necessary replay tombstones/results so old calls cannot repeat writes. Confirm no supported application or recovery path needs the tables. Only then may a separately reviewed destructive migration remove them; no destructive cleanup commands are provided or executed here.
