# USA-only Retell deployment and acceptance gate

**Status:** preparation only — no deployment, provider mutation, production migration, number purchase, web call, real call, or paid usage is authorized by this document.

**Target:** one production-grade US receptionist using Retell-managed telephony, Retell conversation flow/knowledge base, and DeskRoute's signed functions. Pakistan/international routing, custom SIP and LiveKit deployment are deferred.

## 1. Current safe boundary

The existing Vercel project is linked and has the intended Node/build/output settings, but currently has:

- zero deployments;
- zero environment variables;
- no connected Git repository.

The configured production database has migrations through `0011_retell_boundary`. Migrations `0012_calcom_integration`, `0013_retell_function_invocations`, and `0014_employee_calcom_oauth` remain unapplied.

Do not deploy code that depends on `0012`–`0014` before a fresh backup, migration approval, controlled application, and post-migration verification.

## 2. Release-candidate gate

Before any hosted action:

- [ ] Review every tracked and untracked change against the exact working-copy fingerprint.
- [ ] Unit/API/voice tests pass.
- [ ] Complete web tests pass.
- [ ] Fresh PostgreSQL migration and integration tests pass.
- [ ] Typecheck, lint, production build and `git diff --check` pass.
- [ ] Changed-source secret scan reports zero potential credentials.
- [ ] API imports with all `LIVEKIT_*` variables absent.
- [ ] Independent audits report no unresolved release blocker.
- [ ] Commit and push receive separate approval; neither is implied by local verification.

## 3. Production environment-variable inventory

Install values through the deployment secret manager only. Never paste values into chat, Git, documentation, screenshots, `VITE_*` secrets, or a Retell prompt/knowledge base.

### Required for the Retell-only web/API deployment

| Name | Exposure | Rule |
| --- | --- | --- |
| `DATABASE_URL` | server secret | Supabase transaction-pooler URL for Vercel; migrations use a separately controlled migration-capable connection. |
| `DATABASE_POOL_MAX` | server config | `1` for the Vercel function. |
| `SUPABASE_URL` | server/public project config | Exact intended project. |
| `SUPABASE_PUBLISHABLE_KEY` | server/public key | Publishable key only, never service-role. |
| `VITE_SUPABASE_URL` | browser-safe | Same intended project URL. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | browser-safe | Publishable key only. |
| `PUBLIC_API_URL` | server config | Stable HTTPS deployment origin, without `/api` or trailing slash. |
| `DASHBOARD_ORIGINS` | server config | Exact allowed HTTPS dashboard origin(s). |
| `TOKEN_ENCRYPTION_KEY` | server secret | Preserve the existing 64-hex-character key; changing it makes stored provider credentials unreadable. |
| `RETELL_API_KEY` | server secret | Approved Retell key marked as the webhook key. |
| `RETELL_AGENT_ID` | operational binding | Exact approved Retell agent ID. |
| `RETELL_WORKSPACE_ID` | operational binding | Exact DeskRoute workspace UUID; not a Retell workspace ID. |

### Required only for enabled integrations

- Google Calendar: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- Microsoft Calendar: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`.
- Cal.com OAuth: `CALCOM_OAUTH_CLIENT_ID`, `CALCOM_OAUTH_CLIENT_SECRET`.
- Cal.com webhook verification: `CALCOM_WEBHOOK_SECRET` (32+ random characters).
- Retell/Cal.com receipt maintenance: `CRON_SECRET` (32+ random characters).
- Slack: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` only if Slack remains enabled for this deployment.
- Recording storage: all four `R2_*` variables or none. Prefer none for the first pilot.

Keep `CALCOM_OAUTH_WRITE_APPROVED=false` until Cal.com has approved the hosted application's event-type/webhook writes and the change receives explicit production approval.

### Intentionally unset for this deployment

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `VITE_LIVEKIT_ENABLED`
- `VITE_API_URL` (production uses same-origin `/api`)
- `PORT` (provided by Vercel)
- all `R2_*` values unless recording is separately approved

## 4. Migration `0011` → `0014` gate

1. Freeze the exact candidate and reviewed migration checksums. Generate the checksum-bound preflight/apply/postflight artifacts with `node scripts/generate-0011-to-0014-rollout.mjs --output-dir "$CALCOM_RUN_DIR"`; compare `migration-manifest.sha256` byte-for-byte with the separately approved migration manifest. The generator rejects any byte change to `_journal.json` or a migration.
2. Confirm the target database identity without printing connection credentials.
3. Create a fresh private backup and verify its checksum and restoration instructions.
4. Record sanitized pre-migration counts for calendar connections, appointments, employees, Retell calls and migration-ledger rows.
5. From `CALCOM_RUN_DIR`, run `sha256sum --check rollout-artifacts.sha256` immediately before preflight, again immediately before apply, and again immediately before postflight. Any mismatch stops the rollout. Run the generated preflight, then apply only committed migrations `0012`, `0013`, and `0014` with the generated transactional artifact and controlled migration connection. Never run migrations in the Vercel build.
6. Verify the migration ledger and required tables, columns, indexes and triggers. Every critical constraint must match its public owning table, constraint type, validation state and normalized `pg_get_constraintdef`, including composite tenant foreign keys and `ON DELETE` behavior; a matching name alone is not sufficient.
7. Run the behavioral RLS deny check for every rollout table with an approved non-owner, non-superuser, non-`BYPASSRLS` role. Populated-table `SELECT` must return no rows and a valid `INSERT` must fail with SQLSTATE `42501`; this is mandatory and cannot be replaced by catalog inspection.
8. Verify all historical rows remain and every previously decryptable credential remains decryptable, without printing plaintext.
9. Run read-only application health and calendar-account-list checks before enabling provider writes.
10. If any check fails, stop traffic and follow the reviewed recovery procedure; do not improvise destructive down-migrations.

## 5. Retell draft configuration

Use one versioned draft main agent and one pinned transfer-screening agent. Follow `ALI_RETELL_SETUP.md` for exact schemas and prompts.

Required signed functions:

1. `lookup_employee`
2. `check_availability`
3. `resolve_transfer`
4. `book_appointment`
5. `save_message`

Keep the normal Retell envelope enabled; DeskRoute needs `call.agent_id`, `call.call_id`, and `args`. Retell supplies `X-Retell-Signature`. Use `max_retry=0` for all five functions; it is mandatory for booking and message writes.

The first voice milestone does not expose appointment lookup, rescheduling or cancellation as Retell functions. Dashboard cancellation exists; appointment lookup and rescheduling require separately scoped product/API work before any future voice-tool addition.

Every provider-backed booking path, including direct Google/Microsoft and Cal.com authorities, returns `confirmation_required` unless the request carries explicit caller confirmation. Browser acceptance must prove that omitted or false confirmation causes no reservation and no provider write.

## 6. Browser-call acceptance

A Retell web call can test speech, conversation flow, knowledge retrieval and HTTPS custom functions. It **cannot test telephone transfer**. Retell's official pricing page checked on 2026-09-17 says customers pay for voice-agent minutes and lists simulation testing as a platform feature; it does not say browser calls are unmetered. Free credits are finite usage credits, not proof of zero metering. Do not run a browser call under a strict zero-cost instruction until the actual account proves a zero-cost allowance.

### Local/disposable checks allowed now

- [ ] Unsigned, stale or malformed signatures fail before parsing/provider work.
- [ ] Oversized bodies fail with `413`.
- [ ] Disabled, mismatched or unknown agent/workspace mappings execute no function.
- [ ] Lookup handles zero, one and multiple employee matches.
- [ ] Availability fails closed for provider uncertainty, outside hours and conflicts.
- [ ] Transfer resolution returns no destination for ineligible employees and never places a call.
- [ ] Booking and message saving require explicit caller confirmation; omitted or false confirmation produces no reservation, escalation, or provider write. Booking announces success only for `status=confirmed`, and message saving only for `saved=true`.
- [ ] Booking/message duplicate or ambiguous invocations do not repeat side effects.
- [ ] Protected transfer numbers, credentials and calendar event details are absent from spoken/logged output.

### Hosted Retell web-call checks — blocked pending approval and stable HTTPS

- approved identity and automated-receptionist disclosure;
- answerable and deliberately unanswerable knowledge questions;
- real signed lookup and availability calls in one isolated test workspace;
- function timeout/malformed-response fallback;
- voice quality, interruption handling and timezone/date readback;
- booking/message writes only in an isolated authorized calendar/workspace with separate approval.

### Telephone-only checks — deferred until number purchase

- private employee briefing;
- explicit yes bridges;
- no, wrong person, voicemail, silence and timeout cancel;
- cancelled transfer returns to booking/message fallback;
- caller ID, audio, latency, lifecycle webhooks and itemized cost.

## 7. External approval gates

Stop and ask Ali before each separate action:

1. local commit;
2. push/Git integration;
3. production database backup/migrations;
4. uploading environment values to Vercel;
5. Vercel deployment;
6. provider callback or Retell-agent mutation;
7. any Retell simulation/web call unless confirmed free;
8. any real calendar write against a non-disposable provider account;
9. number purchase, auto-recharge, paid add-on or real telephone call.

## 8. Definition of production acceptance

Production acceptance requires evidence for the complete path:

```text
US caller → Retell → signed DeskRoute function → authorized workspace/employee
→ live availability → confirmed booking or safe message
→ telephone-only private screening → explicit employee acceptance → bridge
```

Passing local tests, a successful deployment, or a successful web call proves only part of this path. Do not call the product production-ready until the real US telephone matrix, provider records, privacy/retention settings, backup/restore evidence, monitoring and actual cost records have passed.
