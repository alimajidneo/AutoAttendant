#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const reviewed = [
  [0, "0000_init", 1788604005850, "5a310101eb42181f71d630d1fbdcee05e57ced016908ca8154fbb23e2e259dc3"],
  [1, "0001_supabase_auth", 1788850683574, "fb3b1826cf5eaf8d12a35e1f23c6d39a5d171de143e4f61abb3bb5f03b268735"],
  [2, "0002_backend_table_rls", 1788850841874, "824f4335785c6da3074887d1d5d5c6f7cfea246e719b1c34997a0b7d08d47754"],
  [3, "0003_amusing_blue_blade", 1788863625584, "f03bb87f1d93f99f35517d67dd70107bd86f787fe772cfd7772d57529cc4ac7a"],
  [4, "0004_salty_hammerhead", 1788926857490, "76d381bf8ad5da63b57c1a614c18e926e1bc2a109b5ee3f5c130731ca5c24508"],
  [5, "0005_third_morgan_stark", 1788929666309, "3410b655beaec6933404ee2faf2eefdcac6419f5ebc9f366f6f32a286afbc0ec"],
  [6, "0006_spooky_rhino", 1789011990800, "004a7e4a16c6ad1f0326aa084d7aab96eb006456aae6f6fddba5dfc0693bd995"],
  [7, "0007_square_darwin", 1789014830790, "9a9f75319c8fedccc2e8097a122efdc97120f0ac020ae588a2dac04ab10b8c78"],
  [8, "0008_curved_nebula", 1789035634668, "c8d597f56968a60235ceff774f655521589149fe5f6a91cb639aa7620a242c2d"],
  [9, "0009_redundant_ulik", 1789100407772, "4e9d04cf2988aed3de609c3bfd5395b8b142924476371ef8bb13324e8b02dee6"],
  [10, "0010_employee_foundation", 1789317762750, "fb35afab1a74982d2977fc1cc6d4e9d93a925870000fb3d79844af4171c52e74"],
  [11, "0011_retell_boundary", 1789318533545, "c5d31ab6763d676fcd0f868898c8fec5031da3f9dee7d977afc003ad3138d5fb"],
  [12, "0012_calcom_integration", 1789376911440, "2b30be229b9e9d5838a487eafce6124a6a7868aaee4f0381da560ba1a0e6a7bf"],
  [13, "0013_retell_function_invocations", 1789378995620, "8bf317f4b3b538fc41a5e3cc2b83f2ff110c0d6b3f4efb28e7e5ed6a55d3433c"],
  [14, "0014_employee_calcom_oauth", 1789455668817, "8d3d239749a4dd26d2280145cbe7c93596dcffd4d98c6fa524ee3aa9c234e7dc"],
].map(([idx, tag, when, hash]) => ({ idx, tag, when, hash }));
const reviewedJournalHash = "6019ce99b88a90987c6c1f3bffb3ce7b18b8614b48fa4b0a924651ab0a916dfa";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  if (!process.argv[index + 1]) throw new Error(`${name} requires a value`);
  return path.resolve(process.argv[index + 1]);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const migrationsDirectory = argument("--migrations-dir", path.join(root, "packages/core/drizzle"));
const outputDirectory = argument("--output-dir", null);
if (!outputDirectory) throw new Error("--output-dir is required");

const journalBytes = readFileSync(path.join(migrationsDirectory, "meta/_journal.json"));
const journalHash = createHash("sha256").update(journalBytes).digest("hex");
if (journalHash !== reviewedJournalHash) {
  throw new Error(`Migration journal checksum mismatch: expected ${reviewedJournalHash}, received ${journalHash}`);
}
const journal = JSON.parse(journalBytes.toString("utf8"));
if (journal.version !== "7" || journal.dialect !== "postgresql" || journal.entries.length !== reviewed.length) {
  throw new Error("Migration journal does not match the reviewed 0000-0014 boundary");
}

for (const expected of reviewed) {
  const actual = journal.entries[expected.idx];
  if (!actual || actual.idx !== expected.idx || actual.version !== "7" || actual.when !== expected.when ||
      actual.tag !== expected.tag || actual.breakpoints !== true) {
    throw new Error(`Journal mismatch for ${expected.tag}`);
  }
  expected.bytes = readFileSync(path.join(migrationsDirectory, `${expected.tag}.sql`));
  const actualHash = createHash("sha256").update(expected.bytes).digest("hex");
  if (actualHash !== expected.hash) throw new Error(`Checksum mismatch for ${expected.tag}: expected ${expected.hash}, received ${actualHash}`);
}

const expectedTable = (entries, name) => `
CREATE TEMP TABLE ${name} (ordinal integer PRIMARY KEY, hash text NOT NULL, created_at bigint NOT NULL) ON COMMIT DROP;
INSERT INTO ${name} (ordinal, hash, created_at) VALUES
${entries.map((entry) => `  (${entry.idx}, '${entry.hash}', ${entry.when})`).join(",\n")};
`;

const ledgerAssertion = (table, count, label) => `
DO $gate$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NULL THEN
    RAISE EXCEPTION '${label}: drizzle.__drizzle_migrations is missing';
  END IF;
  IF (SELECT count(*) FROM drizzle.__drizzle_migrations) <> ${count} OR EXISTS (
    WITH actual AS (
      SELECT row_number() OVER (ORDER BY id) - 1 AS ordinal, hash, created_at
      FROM drizzle.__drizzle_migrations
    )
    SELECT 1 FROM ${table} expected
    FULL JOIN actual USING (ordinal, hash, created_at)
    WHERE expected.ordinal IS NULL OR actual.ordinal IS NULL
  ) THEN
    RAISE EXCEPTION '${label}: ledger is not exactly the reviewed ordered ${count}-row boundary';
  END IF;
END
$gate$;
`;

const sessionGuards = `SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';
SELECT pg_advisory_xact_lock(77120414);
`;
const predecessor = `${expectedTable(reviewed.slice(0, 12), "expected_0011_ledger")}${ledgerAssertion("expected_0011_ledger", 12, "0011 preflight failed")}`;
const finalLedger = `${expectedTable(reviewed, "expected_0014_ledger")}${ledgerAssertion("expected_0014_ledger", 15, "0014 postflight failed")}`;

const inheritedConstraints = [
  ["appointments", "appointments_employee_interval_check", "c", "check (employee_id is null or start_time is not null and end_time is not null and end_time > start_time)"],
  ["appointments", "appointments_employee_no_overlap", "x", "exclude using gist (agent_id with =, employee_id with =, tstzrange(start_time, end_time, '[)'::text) with &&) where (employee_id is not null and (status = any (array['requested'::appointment_status, 'confirmed'::appointment_status])))"],
  ["appointments", "appointments_employee_workspace_fk", "f", "foreign key (agent_id, employee_id) references employees(agent_id, id)"],
  ["appointments", "appointments_provider_write_state_check", "c", "check (provider_write_state is null or employee_id is not null and status = 'requested'::appointment_status and (provider_write_state = any (array['in_flight'::text, 'reconciliation_required'::text])))"],
  ["calendar_connections", "calendar_connections_employee_workspace_fk", "f", "foreign key (agent_id, employee_id) references employees(agent_id, id)"],
  ["calls", "calls_cost_duration_check", "c", "check ((duration_ms is null or duration_ms >= 0) and (cost_cents is null or cost_cents >= 0::double precision and cost_cents <= 100000000::double precision))"],
  ["calls", "calls_provider_check", "c", "check (provider = any (array['livekit'::text, 'retell'::text]))"],
  ["calls", "calls_retell_privacy_check", "c", "check (provider <> 'retell'::text or provider_call_id is not null and retell_agent_id is not null and transcript is null and recording_key is null and caller_id is null and (caller_phone is null or caller_phone ~ '^•••• [0-9]{4}$'::text))"],
  ["retell_connections", "retell_connections_agent_id_workspaces_agent_id_fk", "f", "foreign key (agent_id) references workspaces(agent_id) on delete cascade"],
  ["retell_connections", "retell_connections_retell_agent_id_unique", "u", "unique (retell_agent_id)"],
  ["retell_webhook_receipts", "retell_webhook_receipts_agent_id_workspaces_agent_id_fk", "f", "foreign key (agent_id) references workspaces(agent_id) on delete cascade"],
];

const rolloutConstraints = [
  ["calcom_connections", "calcom_agent_id_unique", "u", "unique (agent_id, id)"],
  ["calcom_connections", "calcom_auth_kind_check", "c", "check (auth_kind = any (array['api_key'::text, 'oauth'::text]))"],
  ["calcom_connections", "calcom_connections_agent_id_workspaces_agent_id_fk", "f", "foreign key (agent_id) references workspaces(agent_id) on delete cascade"],
  ["calcom_connections", "calcom_employee_unique", "u", "unique (agent_id, employee_id)"],
  ["calcom_connections", "calcom_employee_workspace_fk", "f", "foreign key (agent_id, employee_id) references employees(agent_id, id)"],
  ["calcom_connections", "calcom_lease_state_check", "c", "check ((auth_kind = 'oauth'::text or credential_refresh_lease_expires_at is null) and (lifecycle_lease_expires_at is null or (status = any (array['setup_required'::text, 'disconnecting'::text]))))"],
  ["calcom_connections", "calcom_oauth_setup_check", "c", "check (auth_kind <> 'oauth'::text or status <> 'active'::text or event_type_id is not null and webhook_id is not null and destination_calendar_integration is not null and destination_calendar_external_id is not null and length(destination_calendar_integration) > 0 and length(destination_calendar_external_id) > 0)"],
  ["calcom_connections", "calcom_provider_identity_unique", "u", "unique (agent_id, provider_user_id)"],
  ["calcom_connections", "calcom_status_check", "c", "check (status = any (array['active'::text, 'setup_required'::text, 'reconnect_required'::text, 'disconnecting'::text]))"],
  ["calcom_connections", "calcom_versions_check", "c", "check (credential_version > 0 and lifecycle_generation > 0)"],
  ["calcom_oauth_states", "calcom_oauth_state_hash_check", "c", "check (state_hash ~ '^[a-f0-9]{64}$'::text and browser_challenge_hash ~ '^[a-f0-9]{64}$'::text)"],
  ["calcom_oauth_states", "calcom_oauth_state_identity_check", "c", "check (length(user_id) >= 1 and length(user_id) <= 200 and (starting_provider_user_id is null or length(starting_provider_user_id) >= 1 and length(starting_provider_user_id) <= 200))"],
  ["calcom_oauth_states", "calcom_oauth_state_intent_check", "c", "check (intent = 'connect'::text and starting_connection_id is null and starting_provider_user_id is null and starting_lifecycle_generation is null or intent = 'reconnect'::text and starting_connection_id is not null and starting_provider_user_id is not null and starting_lifecycle_generation > 0)"],
  ["calcom_oauth_states", "calcom_oauth_states_agent_id_workspaces_agent_id_fk", "f", "foreign key (agent_id) references workspaces(agent_id) on delete cascade"],
  ["calcom_oauth_states", "calcom_oauth_states_employee_workspace_fk", "f", "foreign key (agent_id, employee_id) references employees(agent_id, id) on delete cascade"],
  ["calcom_webhook_receipts", "calcom_webhook_receipts_connection_id_calcom_connections_id_fk", "f", "foreign key (connection_id) references calcom_connections(id) on delete cascade"],
  ["calcom_webhook_receipts", "calcom_webhook_receipts_connection_id_digest_pk", "p", "primary key (connection_id, digest)"],
  ["retell_function_invocations", "retell_function_invocations_agent_id_workspaces_agent_id_fk", "f", "foreign key (agent_id) references workspaces(agent_id) on delete cascade"],
  ["retell_function_invocations", "retell_function_invocations_appointment_id_appointments_id_fk", "f", "foreign key (appointment_id) references appointments(id) on delete set null"],
  ["retell_function_invocations", "retell_invocation_identity_check", "c", "check (key ~ '^[a-f0-9]{64}$'::text and semantic_hash ~ '^[a-f0-9]{64}$'::text and length(call_id) >= 1 and length(call_id) <= 200 and (name = any (array['book-appointment'::text, 'save-message'::text])))"],
  ["retell_function_invocations", "retell_invocation_result_check", "c", "check ((state = 'completed'::text) = (result is not null) and (result is null or jsonb_typeof(result) = 'object'::text and octet_length(result::text) <= 8192))"],
  ["retell_function_invocations", "retell_invocation_state_check", "c", "check (state = any (array['processing'::text, 'completed'::text, 'uncertain'::text]))"],
  ["workspace_members", "workspace_members_employee_unique", "u", "unique (agent_id, employee_id)"],
  ["workspace_members", "workspace_members_employee_workspace_fk", "f", "foreign key (agent_id, employee_id) references employees(agent_id, id)"],
];

const sqlLiteral = (value) => `'${value.replaceAll("'", "''")}'`;
const constraintAssertion = (constraints, label, tableName) => `
CREATE TEMP TABLE ${tableName} (table_name text NOT NULL, constraint_name text NOT NULL, constraint_type "char" NOT NULL, definition text NOT NULL) ON COMMIT DROP;
INSERT INTO ${tableName} (table_name, constraint_name, constraint_type, definition) VALUES
${constraints.map(([table, name, type, definition]) => `  (${sqlLiteral(table)}, ${sqlLiteral(name)}, ${sqlLiteral(type)}, ${sqlLiteral(definition)})`).join(",\n")};
DO $gate$
DECLARE mismatch text;
BEGIN
  SELECT string_agg(expected.table_name || '.' || expected.constraint_name, ', ' ORDER BY expected.table_name, expected.constraint_name)
  INTO mismatch
  FROM ${tableName} expected
  LEFT JOIN pg_constraint actual
    ON actual.conname = expected.constraint_name
   AND actual.conrelid = ('public.' || expected.table_name)::regclass
   AND actual.connamespace = 'public'::regnamespace
   AND actual.contype = expected.constraint_type
   AND actual.convalidated
   AND regexp_replace(lower(pg_get_constraintdef(actual.oid, true)), '[[:space:]]+', ' ', 'g') = expected.definition
  WHERE actual.oid IS NULL;
  IF mismatch IS NOT NULL THEN
    RAISE EXCEPTION '${label}: missing or structurally mismatched constraints %', mismatch;
  END IF;
END
$gate$;
`;

const inheritedConstraintAssertion = constraintAssertion(inheritedConstraints, "0011 preflight failed", "expected_0011_constraints");
const finalConstraintAssertion = constraintAssertion([...inheritedConstraints, ...rolloutConstraints], "0014 postflight failed", "expected_0014_constraints");

const inheritedSchemaAssertion = `${inheritedConstraintAssertion}
DO $gate$
DECLARE missing text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO missing
  FROM unnest(ARRAY['appointments','calendar_connections','calls','retell_connections','retell_webhook_receipts']) AS name
  WHERE to_regclass('public.' || name) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION '0011 preflight failed: missing inherited tables %', missing; END IF;
  IF to_regclass('public.calcom_connections') IS NOT NULL
    OR to_regclass('public.calcom_webhook_receipts') IS NOT NULL
    OR to_regclass('public.retell_function_invocations') IS NOT NULL
    OR to_regclass('public.calcom_oauth_states') IS NOT NULL THEN
    RAISE EXCEPTION '0011 preflight failed: 0012-0014 tables already exist';
  END IF;
  IF to_regclass('public.calls_retell_provider_call_idx') IS NULL THEN
    RAISE EXCEPTION '0011 preflight failed: calls_retell_provider_call_idx is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid = ANY (ARRAY['public.retell_connections'::regclass,'public.retell_webhook_receipts'::regclass]) AND NOT relrowsecurity) THEN
    RAISE EXCEPTION '0011 preflight failed: inherited Retell table RLS is disabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY (ARRAY['retell_connections','retell_webhook_receipts'])) THEN
    RAISE EXCEPTION '0011 preflight failed: inherited Retell tables must have no policies';
  END IF;
END
$gate$;
`;

const schemaAssertion = `
${finalConstraintAssertion}
DO $gate$
DECLARE missing text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO missing
  FROM unnest(ARRAY['calcom_connections','calcom_webhook_receipts','retell_function_invocations','calcom_oauth_states']) AS name
  WHERE to_regclass('public.' || name) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION '0014 postflight failed: missing tables %', missing; END IF;


  SELECT string_agg(name, ', ' ORDER BY name) INTO missing
  FROM unnest(ARRAY['calcom_receipts_connection_time_idx','calcom_receipts_time_idx','retell_invocation_recovery_idx',
    'calcom_oauth_states_expiry_idx','calcom_oauth_states_employee_idx']) AS name
  WHERE to_regclass('public.' || name) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION '0014 postflight failed: missing indexes %', missing; END IF;

  SELECT string_agg(relname, ', ' ORDER BY relname) INTO missing
  FROM pg_class
  WHERE oid = ANY (ARRAY['public.calcom_connections'::regclass,'public.calcom_webhook_receipts'::regclass,
    'public.retell_function_invocations'::regclass,'public.calcom_oauth_states'::regclass]) AND NOT relrowsecurity;
  IF missing IS NOT NULL THEN RAISE EXCEPTION '0014 postflight failed: RLS disabled on %', missing; END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY
    (ARRAY['calcom_connections','calcom_webhook_receipts','retell_function_invocations','calcom_oauth_states'])) THEN
    RAISE EXCEPTION '0014 postflight failed: rollout tables must remain deny-by-default with no policies';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='calcom_connections' AND column_name='auth_kind' AND column_default = '''api_key''::text')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='calcom_connections' AND column_name='status' AND column_default = '''active''::text')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='calcom_connections' AND column_name='credential_version' AND column_default = '1')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='calcom_connections' AND column_name='lifecycle_generation' AND column_default = '1')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='retell_function_invocations' AND column_name='state' AND column_default = '''processing''::text') THEN
    RAISE EXCEPTION '0014 postflight failed: required defaults do not match';
  END IF;
END
$gate$;
`;

const preflight = `\\set ON_ERROR_STOP on
BEGIN;
${sessionGuards}${predecessor}${inheritedSchemaAssertion}ROLLBACK;
`;
let apply = `\\set ON_ERROR_STOP on
BEGIN;
${sessionGuards}${predecessor}${inheritedSchemaAssertion}`;
for (const entry of reviewed.slice(12)) {
  apply += `\n-- ${entry.tag} (${entry.hash})\n${entry.bytes.toString("utf8")}\n`;
  apply += `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('${entry.hash}', ${entry.when});\n`;
}
apply += `${finalLedger}${schemaAssertion}COMMIT;\n`;
const postflight = `\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '2min';
${finalLedger}${schemaAssertion}ROLLBACK;
`;

mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
const artifacts = {
  "preflight-0011.sql": preflight,
  "apply-0012-through-0014.sql": apply,
  "postflight-0014.sql": postflight,
  "migration-manifest.sha256": reviewed.map((entry) => `${entry.hash}  packages/core/drizzle/${entry.tag}.sql`).join("\n") + "\n",
};
artifacts["rollout-artifacts.sha256"] = [
  "preflight-0011.sql",
  "apply-0012-through-0014.sql",
  "postflight-0014.sql",
].map((name) => `${createHash("sha256").update(artifacts[name]).digest("hex")}  ${name}`).join("\n") + "\n";
for (const [name, contents] of Object.entries(artifacts)) {
  writeFileSync(path.join(outputDirectory, name), contents, { mode: 0o600 });
}
console.log(`Verified 0000-0014 source; 0012 sha256 ${reviewed[12].hash}`);
console.log(`Wrote checksum-bound 0011-to-0014 rollout artifacts to ${outputDirectory}`);
